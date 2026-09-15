import { useEffect, useRef, useState } from "react";
import { Modal, Segmented, Select, Space } from "antd";

export interface PaperSpec {
  name: string;
  w: number;
  h: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_W = 920;
const MAX_H = 480;

/** 裁剪弹窗：按所选纸张尺寸比例约束，拖拽框选靶纸区域（DOM 渲染，无 canvas 绘制时机问题） */
export default function CropModal(props: {
  open: boolean;
  img: HTMLImageElement | null;
  paper: PaperSpec;
  onPaperChange: (p: PaperSpec) => void;
  onCancel: () => void;
  onConfirm: (img: HTMLImageElement, effSpec: PaperSpec) => void;
}) {
  const { img, paper } = props;
  const [rect, setRect] = useState<Rect | null>(null);
  const [landscape, setLandscape] = useState(true);
  const dragAnchor = useRef<{ x: number; y: number } | null>(null);

  const iw = img?.naturalWidth ?? 0;
  const ih = img?.naturalHeight ?? 0;
  const fit = iw > 0 ? Math.min(MAX_W / iw, MAX_H / ih, 1) : 1;
  const cw = Math.round(iw * fit);
  const ch = Math.round(ih * fit);
  // 横向时纸张宽高互换
  const ratio = landscape ? paper.h / paper.w : paper.w / paper.h;

  // 打开或切换方向时重置选区
  useEffect(() => {
    if (props.open) setRect(null);
  }, [props.open, img, landscape]);

  const wrapPos = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), cw),
      y: Math.min(Math.max(e.clientY - r.top, 0), ch),
    };
  };

  const handleDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = wrapPos(e);
    dragAnchor.current = p;
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = dragAnchor.current;
    if (!a) return;
    const p = wrapPos(e);
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    // 以横向拖动距离驱动宽，高按纸张比例
    let w = Math.abs(dx);
    let h = w / ratio;
    // 竖直方向不足时，以竖直距离驱动
    if (Math.abs(dy) * ratio > w) {
      h = Math.abs(dy);
      w = h * ratio;
    }
    let x = dx >= 0 ? a.x : a.x - w;
    let y = dy >= 0 ? a.y : a.y - h;
    // 边界收缩（保持比例）
    if (x < 0) {
      w += x;
      x = 0;
      h = w / ratio;
    }
    if (y < 0) {
      h += y;
      y = 0;
      w = h * ratio;
    }
    if (x + w > cw) {
      w = cw - x;
      h = w / ratio;
    }
    if (y + h > ch) {
      h = ch - y;
      w = h * ratio;
    }
    setRect({ x, y, w, h });
  };

  const handleUp = () => {
    dragAnchor.current = null;
  };

  const handleConfirm = () => {
    if (!img || !rect || rect.w < 4 || rect.h < 4) return;
    const sx = Math.round(rect.x / fit);
    const sy = Math.round(rect.y / fit);
    const sw = Math.round(rect.w / fit);
    const sh = Math.round(rect.h / fit);
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const out = new Image();
    // 回传有效物理尺寸（横向时宽高互换），供 mm/px 标定
    const effSpec: PaperSpec = landscape
      ? { name: `${paper.name}·横向`, w: paper.h, h: paper.w }
      : { ...paper };
    out.onload = () => props.onConfirm(out, effSpec);
    out.src = off.toDataURL("image/png");
  };

  return (
    <Modal
      title="裁剪标定：框选靶纸区域"
      open={props.open}
      onCancel={props.onCancel}
      onOk={handleConfirm}
      okText="确认裁剪"
      cancelText="取消"
      okButtonProps={{ disabled: !rect || rect.w < 4 || rect.h < 4 }}
      width={MAX_W + 56}
      destroyOnHidden
    >
      <Space style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#888" }}>纸张尺寸</span>
        <Select
          size="small"
          value={
            ["A4", "A5", "A3", "Letter", "Legal"].find(
              (n) => paper.name === n || paper.name.startsWith(n + "·")
            ) ?? "A4"
          }
          style={{ width: 190 }}
          onChange={(name) => {
            const p = [
              { name: "A4", w: 210, h: 297 },
              { name: "A5", w: 148, h: 210 },
              { name: "A3", w: 297, h: 420 },
              { name: "Letter", w: 216, h: 279 },
              { name: "Legal", w: 216, h: 356 },
            ].find((x) => x.name === name);
            if (p) props.onPaperChange(p);
          }}
          options={[
            { value: "A4", label: "A4（210×297 mm）" },
            { value: "A5", label: "A5（148×210 mm）" },
            { value: "A3", label: "A3（297×420 mm）" },
            { value: "Letter", label: "Letter（216×279 mm）" },
            { value: "Legal", label: "Legal（216×356 mm）" },
          ]}
        />
        <Segmented
          size="small"
          value={landscape ? "landscape" : "portrait"}
          onChange={(v) => setLandscape(v === "landscape")}
          options={[
            { label: "竖向", value: "portrait" },
            { label: "横向", value: "landscape" },
          ]}
        />
        <span style={{ fontSize: 12, color: "#aaa" }}>
          按住拖拽框选（按比例约束）
        </span>
      </Space>
      {img && (
        <div
          style={{
            position: "relative",
            width: cw,
            height: ch,
            background: "#fafafa",
            borderRadius: 6,
            overflow: "hidden",
            cursor: "crosshair",
            userSelect: "none",
          }}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
        >
          <img
            src={img.src}
            alt="靶纸"
            width={cw}
            height={ch}
            draggable={false}
            style={{ display: "block", pointerEvents: "none" }}
          />
          {rect && rect.w > 1 && rect.h > 1 && (
            <div
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                border: "2px solid #1677ff",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
