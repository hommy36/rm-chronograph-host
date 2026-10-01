import { describe, expect, it } from "vitest";
import {
  buildCompareCsv,
  compareDispersion,
  compareStatsRows,
  compareWheelRows,
  equalScaleRanges,
  groupDispersion,
  pairedHistogram,
  recenterToMean,
} from "./compare";
import type { Group, WaveConfig } from "./types";
import { EMPTY_PARAMS } from "./types";
import type { WaveSnapshot } from "./wave";

const CFG: WaveConfig = {
  groups: [
    { id: 1, name: "一级", channels: [0, 2] },
    { id: 2, name: "二级", channels: [1, 3] },
  ],
  channelLabels: { 0: "一1", 1: "二1", 2: "一2", 3: "二2" },
};

function snap(t0: number, depth: number): WaveSnapshot {
  const times: number[] = [];
  for (let t = -200; t <= 1000; t += 10) times.push(t);
  const mk = (base: number, d: number) =>
    times.map((t) => (t < 0 ? base : base - d * (t / 120) * Math.exp(1 - t / 120)));
  return {
    t0,
    times,
    channels: [mk(4000, depth), mk(4800, depth / 2), mk(4000, depth * 0.9), mk(4800, depth / 2)],
  };
}

function group(id: number, name: string, speeds: number[], depth: number | null): Group {
  const t0 = 1_700_000_000_000;
  return {
    id,
    name,
    params: { ...EMPTY_PARAMS },
    startedAt: t0,
    shots: speeds.map((v, i) => ({
      idx: i + 1,
      speed_mps: v,
      dt_us: 3200,
      at_ms: t0 + i * 1000,
      wave: depth === null ? undefined : snap(t0 + i * 1000, depth),
    })),
  };
}

describe("compareStatsRows", () => {
  it("给出两组指标与差值", () => {
    const a = group(1, "A", [15.0, 15.2, 15.1], null);
    const b = group(2, "B", [15.1, 15.3, 15.2], null);
    const rows = compareStatsRows(a, b);
    const mean = rows.find((r) => r.label.startsWith("均值"))!;
    expect(mean.a).toBeCloseTo(15.1, 6);
    expect(mean.b).toBeCloseTo(15.2, 6);
    expect(mean.diff).toBeCloseTo(0.1, 6);
    const n = rows.find((r) => r.label === "样本数")!;
    expect(n.a).toBe(3);
    expect(n.diff).toBe(0);
  });

  it("空组不崩", () => {
    const rows = compareStatsRows(group(1, "A", [], null), group(2, "B", [], null));
    const mean = rows.find((r) => r.label.startsWith("均值"))!;
    expect(mean.a).toBeNull();
    expect(mean.diff).toBeNull();
  });
});

describe("pairedHistogram", () => {
  it("两组共用分箱且总数守恒", () => {
    const h = pairedHistogram([15.0, 15.5, 16.0], [15.2, 15.6], 5);
    expect(h.centers).toHaveLength(5);
    expect(h.a.reduce((x, y) => x + y, 0)).toBe(3);
    expect(h.b.reduce((x, y) => x + y, 0)).toBe(2);
  });

  it("全同值时退化为一箱", () => {
    const h = pairedHistogram([15, 15], [15], 5);
    expect(h.centers).toHaveLength(1);
    expect(h.a[0]).toBe(2);
    expect(h.b[0]).toBe(1);
  });
});

describe("compareWheelRows", () => {
  it("统计各组平均掉速%与轮间差", () => {
    const a = group(1, "A", [15, 15], 400);
    const b = group(2, "B", [15, 15], 200);
    const rows = compareWheelRows(a, b, CFG);
    expect(rows).toHaveLength(2);
    const s1 = rows[0];
    expect(s1.name).toBe("一级");
    expect(s1.aDrop!).toBeGreaterThan(s1.bDrop!); // A 掉速更深
    expect(s1.aSpread!).toBeGreaterThan(0);
    expect(s1.aShots).toBe(2);
  });

  it("无波形数据时为 null", () => {
    const rows = compareWheelRows(group(1, "A", [15], null), group(2, "B", [15], null), CFG);
    expect(rows[0].aDrop).toBeNull();
    expect(rows[0].aShots).toBe(0);
  });
});

