import { describe, expect, it } from "vitest";
import {
  buildCompareCsv,
  compareStatsRows,
  compareWheelRows,
  pairedHistogram,
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

describe("buildCompareCsv", () => {
  it("包含指标、轮组与直方图分箱", () => {
    const csv = buildCompareCsv(group(1, "A", [15, 15.2], 400), group(2, "B", [15.1, 15.3], 200), CFG);
    expect(csv).toContain("指标,A(A),B(B),差值(B-A)");
    expect(csv).toContain("差值(B-A)");
    expect(csv).toContain("平均掉速%");
    expect(csv).toContain("箱中心(m/s),A 频数,B 频数");
    expect(csv.startsWith("\ufeff")).toBe(true);
  });
});
