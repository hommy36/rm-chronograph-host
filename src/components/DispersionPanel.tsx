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
  Slider,
  Space,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import {
  AimOutlined,
  BulbOutlined,
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
import {
  applyHighPass,
  DEFAULT_ENHANCE,
  isNoopEnhance,
  localBlurRadius,
  PRESET_HITS,
  replicateChannel,
  SHARP_BLUR_RADIUS,
  type EnhanceParams,
} from "../dispersion/enhance";
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

/** 用压缩后的图作为工作图：保证内存坐标与存盘坐标一致（否则重开后标点会偏移） */
function loadAsCompressed(
  image: HTMLImageElement
): Promise<{ img: HTMLImageElement; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const dataUrl = compressImage(image);
    const out = new Image();
    out.onload = () => resolve({ img: out, dataUrl });
    out.onerror = () => reject(new Error("图片处理失败"));
    out.src = dataUrl;
  });
}

/** 增强面板里的单行滑块 */
function EnhanceRow(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 12,
          color: "#666",
          display: "flex",
          justifyContent: "space-between",
          lineHeight: "18px",
        }}
      >
        <Tooltip title={props.hint}>
          <span>{props.label}</span>
        </Tooltip>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {props.value.toFixed(2)}
        </span>
      </div>
      <Slider
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={props.onChange}
        style={{ margin: "2px 0 0" }}
      />
    </div>
  );
}

/**
 * 生成增强后的离屏画布（与原图同尺寸，保证标点坐标一一对应）。
 * 亮度/对比度/灰度/反相用 canvas filter 交给 GPU；
 * 局部对比与锐化用"模糊作低频 + 高频提升"，把浅色印记从纸面里拉出来。
 */
function buildEnhanced(
  image: HTMLImageElement,
  p: EnhanceParams
): HTMLCanvasElement | null {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w === 0 || h === 0) return null;
  const base = document.createElement("canvas");
  base.width = w;
  base.height = h;
  const ctx = base.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const filters: string[] = [];
  if (p.brightness !== 1) filters.push(`brightness(${p.brightness})`);
  if (p.contrast !== 1) filters.push(`contrast(${p.contrast})`);
  if (p.gray) filters.push("grayscale(1)");
  if (p.invert) filters.push("invert(1)");
  ctx.filter = filters.length > 0 ? filters.join(" ") : "none";
  ctx.drawImage(image, 0, 0);
  ctx.filter = "none";

  if (p.local > 0 || p.sharpen > 0) {
    const blurredData = (radius: number): Uint8ClampedArray => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d")!;
      cx.filter = `blur(${radius}px)`;
      cx.drawImage(base, 0, 0);
      return cx.getImageData(0, 0, w, h).data;
    };
    const imgData = ctx.getImageData(0, 0, w, h);
    const lowLocal = p.local > 0 ? blurredData(localBlurRadius(w, h)) : null;
    const lowSharp = p.sharpen > 0 ? blurredData(SHARP_BLUR_RADIUS) : null;
    // 灰度图只需处理 R 通道，省 2/3 时间；随后把 R 复制到 G/B 避免偏色
    applyHighPass(
      imgData.data,
      lowLocal,
      lowSharp,
      p.local,
      p.sharpen,
      p.gray ? 1 : 3
    );
    if (p.gray) replicateChannel(imgData.data, 0);
    ctx.putImageData(imgData, 0, 0);
  }
  return base;
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

/** 绘制源：原图或增强后的离屏画布 */
type ImgSource = HTMLImageElement | HTMLCanvasElement;

/** 绘制源像素宽度（画布与图片的宽度取法不同） */
function srcWidth(s: ImgSource): number {
  return s instanceof HTMLCanvasElement ? s.width : s.naturalWidth;
}

