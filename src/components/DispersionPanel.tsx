import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  ColorPicker,
  Divider,
  Input,
  message,
  Popover,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import {
  AimOutlined,
  ClearOutlined,
  DownloadOutlined,
  EditOutlined,
  ExpandOutlined,
  FileImageOutlined,
  FileTextOutlined,
  ScissorOutlined,
  UndoOutlined,
  UploadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauri, writeBinaryFile, writeTextFile } from "../api";
import {
  ARMOR,
  avgDistance,
  hitRate,
  meanPoint,
  minEnclosingCircle,
  pointRingScore,
  RING_COUNT,
  RING_WIDTH_MM,
  score,
} from "../dispersion/math";
import type { Pt } from "../dispersion/math";
import { useAppStore } from "../store";
import CropModal from "./CropModal";
import type { PaperSpec } from "./CropModal";

/** 压缩靶纸图片：最长边不超过 maxEdge，转 JPEG（原图动辄几 MB，存进组会撑大会话文件） */
function compressImage(
  image: HTMLImageElement,
  maxEdge = 1920,
  quality = 0.85
): string {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const r = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * r));
  const ch = Math.max(1, Math.round(h * r));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d");
  if (!ctx) return image.src;
  ctx.drawImage(image, 0, 0, cw, ch);
  return c.toDataURL("image/jpeg", quality);
}

export const PAPER_SIZES: PaperSpec[] = [
  { name: "A4", w: 210, h: 297 },
  { name: "A5", w: 148, h: 210 },
  { name: "A3", w: 297, h: 420 },
  { name: "Letter", w: 216, h: 279 },
  { name: "Legal", w: 216, h: 356 },
];

interface TextMark {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

interface Analysis {
  center: Pt;
  score: number;
  avgDist: number;
  hitSmall: number;
  hitLarge: number;
  hitDart: number;
  mec: { center: Pt; radius: number };
}

const COLORS = {
  point: "#ee2222",
  ring: "#16a34a",
  center: "#16a34a",
  small: "#d9b800",
  large: "#ff6400",
  dart: "#ff00ff",
  mec: "#0050ff",
};

/** 场景绘制：图像 + 弹孔 + （可选）分析叠加 + 文字（图像像素坐标系） */
function drawScene(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  points: Pt[],
  texts: TextMark[],
  analysis: Analysis | null,
  mmPerPx: number,
  showOverlay: boolean
) {
  ctx.drawImage(img, 0, 0);
  const fontPx = Math.max(12, Math.round(img.naturalWidth / 60));

  // 弹孔点（始终绘制）+ 环数标注（仅叠加层开启时）
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, fontPx / 5), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.point;
    ctx.fill();
    if (analysis && showOverlay) {
      const dMm =
        Math.hypot(p.x - analysis.center.x, p.y - analysis.center.y) * mmPerPx;
      ctx.font = `${fontPx * 0.8}px sans-serif`;
      ctx.fillStyle = COLORS.mec;
      ctx.fillText(String(pointRingScore(dMm)), p.x + 6, p.y - 6);
    }
  }

  if (analysis && showOverlay) {
    const { center } = analysis;
    // 中心十字
    ctx.strokeStyle = COLORS.center;
    ctx.lineWidth = Math.max(1.5, fontPx / 10);
    const arm = fontPx;
    ctx.beginPath();
    ctx.moveTo(center.x - arm, center.y);
    ctx.lineTo(center.x + arm, center.y);
    ctx.moveTo(center.x, center.y - arm);
    ctx.lineTo(center.x, center.y + arm);
    ctx.stroke();
    ctx.font = `${fontPx * 0.75}px sans-serif`;
    ctx.fillStyle = COLORS.center;
    ctx.fillText("center", center.x + arm * 0.4, center.y + arm);

    // 9 环同心圆
    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = Math.max(1, fontPx / 14);
    for (let i = 1; i <= RING_COUNT; i++) {
      ctx.beginPath();
      ctx.arc(
        center.x,
        center.y,
        (i * RING_WIDTH_MM) / mmPerPx,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    // 三种装甲框
    const frames = [
      { spec: ARMOR.small, color: COLORS.small },
      { spec: ARMOR.large, color: COLORS.large },
      { spec: ARMOR.dart, color: COLORS.dart },
    ];
    for (const f of frames) {
      const hw = f.spec.w / mmPerPx / 2;
      const hh = f.spec.h / mmPerPx / 2;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = Math.max(2, fontPx / 9);
      ctx.strokeRect(center.x - hw, center.y - hh, hw * 2, hh * 2);
    }

    // 最小包围圆
    ctx.strokeStyle = COLORS.mec;
    ctx.lineWidth = Math.max(2, fontPx / 9);
    ctx.beginPath();
    ctx.arc(
      analysis.mec.center.x,
      analysis.mec.center.y,
      analysis.mec.radius,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }

  // 文本标注
  for (const t of texts) {
    ctx.font = `${(t.size * fontPx) / 18}px sans-serif`;
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
}

/** 结果区单行指标：色点 + 标签 + 数值 */
function MetricRow(props: {
  label: string;
  value: string;
  unit?: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "5px 0",
      }}
    >
      <Space size={6}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: props.color,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 12, color: "#666" }}>{props.label}</span>
      </Space>
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {props.value}
        {props.unit && (
          <span style={{ fontSize: 11, color: "#999", fontWeight: 400 }}>
            {" "}
            {props.unit}
          </span>
        )}
      </span>
    </div>
  );
}

