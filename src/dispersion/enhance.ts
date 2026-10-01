/**
 * 靶纸图像增强：让白纸上的浅色弹着印记变得明显。
 * 思路是"点运算 + 高频提升"两步：
 *   1) 亮度/对比度/灰度/反相 —— 用 canvas filter 交给 GPU，几乎零成本；
 *   2) 局部对比（背景减除）+ 锐化 —— 用大/小半径模糊作低频，按差值放大高频，
 *      这才是把浅灰色印记从纸面纹理里拉出来的关键。
 * 纯像素部分抽成纯函数，便于单测。
 */

export interface EnhanceParams {
  /** 是否启用增强（关闭时直接用原图） */
  on: boolean;
  /** 亮度倍数，1 = 原样 */
  brightness: number;
  /** 对比度倍数，1 = 原样 */
  contrast: number;
  /** 局部对比（背景减除）强度，0 = 关 */
  local: number;
  /** 锐化强度，0 = 关 */
  sharpen: number;
  /** 转灰度 */
  gray: boolean;
  /** 反相（深底浅痕时好用） */
  invert: boolean;
}

export const DEFAULT_ENHANCE: EnhanceParams = {
  on: false,
  brightness: 1,
  contrast: 1,
  local: 0,
  sharpen: 0,
  gray: false,
  invert: false,
};

/** 预设：落点增强（浅色印记在纸面上最明显的一组参数） */
export const PRESET_HITS: EnhanceParams = {
  on: true,
  brightness: 1.02,
  contrast: 1.35,
  local: 1.6,
  sharpen: 0.5,
  gray: true,
  invert: false,
};

/** 大半径模糊半径：约短边的 1/40，用于估计纸面背景亮度 */
export function localBlurRadius(w: number, h: number): number {
  return Math.max(8, Math.round(Math.min(w, h) / 40));
}

/** 小半径模糊半径：细节高频 */
export const SHARP_BLUR_RADIUS = 1.5;

/**
 * 高频提升（原地修改 RGBA）。
 * out = src + local * (src - lowLocal) + sharpen * (src - lowSharp)
 * 两个低频数组可为 null 表示该项关闭。
 */
export function applyHighPass(
  src: Uint8ClampedArray,
  lowLocal: Uint8ClampedArray | null,
  lowSharp: Uint8ClampedArray | null,
  local: number,
  sharpen: number,
  /** 只处理前 channels 个通道（灰度图只处理 R 即可省时间） */
  channels = 3
): void {
  const n = src.length;
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < channels; c++) {
      let v = src[i + c];
      if (lowLocal) v += (v - lowLocal[i + c]) * local;
      if (lowSharp) v += (v - lowSharp[i + c]) * sharpen;
      src[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

/**
 * 把某个通道的值复制到其余通道（灰度图只处理了 R 通道，需同步到 G/B，
 * 否则高频提升只加在红色分量上会出现青/品红偏色）。
 */
export function replicateChannel(data: Uint8ClampedArray, from = 0): void {
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i + from];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

/** 是否无需处理（未启用，或参数全为中性）——可直接用原图 */
export function isNoopEnhance(p: EnhanceParams): boolean {
  return (
    !p.on ||
    (p.brightness === 1 &&
      p.contrast === 1 &&
      p.local === 0 &&
      p.sharpen === 0 &&
      !p.gray &&
      !p.invert)
  );
}