/** 场景绘制：图像 + 弹孔 + （可选）分析叠加 + 文字（图像像素坐标系） */
function drawScene(
  ctx: CanvasRenderingContext2D,
  img: ImgSource,
  points: Pt[],
  texts: TextMark[],
  analysis: Analysis | null,
  mmPerPx: number,
  showOverlay: boolean
) {
  ctx.drawImage(img, 0, 0);
  const fontPx = Math.max(12, Math.round(srcWidth(img) / 60));

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
  const [enhanceOpen, setEnhanceOpen] = useState(false);
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
  /** 图片原始像素尺寸：独立保存，避免图片未就绪时写回把已有标定尺寸抹掉 */
  const [imgNatural, setImgNatural] = useState<
    { w: number; h: number } | undefined
  >(undefined);
  /** 图像增强参数（随组保存） */
  const [enhance, setEnhance] = useState<EnhanceParams>({ ...DEFAULT_ENHANCE });
  /** 增强后的离屏画布（原图尺寸），未启用/处理中为 null */
  const [enhanced, setEnhanced] = useState<HTMLCanvasElement | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  /** 正在从组数据载入，避免载入过程反过来触发写回 */
  const loadingRef = useRef(false);
  /** 该组是否已完成一次数据同步（同步后的首个提交不回写，避免用初始空状态覆盖组数据） */
  const readyRef = useRef(false);
  /** 图片是否已加载完成（加载前不回写，避免把过期尺寸/空点写回组里） */
  const imgLoadedRef = useRef(false);

  // 组切换：把该组已存的散布数据载入到面板
  useEffect(() => {
    loadingRef.current = true;
    readyRef.current = false;
    imgLoadedRef.current = false;
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
    setImgNatural(d?.imgW && d.imgH ? { w: d.imgW, h: d.imgH } : undefined);
    setEnhance(d?.enhance ? { ...DEFAULT_ENHANCE, ...d.enhance } : { ...DEFAULT_ENHANCE });
    if (d?.imageDataUrl) {
      const image = new Image();
      image.onload = () => {
        const lw = image.naturalWidth;
        const lh = image.naturalHeight;
        // 标点总是标在"当时显示的那张图"上，所以坐标通常就是当前图的像素坐标；
        // 但历史上 imgW 可能是过期值（旧版切组后没更新图片尺寸），此时不能盲目缩放。
        // 判据：若有点明显超出当前画布，说明坐标确实来自更大的原图空间 → 按比例缩放；
        // 否则只把 imgW/imgH 更正为当前图尺寸，坐标保持不动。
        const recW = d.imgW;
        const pts = d.points ?? [];
        const outX = pts.some((p) => p.x > lw * 1.02);
        const outY = pts.some((p) => p.y > lh * 1.02);
        // 只有"确实有点超出画布"才缩放；变换一律基于组里存的原始快照计算
        // （而不是当前界面状态），因此 effect 被重复执行也不会叠加缩放
        if (recW && recW !== lw && (outX || outY)) {
          const k = lw / recW;
          setPoints(pts.map((p) => ({ x: p.x * k, y: p.y * k })));
          setTexts((d.texts ?? []).map((t) => ({ ...t, x: t.x * k, y: t.y * k })));
        }
        setImgNatural({ w: lw, h: lh });
        imgLoadedRef.current = true;
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

  // 同步完成的提交可能是"初始状态"那一帧，等下一帧再允许回写
  useEffect(() => {
    if (!readyRef.current) {
      const t = window.setTimeout(() => {
        readyRef.current = true;
      }, 0);
      return () => clearTimeout(t);
    }
  }, [points, texts, enhance, imgDataUrl]);

  // 图像增强：参数或原图变化后重建离屏画布（300ms 去抖，处理时给出提示）
  useEffect(() => {
    if (!img || isNoopEnhance(enhance)) {
      setEnhanced(null);
      setEnhancing(false);
      return;
    }
    setEnhancing(true);
    const timer = window.setTimeout(() => {
      try {
        setEnhanced(buildEnhanced(img, enhance));
      } catch {
        setEnhanced(null);
      } finally {
        setEnhancing(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      setEnhancing(false);
    };
  }, [img, enhance]);

  // 任何编辑都写回当前组（300ms 去抖）
  useEffect(() => {
    if (!groupId || loadingRef.current || !readyRef.current) return;
    if (imgDataUrl && !imgLoadedRef.current) return; // 图还没就绪，别写回
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
              imgW: imgNatural?.w,
              imgH: imgNatural?.h,
              enhance: { ...enhance },
              updatedAt: Date.now(),
            }
      );
    }, 300);
    return () => clearTimeout(t);
  }, [groupId, imgNatural, imgDataUrl, effSpec, points, texts, enhance, setGroupDispersion]);

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
    drawScene(ctx, enhanced ?? img, points, texts, analysis, mmPerPx, showOverlay);
  }, [img, enhanced, points, texts, analysis, natural.w, natural.h, mmPerPx, showOverlay]);

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const image = new Image();
      image.onload = async () => {
        try {
          const { img: work, dataUrl } = await loadAsCompressed(image);
          setImg(work);
          setImgDataUrl(dataUrl);
          setImgNatural({ w: work.naturalWidth, h: work.naturalHeight });
          imgLoadedRef.current = true;
          setCropped(false);
          setPoints([]);
          setTexts([]);
          setAutoFit(true);
        } catch {
          message.error("图片处理失败");
        }
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

  // Ctrl+V 直接粘贴图片（Win+Shift+S 截图后最顺手）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            loadFile(f);
            message.success("已从剪贴板载入图片");
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // loadFile 依赖当前面板状态，这里只在挂载时注册
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      drawScene(ctx, enhanced ?? img, points, texts, analysis, mmPerPx, showOverlay);
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

  const enhanceControls = (
    <div style={{ width: 272 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Switch
          size="small"
          checked={enhance.on}
          onChange={(v) => setEnhance((e) => ({ ...e, on: v }))}
        />
        <span style={{ fontSize: 12 }}>启用增强（不影响原图与标定）</span>
      </div>
      <EnhanceRow
        label="亮度"
        value={enhance.brightness}
        min={0.5}
        max={1.5}
        step={0.01}
        onChange={(v) => setEnhance((e) => ({ ...e, brightness: v }))}
      />
      <EnhanceRow
        label="对比度"
        value={enhance.contrast}
        min={0.5}
        max={3}
        step={0.05}
        onChange={(v) => setEnhance((e) => ({ ...e, contrast: v }))}
      />
      <EnhanceRow
        label="局部对比"
        hint="把浅色落点从纸面纹理里拉出来"
        value={enhance.local}
        min={0}
        max={3}
        step={0.1}
        onChange={(v) => setEnhance((e) => ({ ...e, local: v }))}
      />
      <EnhanceRow
        label="锐化"
        value={enhance.sharpen}
        min={0}
        max={2}
        step={0.1}
        onChange={(v) => setEnhance((e) => ({ ...e, sharpen: v }))}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          margin: "6px 0 10px",
        }}
      >
        <label
          style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
        >
          灰度
          <Switch
            size="small"
            checked={enhance.gray}
            onChange={(v) => setEnhance((e) => ({ ...e, gray: v }))}
          />
        </label>
        <label
          style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
        >
          反相
          <Switch
            size="small"
            checked={enhance.invert}
            onChange={(v) => setEnhance((e) => ({ ...e, invert: v }))}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          size="small"
          type="primary"
          onClick={() => setEnhance({ ...PRESET_HITS })}
        >
          落点增强
        </Button>
        <Button
          size="small"
          onClick={() => setEnhance({ ...DEFAULT_ENHANCE, on: true })}
        >
          重置
        </Button>
      </div>
      <div style={{ fontSize: 11, color: "#999", marginTop: 8, lineHeight: 1.5 }}>
        「局部对比」是让浅色落点变明显的关键；纸面纹理较重时调低它、提高「对比度」。
      </div>
    </div>
  );

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
          {enhancing ? (
            <Tag color="processing">增强处理中…</Tag>
          ) : (
            enhanced && <Tag color="geekblue">增强已应用</Tag>
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
        <Popover
          content={enhanceControls}
          trigger="click"
          placement="bottomLeft"
          open={enhanceOpen}
          onOpenChange={setEnhanceOpen}
        >
          <Tooltip title="图像增强：把白纸上的浅色弹着印记调明显">
            <Button
              size="small"
              icon={<BulbOutlined />}
              disabled={!img}
              type={enhance.on ? "primary" : "default"}
              loading={enhancing}
            >
              图像增强
            </Button>
          </Tooltip>
        </Popover>
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
                点击 / 拖拽 / Ctrl+V 粘贴上传靶纸图片
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
        onConfirm={async (image, spec) => {
          setCropOpen(false);
          try {
            const { img: work, dataUrl } = await loadAsCompressed(image);
            setImg(work);
            setImgDataUrl(dataUrl);
            setImgNatural({ w: work.naturalWidth, h: work.naturalHeight });
            imgLoadedRef.current = true;
            setEffSpec(spec);
            setCropped(true);
            setPoints([]);
            setTexts([]);
            setAutoFit(true);
          } catch {
            message.error("裁剪结果处理失败");
          }
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
