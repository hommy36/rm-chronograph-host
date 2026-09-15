/**
 * 散布分析核心算法（纯函数，vitest 覆盖）。
 * 参考 MicDZ/RM-Ballistic-Analysis 的 analyze.py：
 * 平均弹着点、9 环计分、平均散布距离、三种装甲命中率、最小包围圆。
 * 坐标均为图像像素；mm 换算由调用方传入 mmPerPx。
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Circle {
  center: Pt;
  radius: number;
}

/** 装甲板尺寸（mm），与 MicDZ analyze.py 一致 */
export const ARMOR = {
  small: { w: 135, h: 125 },
  large: { w: 230, h: 127 },
  dart: { w: 140, h: 140 },
} as const;

/** 环宽（mm）：MicDZ 取 50px@750px 宽 A4 图 ≈ 14mm */
export const RING_WIDTH_MM = 14;
/** 环数：1~9 环，环内分值 10~2，出 9 环计 0 */
export const RING_COUNT = 9;

export function meanPoint(points: Pt[]): Pt | null {
  if (points.length === 0) return null;
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  return { x: sx / points.length, y: sy / points.length };
}

/** 单发环数：1 环（最内）10 分 … 9 环 2 分，出 9 环 0 分 */
export function pointRingScore(distMm: number): number {
  const ring = Math.ceil(distMm / RING_WIDTH_MM);
  if (ring < 1) return 10; // 圆心处
  if (ring > RING_COUNT) return 0;
  return 11 - ring;
}

/** 平均环数 */
export function score(points: Pt[], center: Pt, mmPerPx: number): number | null {
  if (points.length === 0) return null;
  const total = points.reduce((a, p) => {
    const dMm = Math.hypot(p.x - center.x, p.y - center.y) * mmPerPx;
    return a + pointRingScore(dMm);
  }, 0);
  return total / points.length;
}

/** 平均散布距离（各点到中心的平均距离，mm） */
export function avgDistance(
  points: Pt[],
  center: Pt,
  mmPerPx: number
): number | null {
  if (points.length === 0) return null;
  const total = points.reduce(
    (a, p) => a + Math.hypot(p.x - center.x, p.y - center.y) * mmPerPx,
    0
  );
  return total / points.length;
}

/** 装甲命中率（0~1）：框以 center 为中心，尺寸 w×h（mm） */
export function hitRate(
  points: Pt[],
  center: Pt,
  armor: { w: number; h: number },
  mmPerPx: number
): number | null {
  if (points.length === 0) return null;
  const hw = armor.w / mmPerPx / 2;
  const hh = armor.h / mmPerPx / 2;
  const hits = points.filter(
    (p) =>
      p.x >= center.x - hw &&
      p.x <= center.x + hw &&
      p.y >= center.y - hh &&
      p.y <= center.y + hh
  ).length;
  return hits / points.length;
}

function circle2(a: Pt, b: Pt): Circle {
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    radius: Math.hypot(a.x - b.x, a.y - b.y) / 2,
  };
}

function circle3(a: Pt, b: Pt, c: Pt): Circle {
  // 三点共线时退化为最远两点的圆
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) {
    const cands = [circle2(a, b), circle2(a, c), circle2(b, c)];
    return cands.reduce((m, x) => (x.radius > m.radius ? x : m));
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux =
    (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy =
    (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return {
    center: { x: ux, y: uy },
    radius: Math.hypot(a.x - ux, a.y - uy),
  };
}

function contains(c: Circle, p: Pt): boolean {
  return Math.hypot(p.x - c.center.x, p.y - c.center.y) <= c.radius + 1e-9;
}

/** 最小包围圆（Welzl 增量法，未洗牌以保证确定性） */
export function minEnclosingCircle(points: Pt[]): Circle | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { center: { ...points[0] }, radius: 0 };

  let c = circle2(points[0], points[1]);
  for (let i = 2; i < points.length; i++) {
    if (contains(c, points[i])) continue;
    c = { center: { ...points[i] }, radius: 0 };
    for (let j = 0; j < i; j++) {
      if (contains(c, points[j])) continue;
      c = circle2(points[i], points[j]);
      for (let k = 0; k < j; k++) {
        if (contains(c, points[k])) continue;
        c = circle3(points[i], points[j], points[k]);
      }
    }
  }
  return c;
}