export default function DispersionPanel(props: { onBack: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [paper, setPaper] = useState<PaperSpec>(PAPER_SIZES[0]);
  // 有效标定尺寸：默认按横向 A4（用户靶纸均为横放）；裁剪确认后更新
  const [effSpec, setEffSpec] = useState<PaperSpec>({
    name: "A4·横向",
    w: 297,
    h: 210,
  });
  const [cropped, setCropped] = useState(false);
  const [points, setPoints] = useState<Pt[]>([]);
  const [texts, setTexts] = useState<TextMark[]>([]);
  const [scale, setScale] = useState(1);
  const [centerMode, setCenterMode] = useState<"points" | "image">("points");
  const [cropOpen, setCropOpen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [placingText, setPlacingText] = useState(false);
  const [textPopOpen, setTextPopOpen] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [textSize, setTextSize] = useState(18);
  const [textColor, setTextColor] = useState("#ff3b3b");
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [autoFit, setAutoFit] = useState(true);
  const [fitSize, setFitSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /** 当前组：散布分析数据记录到该组，切换组时自动载入对应靶纸 */
  const groupId = useAppStore((s) => s.viewingGroupId);
  const group = useAppStore(
    (s) => s.groups.find((g) => g.id === s.viewingGroupId) ?? null
  );
  const setGroupDispersion = useAppStore((s) => s.setGroupDispersion);
  /** 当前靶纸图片的压缩 dataURL（写回组里） */
  const [imgDataUrl, setImgDataUrl] = useState<string | undefined>(undefined);
  /** 正在从组数据载入，避免载入过程反过来触发写回 */
  const loadingRef = useRef(false);

  // 组切换：把该组已存的散布数据载入到面板
  useEffect(() => {
    loadingRef.current = true;
    const d = group?.dispersion;
    setPoints(d ? d.points.map((p) => ({ ...p })) : []);
    setTexts(d ? d.texts.map((t) => ({ ...t })) : []);
    if (d) {
      setEffSpec({ ...d.effSpec });
      setCropped(true);
    } else {
      setCropped(false);
    }
    setImgDataUrl(d?.imageDataUrl);
    if (d?.imageDataUrl) {
      const image = new Image();
      image.onload = () => {
        setImg(image);
        setAutoFit(true);
        loadingRef.current = false;
      };
      image.onerror = () => {
        setImg(null);
        loadingRef.current = false;
      };
      image.src = d.imageDataUrl;
    } else {
      setImg(null);
      loadingRef.current = false;
    }
    // 仅在切组时同步，不跟随组对象的每次更新（避免与写回互相触发）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // 任何编辑都写回当前组（300ms 去抖）
  useEffect(() => {
    if (!groupId || loadingRef.current) return;
    const t = window.setTimeout(() => {
      const cur = useAppStore
        .getState()
        .groups.find((g) => g.id === groupId);
      const empty = !imgDataUrl && points.length === 0 && texts.length === 0;
      // 组里本来也没有数据时，不必写入空对象
      if (empty && !cur?.dispersion) return;
      setGroupDispersion(
        groupId,
        empty
          ? undefined
          : {
              imageDataUrl: imgDataUrl,
              effSpec: { name: effSpec.name, w: effSpec.w, h: effSpec.h },
              points,
              texts,
              updatedAt: Date.now(),
            }
      );
    }, 300);
    return () => clearTimeout(t);
  }, [groupId, imgDataUrl, effSpec, points, texts, setGroupDispersion]);

  const natural = img
    ? { w: img.naturalWidth, h: img.naturalHeight }
    : { w: 0, h: 0 };
  const mmPerPx = natural.w > 0 ? effSpec.w / natural.w : 0;

  // 适应模式：按容器实时计算显示尺寸（允许放大），容器变化时跟随
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !img || !autoFit) return;
    const update = () => {
      const cw = el.clientWidth - 4;
      const ch = el.clientHeight - 4;
      const r = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      setFitSize({
        w: Math.max(1, Math.round(img.naturalWidth * r)),
        h: Math.max(1, Math.round(img.naturalHeight * r)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [img, autoFit]);

  /** 手动缩放时，以当前适应比例作为起点 */
  const currentFitRatio = () => {
    const el = wrapRef.current;
    if (!el || !img) return 1;
    return Math.min(
      (el.clientWidth - 10) / img.naturalWidth,
      (el.clientHeight - 10) / img.naturalHeight
    );
  };

  const zoomBy = (factor: number) => {
    if (autoFit) {
      // 从适应模式进入手动缩放：以当前适应比例为起点
      setScale(() =>
        Math.min(6, Math.max(0.1, currentFitRatio() * factor))
      );
    } else {
      setScale((s) => Math.min(6, Math.max(0.1, s * factor)));
    }
    setAutoFit(false);
  };

  const analysis = useMemo<Analysis | null>(() => {
    if (!img || points.length === 0) return null;
    const center =
      centerMode === "points"
        ? meanPoint(points)!
        : { x: natural.w / 2, y: natural.h / 2 };
    return {
      center,
      score: score(points, center, mmPerPx)!,
      avgDist: avgDistance(points, center, mmPerPx)!,
      hitSmall: hitRate(points, center, ARMOR.small, mmPerPx)!,
      hitLarge: hitRate(points, center, ARMOR.large, mmPerPx)!,
      hitDart: hitRate(points, center, ARMOR.dart, mmPerPx)!,
      mec: minEnclosingCircle(points)!,
    };
  }, [img, points, centerMode, natural.w, natural.h, mmPerPx]);

  // 显示用 canvas 重绘（位图始终为原始分辨率，显示缩放交给浏览器）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, natural.w, natural.h);
    drawScene(ctx, img, points, texts, analysis, mmPerPx, showOverlay);
  }, [img, points, texts, analysis, natural.w, natural.h, mmPerPx, showOverlay]);

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const image = new Image();
      image.onload = () => {
        setImg(image);
        setImgDataUrl(compressImage(image));
        setCropped(false);
        setPoints([]);
        setTexts([]);
        setAutoFit(true);
      };
      image.onerror = () => message.error("图片加载失败");
      image.src = url;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) loadFile(f);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!img) return;
    // 以元素实际显示尺寸换算图像坐标：任何缩放方式下都精确
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * natural.w) / rect.width;
    const y = ((e.clientY - rect.top) * natural.h) / rect.height;
    if (placingText) {
      if (textInput.trim()) {
        setTexts((ts) => [
          ...ts,
          { x, y, text: textInput.trim(), size: textSize, color: textColor },
        ]);
      }
      setPlacingText(false);
    } else {
      setPoints((ps) => [...ps, { x, y }]);
    }
  };

  const exportImage = async () => {
    if (!img) return;
    setExporting(true);
    try {
      const off = document.createElement("canvas");
      off.width = natural.w;
      off.height = natural.h;
      const ctx = off.getContext("2d")!;
      drawScene(ctx, img, points, texts, analysis, mmPerPx, showOverlay);
      const dataUrl = off.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      const path = await save({
        defaultPath: "散布分析标注图.png",
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
      });
      if (!path) return;
      await writeBinaryFile(path, base64);
      message.success("标注图已保存");
    } catch (e) {
      message.error(`保存失败：${e}`);
    } finally {
      setExporting(false);
    }
  };

  const exportJson = async () => {
    if (!img) return;
    setExporting(true);
    try {
      const payload = {
        paper: cropped ? effSpec : { ...effSpec, note: "未裁剪，按整图标定" },
        center_mode: centerMode,
        mm_per_px: mmPerPx,
        points,
        texts,
        result: analysis
          ? {
              score: analysis.score,
              avg_distance_mm: analysis.avgDist,
              hit_small: analysis.hitSmall,
              hit_large: analysis.hitLarge,
              hit_dart: analysis.hitDart,
              min_radius_mm: analysis.mec.radius * mmPerPx,
            }
          : null,
      };
      const path = await save({
        defaultPath: "散布分析结果.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, JSON.stringify(payload, null, 2));
      message.success("数据已保存");
    } catch (e) {
      message.error(`保存失败：${e}`);
    } finally {
      setExporting(false);
    }
  };

  const textControls = (
    <div style={{ width: 210 }}>
      <Input
        size="small"
        placeholder="标注内容"
        value={textInput}
        onChange={(e) => setTextInput(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Space style={{ marginBottom: 10 }}>
        <Select
          size="small"
          value={textSize}
          onChange={setTextSize}
          style={{ width: 66 }}
          options={[14, 16, 18, 20, 24, 28, 32].map((v) => ({
            value: v,
            label: v,
          }))}
        />
        <ColorPicker
          size="small"
          value={textColor}
          onChange={(c) => setTextColor(c.toHexString())}
        />
      </Space>
      <Space>
        <Button
          size="small"
          type="primary"
          disabled={!textInput.trim()}
          onClick={() => {
            setPlacingText(true);
            setTextPopOpen(false);
          }}
        >
          放置
        </Button>
        <Button
          size="small"
          icon={<UndoOutlined />}
          disabled={texts.length === 0}
          onClick={() => setTexts((ts) => ts.slice(0, -1))}
        >
          撤销
        </Button>
      </Space>
    </div>
  );

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <AimOutlined style={{ color: "#1677ff" }} />
          <span>散布分析（靶纸弹道）</span>
          {group ? (
            <Tag color="blue">记录到：{group.name}</Tag>
          ) : (
            <Tag color="warning">未选择组：数据不会保存</Tag>
          )}
          {img && (
            <Tag color={cropped ? "green" : "orange"}>
              {cropped
                ? `已裁剪：${effSpec.name} ${effSpec.w}×${effSpec.h}mm`
                : `未裁剪：按整图 ${effSpec.name} ${effSpec.w}×${effSpec.h}mm 标定`}
            </Tag>
          )}
        </Space>
      }
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
      styles={{
        body: {
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
      extra={
        <Button size="small" onClick={props.onBack}>
          返回图表
        </Button>
      }
    >
      {/* 工具栏：分组单行 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <Button
          type="primary"
          size="small"
          icon={<UploadOutlined />}
          onClick={() => fileInputRef.current?.click()}
        >
          上传靶纸
        </Button>
        <Button
          size="small"
          icon={<ScissorOutlined />}
          disabled={!img}
          onClick={() => setCropOpen(true)}
        >
          裁剪标定
        </Button>
        <Divider type="vertical" />
        <Tooltip title="撤销点">
          <Button
            size="small"
            icon={<UndoOutlined />}
            disabled={points.length === 0}
            onClick={() => setPoints((ps) => ps.slice(0, -1))}
          />
        </Tooltip>
        <Tooltip title="清除全部点和文本">
          <Button
            size="small"
            danger
            icon={<ClearOutlined />}
            disabled={points.length === 0 && texts.length === 0}
            onClick={() => {
              setPoints([]);
              setTexts([]);
            }}
          />
        </Tooltip>
        <Divider type="vertical" />
        <Button
          size="small"
          icon={<ZoomOutOutlined />}
          disabled={!img}
          onClick={() => zoomBy(1 / 1.25)}
        />
        <span
          style={{
            fontSize: 12,
            color: "#888",
            minWidth: 36,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {autoFit
            ? fitSize
              ? `${Math.round((fitSize.w / natural.w) * 100)}%`
              : "适应"
            : `${Math.round(scale * 100)}%`}
        </span>
        <Button
          size="small"
          icon={<ZoomInOutlined />}
          disabled={!img}
          onClick={() => zoomBy(1.25)}
        />
        <Tooltip title="适应窗口">
          <Button
            size="small"
            icon={<ExpandOutlined />}
            disabled={!img}
            type={autoFit ? "primary" : "default"}
            onClick={() => setAutoFit(true)}
          />
        </Tooltip>
        <Divider type="vertical" />
        <Segmented
          size="small"
          value={centerMode}
          onChange={(v) => setCenterMode(v as "points" | "image")}
          options={[
            { label: "点群中心", value: "points" },
            { label: "图片中心", value: "image" },
          ]}
        />
        <Tooltip title="标点时可关闭，避免圆环/方框遮挡弹孔；数值结果始终实时更新">
          <Space size={4}>
            <Switch
              size="small"
              checked={showOverlay}
              onChange={setShowOverlay}
              disabled={!analysis}
            />
            <span style={{ fontSize: 12, color: "#888" }}>分析叠加</span>
          </Space>
        </Tooltip>
        <Popover
          content={textControls}
          trigger="click"
          placement="bottomLeft"
          open={textPopOpen}
          onOpenChange={setTextPopOpen}
        >
          <Button
            size="small"
            icon={<EditOutlined />}
            type={placingText ? "primary" : "default"}
            disabled={!img}
          >
            {placingText ? "点击画布放置…" : "文本标注"}
          </Button>
        </Popover>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Tooltip title="保存标注图 PNG">
            <Button
              size="small"
              icon={<DownloadOutlined />}
              disabled={!img}
              loading={exporting}
              onClick={exportImage}
            />
          </Tooltip>
          <Tooltip title="保存分析数据 JSON">
            <Button
              size="small"
              icon={<FileTextOutlined />}
              disabled={!img || !isTauri()}
              loading={exporting}
              onClick={exportJson}
            />
          </Tooltip>
        </div>
      </div>

      {/* 主区：画布 + 结果 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 8 }}>
        <div
          ref={wrapRef}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            flex: 1,
            minWidth: 0,
            background: dragOver ? "#f0f7ff" : "#fafafa",
            border: `1px solid ${dragOver ? "#91caff" : "#f0f0f0"}`,
            borderRadius: 8,
            ...(img && !autoFit
              ? { display: "block", overflow: "auto" }
              : {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }),
          }}
        >
          {img ? (
            <canvas
              ref={canvasRef}
              width={natural.w}
              height={natural.h}
              onClick={handleCanvasClick}
              style={
                autoFit
                  ? {
                      width: fitSize?.w ?? 0,
                      height: fitSize?.h ?? 0,
                      display: "block",
                      cursor: placingText ? "text" : "crosshair",
                    }
                  : {
                      width: Math.round(natural.w * scale),
                      height: "auto",
                      display: "block",
                      cursor: placingText ? "text" : "crosshair",
                    }
              }
            />
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1,
                alignSelf: "stretch",
                margin: 16,
                border: `2px dashed ${dragOver ? "#1677ff" : "#d9d9d9"}`,
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: dragOver ? "#e6f4ff" : "#fcfcfc",
                transition: "all 0.15s",
              }}
            >
              <FileImageOutlined
                style={{ fontSize: 44, color: "#1677ff", marginBottom: 12 }}
              />
              <div style={{ fontSize: 15, fontWeight: 500 }}>
                点击或拖拽上传靶纸图片
              </div>
              <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
                支持 JPG / PNG · 上传后可先做「裁剪标定」框选靶纸
              </div>
            </div>
          )}
        </div>

        {/* 结果区 */}
        <div
          style={{
            width: 208,
            flexShrink: 0,
            overflow: "auto",
            background: "#fff",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 10 }}>
            <AimOutlined style={{ color: "#1677ff", marginRight: 6 }} />
            分析结果
          </div>
          <div
            style={{
              background: "#f0f7ff",
              border: "1px solid #d6e4ff",
              borderRadius: 8,
              padding: "6px 12px",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "#666" }}>已标记点数</div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "#1677ff",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.3,
              }}
            >
              {points.length}
            </div>
          </div>
          <MetricRow
            label="平均环数"
            color={COLORS.ring}
            value={analysis ? analysis.score.toFixed(2) : "-"}
          />
          <MetricRow
            label="平均散布距离"
            color="#1677ff"
            value={analysis ? analysis.avgDist.toFixed(1) : "-"}
            unit="mm"
          />
          <MetricRow
            label="最小包围圆半径"
            color={COLORS.mec}
            value={analysis ? (analysis.mec.radius * mmPerPx).toFixed(1) : "-"}
            unit="mm"
          />
          <Divider style={{ margin: "8px 0" }} />
          <div style={{ fontSize: 12, color: "#999", marginBottom: 2 }}>
            装甲命中率
          </div>
          <MetricRow
            label="小装甲"
            color={COLORS.small}
            value={analysis ? (analysis.hitSmall * 100).toFixed(1) : "-"}
            unit="%"
          />
          <MetricRow
            label="大装甲"
            color={COLORS.large}
            value={analysis ? (analysis.hitLarge * 100).toFixed(1) : "-"}
            unit="%"
          />
          <MetricRow
            label="飞镖"
            color={COLORS.dart}
            value={analysis ? (analysis.hitDart * 100).toFixed(1) : "-"}
            unit="%"
          />
        </div>
      </div>

      <CropModal
        open={cropOpen}
        img={img}
        paper={paper}
        onPaperChange={setPaper}
        onCancel={() => setCropOpen(false)}
        onConfirm={(image, spec) => {
          setImg(image);
          setImgDataUrl(compressImage(image));
          setEffSpec(spec);
          setCropped(true);
          setPoints([]);
          setTexts([]);
          setCropOpen(false);
          setAutoFit(true);
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = "";
        }}
      />
    </Card>
  );
}
