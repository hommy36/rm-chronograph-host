import { describe, expect, it } from "vitest";
import type { Group } from "./types";
import {
  alignedProfile,
  bootstrapDiff,
  correlate,
  crossGroupSeries,
  crossGroupStats,
  driftTrend,
  oneSampleT,
  dispersionGeometry,
  groupSummary,
  hotGunDelta,
  intervalStats,
  lowRuns,
  outliers,
  parseParam,
  passRate,
  tCritical95,
  tTwoTailedP,
  trendSlope,
  welchTTest,
} from "./analysis";
import { EMPTY_PARAMS } from "./types";

describe("parseParam", () => {
  it("取第一个数字", () => {
    expect(parseParam("5200")).toBe(5200);
    expect(parseParam("50a")).toBe(50);
    expect(parseParam("34.7")).toBeCloseTo(34.7, 6);
    expect(parseParam("0.0002, 0.0, 0.0000003")).toBeCloseTo(0.0002, 9);
  });
  it("没数字返回 null", () => {
    expect(parseParam("")).toBeNull();
    expect(parseParam(undefined)).toBeNull();
    expect(parseParam("无")).toBeNull();
  });
});

describe("outliers / lowRuns", () => {
  const base = [15.0, 15.1, 15.05, 15.02, 15.08, 15.03, 15.06, 15.01];
  it("识别明显离群发", () => {
    const v = [...base, 14.0];
    const o = outliers(v);
    expect(o).toHaveLength(1);
    expect(o[0].idx).toBe(9);
    expect(o[0].z).toBeLessThan(-2.5);
  });
  it("无离群时为空", () => {
    expect(outliers([15.0, 15.01, 14.99, 15.0])).toEqual([]);
  });
  it("识别连续偏低段", () => {
    const v = [15.5, 15.5, 15.5, 13.2, 13.2, 15.5, 15.5, 15.5];
    const runs = lowRuns(v, 1.2, 2);
    expect(runs).toHaveLength(1);
    expect(runs[0].from).toBe(4);
    expect(runs[0].to).toBe(5);
  });
});

describe("趋势 / 热枪 / 节奏 / 达标率", () => {
  it("完美线性序列斜率为每发增量", () => {
    expect(trendSlope([10, 11, 12, 13, 14])).toBeCloseTo(1, 10);
    expect(trendSlope([14, 13, 12, 11])).toBeCloseTo(-1, 10);
  });
  it("点太少返回 null", () => {
    expect(trendSlope([1, 2])).toBeNull();
  });
  it("热枪效应 = 后3发 − 前3发", () => {
    expect(hotGunDelta([10, 10, 10, 12, 12, 12])).toBeCloseTo(2, 10);
    expect(hotGunDelta([10, 10])).toBeNull();
  });
  it("发间隔统计", () => {
    const iv = intervalStats([0, 1000, 2000, 5000])!;
    expect(iv.median).toBeCloseTo(1, 6);
    expect(iv.max).toBeCloseTo(3, 6);
  });
  it("达标率含边界", () => {
    // 目标 15.0，±1% 即 [14.85, 15.15]
    expect(passRate([15.0, 15.15, 15.16], 15, 1)).toBeCloseTo(2 / 3, 6);
    expect(passRate([], 15, 1)).toBeNull();
    expect(passRate([15], null, 1)).toBeNull();
  });
});

describe("dispersionGeometry", () => {
  it("偏移、Cx/Cy、R50 计算正确", () => {
    const pts = [
      { x: 10, y: 0 },
      { x: -10, y: 0 },
      { x: 0, y: 5 },
      { x: 0, y: -5 },
    ];
    const g = dispersionGeometry(pts)!;
    expect(g.n).toBe(4);
    expect(g.dx).toBeCloseTo(0, 9);
    expect(g.dy).toBeCloseTo(0, 9);
    // 样本标准差：x 方向 sqrt((100+100+0+0)/3)
    expect(g.cx).toBeCloseTo(Math.sqrt(200 / 3), 6);
    expect(g.cy).toBeCloseTo(Math.sqrt(50 / 3), 6);
    expect(g.aspect).toBeCloseTo(g.cx / g.cy, 6);
    // 距离：10,10,5,5 → 中位 7.5
    expect(g.r50).toBeCloseTo(7.5, 9);
  });

  it("整体偏移时给出方向角（右为 0°，下为 90°）", () => {
    const g = dispersionGeometry([
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ])!;
    expect(g.dist).toBeCloseTo(Math.hypot(10, 10), 6);
    expect(g.angleDeg).toBeCloseTo(45, 6);
    const down = dispersionGeometry([{ x: 0, y: 5 }])!;
    expect(down.angleDeg).toBeCloseTo(90, 6);
  });

  it("空点集返回 null", () => {
    expect(dispersionGeometry([])).toBeNull();
  });
});

