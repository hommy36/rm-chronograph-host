import { describe, expect, it } from "vitest";
import {
  ARMOR,
  avgDistance,
  hitRate,
  meanPoint,
  minEnclosingCircle,
  pointRingScore,
  RING_WIDTH_MM,
  score,
} from "./math";

const MM_PER_PX = 0.28; // 210mm / 750px，A4 宽

describe("dispersion/math", () => {
  it("meanPoint：平均值", () => {
    expect(meanPoint([])).toBeNull();
    expect(meanPoint([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({
      x: 5,
      y: 10,
    });
  });

  it("pointRingScore：环数边界", () => {
    expect(pointRingScore(0)).toBe(10); // 圆心
    expect(pointRingScore(RING_WIDTH_MM)).toBe(10); // 压 1 环边
    expect(pointRingScore(RING_WIDTH_MM + 0.1)).toBe(9);
    expect(pointRingScore(9 * RING_WIDTH_MM)).toBe(2); // 压 9 环边
    expect(pointRingScore(9 * RING_WIDTH_MM + 0.1)).toBe(0); // 出 9 环
  });

  it("score：平均环数", () => {
    // 两点：圆心(10 分) + 3 环(8 分) → 平均 9
    const pts = [
      { x: 0, y: 0 },
      { x: (2.5 * RING_WIDTH_MM) / MM_PER_PX, y: 0 },
    ];
    expect(score(pts, { x: 0, y: 0 }, MM_PER_PX)).toBeCloseTo(9, 9);
    expect(score([], { x: 0, y: 0 }, MM_PER_PX)).toBeNull();
  });

  it("avgDistance：平均距离 mm", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }, // 距离 5px
    ];
    // 平均 = (0 + 5*0.28) / 2 = 0.7
    expect(avgDistance(pts, { x: 0, y: 0 }, MM_PER_PX)).toBeCloseTo(0.7, 9);
  });

  it("hitRate：框内外命中率", () => {
    // 小装甲 135×125mm → 半宽 67.5mm = 241.07px
    const center = { x: 375, y: 530 };
    const inside = { x: 375 + 100, y: 530 + 100 }; // 距中心 100px=28mm，在框内
    const outside = { x: 375 + 400, y: 530 }; // 112mm > 67.5mm，出框
    const pts = [inside, inside, outside, outside];
    expect(hitRate(pts, center, ARMOR.small, MM_PER_PX)).toBeCloseTo(0.5, 9);
    // 大装甲 230mm 半宽 115mm=410px，四点全中
    expect(hitRate(pts, center, ARMOR.large, MM_PER_PX)).toBeCloseTo(1, 9);
  });

  it("minEnclosingCircle：正方形顶点 → 外接圆", () => {
    const sq = [
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
      { x: 1, y: -1 },
    ];
    const c = minEnclosingCircle(sq)!;
    expect(c.center.x).toBeCloseTo(0, 9);
    expect(c.center.y).toBeCloseTo(0, 9);
    expect(c.radius).toBeCloseTo(Math.SQRT2, 9);
  });

  it("minEnclosingCircle：等边三角形 → 外接圆半径 side/√3", () => {
    const s = 2;
    const tri = [
      { x: 0, y: (s * Math.sqrt(3)) / 3 },
      { x: -s / 2, y: (-s * Math.sqrt(3)) / 6 },
      { x: s / 2, y: (-s * Math.sqrt(3)) / 6 },
    ];
    const c = minEnclosingCircle(tri)!;
    expect(c.center.x).toBeCloseTo(0, 9);
    expect(c.center.y).toBeCloseTo(0, 9);
    expect(c.radius).toBeCloseTo(s / Math.sqrt(3), 9);
  });

  it("minEnclosingCircle：共线点 → 端点中点圆；单点/空集", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 10, y: 0 },
    ];
    const c = minEnclosingCircle(line)!;
    expect(c.center.x).toBeCloseTo(5, 9);
    expect(c.radius).toBeCloseTo(5, 9);

    expect(minEnclosingCircle([{ x: 3, y: 4 }])!.radius).toBe(0);
    expect(minEnclosingCircle([])).toBeNull();
  });
});