describe("groupDispersion / compareDispersion", () => {
  /** 造一组落在 [280,220] 附近的靶纸点：A4 横向 297×210mm，图 1200×849px */
  function withDispersion(spread: number) {
    const g = group(1, "A", [15], null);
    const imgW = 1200;
    const imgH = 849;
    const mmPerPx = 297 / imgW;
    const cx = imgW / 2;
    const cy = imgH / 2;
    // 以纸面中心为原点、按 mm 偏移布置 4 个点
    const offsets = [
      [spread, 0],
      [-spread, spread / 2],
      [0, -spread],
      [0, 0],
    ];
    g.dispersion = {
      effSpec: { name: "A4·横向", w: 297, h: 210 },
      imgW,
      imgH,
      points: offsets.map(([dx, dy]) => ({
        x: cx + dx / mmPerPx,
        y: cy + dy / mmPerPx,
      })),
      texts: [],
      updatedAt: 0,
    };
    return g;
  }

  it("像素点换算到相对纸面中心的 mm", () => {
    const d = groupDispersion(withDispersion(20));
    expect(d.hasData).toBe(true);
    expect(d.n).toBe(4);
    // 点 0: 纸面中心右侧 20mm
    expect(d.pointsMm[0].x).toBeCloseTo(20, 6);
    expect(d.pointsMm[0].y).toBeCloseTo(0, 6);
    // 点 1: 左 20mm、下 10mm
    expect(d.pointsMm[1].x).toBeCloseTo(-20, 6);
    expect(d.pointsMm[1].y).toBeCloseTo(10, 6);
    // 点 2: 上 20mm
    expect(d.pointsMm[2].y).toBeCloseTo(-20, 6);
  });

  it("散布越差，平均散布距离与包围圆越大", () => {
    const tight = groupDispersion(withDispersion(10));
    const loose = groupDispersion(withDispersion(40));
    expect(loose.avgDist!).toBeGreaterThan(tight.avgDist!);
    expect(loose.mecRadius!).toBeGreaterThan(tight.mecRadius!);
    expect(tight.meanRing).not.toBeNull();
    expect(tight.hitSmall).toBeGreaterThan(0);
  });

  it("没有散布数据的组返回空", () => {
    const empty = groupDispersion(group(1, "A", [15], null));
    expect(empty.hasData).toBe(false);
    expect(empty.pointsMm).toHaveLength(0);
    const [x, y] = compareDispersion(group(1, "A", [], null), group(2, "B", [], null));
    expect(x.hasData).toBe(false);
    expect(y.hasData).toBe(false);
  });

  it("recenterToMean 把点群重心平移到原点", () => {    const shifted = recenterToMean([
      { x: 100, y: 50 },
      { x: 110, y: 60 },
      { x: 90, y: 40 },
    ]);
    const mx = shifted.reduce((a, p) => a + p.x, 0) / shifted.length;
    const my = shifted.reduce((a, p) => a + p.y, 0) / shifted.length;
    expect(mx).toBeCloseTo(0, 10);
    expect(my).toBeCloseTo(0, 10);
    // 相对形状保持不变（两点间距不变）
    expect(shifted[1].x - shifted[0].x).toBeCloseTo(10, 10);
    expect(recenterToMean([])).toEqual([]);
  });
});

describe("equalScaleRanges", () => {
  it("两轴毫米/像素严格一致（宽扁绘图区下 x 范围更宽）", () => {
    const plotW = 1000;
    const plotH = 400;
    const { limX, limY, step, splitX, splitY } = equalScaleRanges(100, plotW, plotH);
    expect((limX * 2) / plotW).toBeCloseTo((limY * 2) / plotH, 10);
    expect(limY).toBeGreaterThanOrEqual(100); // 覆盖数据
    expect(limX).toBeGreaterThan(limY);
    expect(limY % step).toBe(0); // y 取整到规整步长
    // 网格接近正方形（每格 mm 相差不超过 1 格步长带来的误差）
    const cellX = (limX * 2) / splitX;
    const cellY = (limY * 2) / splitY;
    expect(Math.abs(cellX - cellY)).toBeLessThan(step);
  });

  it("正方形绘图区时两轴范围相同", () => {
    const { limX, limY } = equalScaleRanges(80, 600, 600);
    expect(limX).toBeCloseTo(limY, 10);
  });

  it("极小散布也有合理下限", () => {
    const { limX, limY, step, splitX } = equalScaleRanges(0, 500, 500);
    expect(limY).toBeGreaterThan(0);
    expect(limX).toBeCloseTo(limY, 10);
    expect(step).toBeGreaterThan(0);
    expect(splitX).toBeGreaterThanOrEqual(1);
  });
});

describe("compareWheelRows 两组各用自己的通道分配", () => {
  it("轮组按名字对齐，缺失一侧留空", () => {
    const a = group(1, "A", [15, 15], 400);
    const b = group(2, "B", [15, 15], 200);
    const cfgA: WaveConfig = {
      groups: [{ id: 1, name: "一级", channels: [0, 2] }],
      channelLabels: {},
    };
    const cfgB: WaveConfig = {
      groups: [{ id: 1, name: "一级", channels: [0, 2] }, { id: 2, name: "二级", channels: [1, 3] }],
      channelLabels: {},
    };
    const rows = compareWheelRows(a, b, cfgA, cfgB);
    expect(rows.map((r) => r.name)).toEqual(["一级", "二级"]);
    expect(rows[0].aDrop).not.toBeNull();
    expect(rows[0].bDrop).not.toBeNull();
    // B 侧没有"二级"以外的问题：A 侧没有二级 → aDrop 为空
    expect(rows[1].aDrop).toBeNull();
    expect(rows[1].bDrop).not.toBeNull();
  });
});

describe("buildCompareCsv", () => {  it("包含指标、轮组与直方图分箱", () => {
    const csv = buildCompareCsv(group(1, "A", [15, 15.2], 400), group(2, "B", [15.1, 15.3], 200), CFG);
    expect(csv).toContain("指标,A(A),B(B),差值(B-A)");
    expect(csv).toContain("差值(B-A)");
    expect(csv).toContain("平均掉速%");
    expect(csv).toContain("箱中心(m/s),A 频数,B 频数");
    expect(csv.startsWith("\ufeff")).toBe(true);
  });
});