describe("correlate", () => {
  it("完美线性 r=1 且给出回归系数", () => {
    const c = correlate([1, 2, 3, 4], [2, 4, 6, 8])!;
    expect(c.r).toBeCloseTo(1, 10);
    expect(c.slope).toBeCloseTo(2, 10);
    expect(c.intercept).toBeCloseTo(0, 10);
  });
  it("常数列无法求相关", () => {
    expect(correlate([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
  it("样本不足返回 null", () => {
    expect(correlate([1, 2], [3, 4])).toBeNull();
  });
  it("参数几乎无变化时不给假相关（浮点残差不等于 0 的情况）", () => {
    // 六个组参数都是 0.024（实际数据里就是这种情形）
    expect(correlate([0.024, 0.024, 0.024, 0.024, 0.024, 0.024], [1, 2, 3, 4, 5, 6])).toBeNull();
    // 参数有真实差异时仍可算
    expect(correlate([1, 2, 3, 4], [2, 4, 6, 8])!.r).toBeCloseTo(1, 9);
  });
});

describe("显著性检验", () => {
  it("同样本 p 接近 1，且 CI 覆盖 0", () => {
    const a = [15.0, 15.1, 14.9, 15.05, 14.95];
    const t = welchTTest(a, [...a])!;
    expect(t.diff).toBeCloseTo(0, 9);
    expect(t.p).toBeCloseTo(1, 6);
    expect(t.ciLow).toBeLessThanOrEqual(0);
    expect(t.ciHigh).toBeGreaterThanOrEqual(0);
  });

  it("差异明显时 p 很小、CI 不含 0", () => {
    const a = [15.00, 15.01, 14.99, 15.00, 15.01];
    const b = [15.50, 15.51, 15.49, 15.50, 15.51];
    const t = welchTTest(a, b)!;
    expect(t.diff).toBeCloseTo(0.5, 6);
    expect(t.p).toBeLessThan(0.001);
    expect(t.ciLow).toBeGreaterThan(0);
    expect(t.method).toBe("welch");
  });

  it("t 分布分位数与 p 值自洽", () => {
    const df = 10;
    const c = tCritical95(df);
    expect(tTwoTailedP(c, df)).toBeCloseTo(0.05, 3);
    // t=0 → p=1
    expect(tTwoTailedP(0, 10)).toBeCloseTo(1, 6);
  });

  it("t 分布实现对齐公开分位数表（t 表 0.975 分位）", () => {
    // 教科书 t 表（双侧 95%）: df=1→12.706, 5→2.571, 10→2.228, 20→2.086, 30→2.042, 60→2.000
    const table: [number, number][] = [
      [1, 12.706],
      [5, 2.571],
      [10, 2.228],
      [20, 2.086],
      [30, 2.042],
      [60, 2.0],
    ];
    for (const [df, crit] of table) {
      expect(tCritical95(df)).toBeCloseTo(crit, 2);
      // 用表里的临界值反算 p，应该正好是 0.05
      expect(tTwoTailedP(crit, df)).toBeCloseTo(0.05, 3);
    }
  });

  it("bootstrap 可复现且能区分同/异分布", () => {
    const a = [15.0, 15.1, 14.9, 15.05, 14.95, 15.02];
    const b = [15.4, 15.5, 15.3, 15.45, 15.35, 15.42];
    const t1 = bootstrapDiff(a, b)!;
    const t2 = bootstrapDiff(a, b)!;
    expect(t1.ciLow).toBe(t2.ciLow); // 确定性
    expect(t1.diff).toBeCloseTo(
      b.reduce((x, y) => x + y, 0) / b.length - a.reduce((x, y) => x + y, 0) / a.length,
      9
    );
    expect(t1.p).toBeLessThan(0.05);
    const same = bootstrapDiff(a, a)!;
    expect(same.ciLow).toBeLessThanOrEqual(0);
    expect(same.ciHigh).toBeGreaterThanOrEqual(0);
  });
});

describe("跨多组（当日）分析", () => {
  /** 造一组：前 k 发偏快 0.1（模拟冷枪），其余稳定 */
  const mk = (id: number, startedAt: number, cold = 0.1): Group => {
    const t0 = startedAt;
    const speeds = [15.6 + cold, 15.6 + cold, 15.6 + cold, 15.6, 15.6, 15.6, 15.6];
    return {
      id,
      name: `组${id}`,
      params: { ...EMPTY_PARAMS },
      startedAt: t0,
      shots: speeds.map((v, i) => ({
        idx: i + 1,
        speed_mps: v,
        dt_us: 3200,
        at_ms: t0 + i * 1500,
      })),
    };
  };

  it("按时间排序并给出冷枪段/热枪段", () => {
    const g3 = mk(3, 3000);
    const g1 = mk(1, 1000);
    const g2 = mk(2, 2000);
    const stats = crossGroupStats([g3, g1, g2], 3);
    expect(stats.map((s) => s.name)).toEqual(["组1", "组2", "组3"]);
    expect(stats[0].firstK).toBeCloseTo(15.7, 9);
    expect(stats[0].restMean).toBeCloseTo(15.6, 9);
    expect(stats[0].coldDelta).toBeCloseTo(0.1, 9);
    expect(stats[0].n).toBe(7);
  });

  it("冷枪效应是否显著：三个组都偏快时 p 很小", () => {
    const stats = crossGroupStats([mk(1, 1000), mk(2, 2000), mk(3, 3000)], 3);
    const t = oneSampleT(stats.map((s) => s.coldDelta))!;
    expect(t.mean).toBeCloseTo(0.1, 9);
    expect(t.n).toBe(3);
    expect(t.p).toBeLessThan(0.05);
    expect(t.ciLow).toBeGreaterThan(0);
  });

  it("无系统性偏差时 p 接近 1", () => {
    const stats = crossGroupStats(
      [mk(1, 1000, 0), mk(2, 2000, 0), mk(3, 3000, 0)],
      3
    );
    const t = oneSampleT(stats.map((s) => s.coldDelta))!;
    expect(Math.abs(t.mean)).toBeLessThan(1e-12);
    expect(t.p).toBeCloseTo(1, 6);
  });

  it("对齐曲线能看出头几发的系统偏差", () => {
    const prof = alignedProfile([mk(1, 1000), mk(2, 2000), mk(3, 3000)], 5);
    expect(prof).toHaveLength(5);
    expect(prof[0].shotIdx).toBe(1);
    expect(prof[0].n).toBe(3);
    // 每组前 3 发都偏快 0.1 → 第 1 发的平均偏差为正
    expect(prof[0].meanDev).toBeGreaterThan(0);
    // 第 4 发起回到各组均值附近
    expect(Math.abs(prof[3].meanDev)).toBeLessThan(0.05);
  });

  it("组序漂移趋势：逐组变快可测出正斜率", () => {
    const g1 = mk(1, 1000, 0);
    const g2 = mk(2, 2000, 0);
    const g3 = mk(3, 3000, 0);
    const bump = (g: Group, d: number) => ({
      ...g,
      shots: g.shots.map((s) => ({ ...s, speed_mps: s.speed_mps + d })),
    });
    const stats = crossGroupStats([bump(g1, 0), bump(g2, 0.05), bump(g3, 0.1)], 3);
    const d = driftTrend(stats)!;
    expect(d.slope).toBeCloseTo(0.05, 6);
    expect(d.r).toBeCloseTo(1, 6);
  });

  it("跨组时间轴按组拼接且编号连续", () => {
    const series = crossGroupSeries([mk(2, 2000), mk(1, 1000)]);
    expect(series).toHaveLength(14);
    expect(series[0].groupName).toBe("组1");
    expect(series[0].shotIdx).toBe(1);
    expect(series[7].groupName).toBe("组2");
    expect(series[7].shotIdx).toBe(1);
  });
});

describe("groupSummary", () => {
  const mkGroup = (): Group => {
    const t0 = 1_700_000_000_000;
    return {
      id: 1,
      name: "组1",
      params: { ...EMPTY_PARAMS, stage1_rpm: "5200", hardness: "50a" },
      startedAt: t0,
      shots: [
        15.0, 15.01, 14.99, 15.02, 15.0, 14.98, 15.01, 15.0, 15.02, 14.0,
      ].map((v, i) => ({
        idx: i + 1,
        speed_mps: v,
        dt_us: 3200,
        at_ms: t0 + i * 1500,
      })),
    };
  };

  it("汇总出统计 + 稳定性 + 达标率", () => {
    const row = groupSummary(mkGroup(), { groups: [], channelLabels: {} }, null);
    expect(row.n).toBe(10);
    expect(row.mean).toBeCloseTo(14.903, 3);
    expect(row.cv).not.toBeNull();
    expect(row.outlierCount).toBeGreaterThanOrEqual(1); // 14.4 是离群
    expect(row.intervalMedian).toBeCloseTo(1.5, 6);
    expect(row.pass1).not.toBeNull();
    expect(row.r50).toBeNull(); // 没有散布数据
  });

  it("给出散布几何与轮组掉速（有数据时）", () => {
    const g = mkGroup();
    const row = groupSummary(
      g,
      { groups: [{ id: 1, name: "一级", channels: [0] }], channelLabels: {} },
      [
        { x: 5, y: 0 },
        { x: -5, y: 0 },
      ]
    );
    expect(row.r50).toBeCloseTo(5, 6);
    expect(row.wheelDropPct).toBeNull(); // 该组没有波形快照
  });
});
