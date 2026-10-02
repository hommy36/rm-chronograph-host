/** 多组测试对比: 统计指标并排、共享分箱直方图、摩擦轮指标并排（纯计算, 可测） */
import type { Group, WaveConfig, WheelGroupCfg } from "./types";
import { computeStats } from "./stats";
import { reportShotWave } from "./wave";
import {
  bootstrapDiff,
  pairwiseWelch,
  permutationTest,
  welchAnova,
  welchTTest,
} from "./analysis";
import {
  ARMOR,
  avgDistance,
  hitRate,
  meanPoint,
  minEnclosingCircle,
  score,
} from "./dispersion/math";

export const COMPARE_BINS = 15;

/** 多组配色（与轮组色区分开） */
export const COMPARE_COLORS = [
  "#1677ff",
  "#fa541c",
  "#52c41a",
  "#722ed1",
  "#13c2c2",
  "#eb2f96",
  "#faad14",
  "#2f54eb",
  "#a0d911",
  "#8c8c8c",
];

export function compareColor(i: number): string {
  return COMPARE_COLORS[i % COMPARE_COLORS.length];
}

/** 多组统计指标表: 一行一个指标, values 与传入的组一一对应 */
export interface StatsRow {
  label: string;
  digits: number;
  values: (number | null)[];
}

export function statsRowsOf(groups: Group[]): StatsRow[] {
  const stats = groups.map((g) => computeStats(g.shots.map((s) => s.speed_mps)));
  const row = (
    label: string,
    digits: number,
    pick: (s: NonNullable<ReturnType<typeof computeStats>>) => number,
    empty: number | null
  ): StatsRow => ({
    label,
    digits,
    values: stats.map((s) => (s ? pick(s) : empty)),
  });
  return [
    row("样本数", 0, (s) => s.n, 0),
    row("均值 (m/s)", 4, (s) => s.mean, null),
    row("最大值 (m/s)", 3, (s) => s.max, null),
    row("最小值 (m/s)", 3, (s) => s.min, null),
    row("极差 (m/s)", 3, (s) => s.range, null),
    row("方差", 6, (s) => s.variance, null),
    row("标准差", 4, (s) => s.std, null),
  ];
}

/** 多组整体差异: 均值用 Welch ANOVA；极差/标准差分布未知，用置换检验 */
export interface OverallTestRow {
  label: string;
  method: string;
  /** 检验统计量（ANOVA 为 F，置换为组间方差） */
  stat: number | null;
  p: number | null;
}

export function overallTests(groups: Group[]): OverallTestRow[] {
  const vals = groups.map((g) => g.shots.map((s) => s.speed_mps));
  if (groups.length < 3) return [];
  const rangeStat = (v: number[]) => Math.max(...v) - Math.min(...v);
  const stdStat = (v: number[]) => {
    const m = v.reduce((p, q) => p + q, 0) / v.length;
    return Math.sqrt(
      v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1)
    );
  };
  const anova = welchAnova(vals);
  const rangeTest = permutationTest(vals, rangeStat, 1000, 20261002);
  const stdTest = permutationTest(vals, stdStat, 1000, 20261002);
  return [
    {
      label: "均值",
      method: anova ? `Welch ANOVA（F(${anova.df1}, ${anova.df2.toFixed(1)})）` : "Welch ANOVA",
      stat: anova ? anova.f : null,
      p: anova ? anova.p : null,
    },
    {
      label: "极差",
      method: "置换检验（1000 次）",
      stat: rangeTest ? rangeTest.observed : null,
      p: rangeTest ? rangeTest.p : null,
    },
    {
      label: "标准差",
      method: "置换检验（1000 次）",
      stat: stdTest ? stdTest.observed : null,
      p: stdTest ? stdTest.p : null,
    },
  ];
}

/** 均值两两 Welch t 检验的 p 值矩阵（i<j 才有值） */
export function pairwiseMeanP(groups: Group[]): (number | null)[][] {
  return pairwiseWelch(groups.map((g) => g.shots.map((s) => s.speed_mps)));
}

export interface CompareStatsRow {
  label: string;
  a: number | null;
  b: number | null;
  /** b - a */
  diff: number | null;
  digits: number;
  /** 差值 95% 置信区间（可算时才有） */
  ciLow?: number | null;
  ciHigh?: number | null;
  /** 双尾 p 值 */
  p?: number | null;
  /** 检验方法：均值用 Welch t，极差/标准差用 bootstrap */
  method?: "welch" | "bootstrap";
}

export function compareStatsRows(a: Group, b: Group): CompareStatsRow[] {
  const sa = computeStats(a.shots.map((s) => s.speed_mps));
  const sb = computeStats(b.shots.map((s) => s.speed_mps));
  const mk = (
    label: string,
    pick: (s: NonNullable<ReturnType<typeof computeStats>>) => number,
    digits: number,
    emptyValue: number | null
  ): CompareStatsRow => {
    const av = sa ? pick(sa) : emptyValue;
    const bv = sb ? pick(sb) : emptyValue;
    return {
      label,
      a: av,
      b: bv,
      diff: av !== null && bv !== null ? bv - av : null,
      digits,
    };
  };
  const va = a.shots.map((s) => s.speed_mps);
  const vb = b.shots.map((s) => s.speed_mps);
  const rangeStat = (v: number[]) => Math.max(...v) - Math.min(...v);
  const stdStat = (v: number[]) => {
    const m = v.reduce((p, q) => p + q, 0) / v.length;
    return Math.sqrt(
      v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1)
    );
  };
  const rows: CompareStatsRow[] = [
    mk("样本数", (s) => s.n, 0, 0),
    mk("均值 (m/s)", (s) => s.mean, 4, null),
    mk("最大值 (m/s)", (s) => s.max, 3, null),
    mk("最小值 (m/s)", (s) => s.min, 3, null),
    mk("极差 (m/s)", (s) => s.range, 3, null),
    mk("方差", (s) => s.variance, 6, null),
    mk("标准差", (s) => s.std, 4, null),
  ];
  // 显著性：均值用 Welch t 检验；极差/标准差抽样分布未知，用 bootstrap 重采样该统计量
  for (const row of rows) {
    let t: ReturnType<typeof welchTTest> = null;
    if (row.label.startsWith("均值")) t = welchTTest(va, vb);
    else if (row.label.startsWith("极差"))
      t = bootstrapDiff(va, vb, 1000, 20261002, rangeStat);
    else if (row.label.startsWith("标准差"))
      t = bootstrapDiff(va, vb, 1000, 20261002, stdStat);
    if (t) {
      row.ciLow = t.ciLow;
      row.ciHigh = t.ciHigh;
      row.p = t.p;
      row.method = t.method;
    }
  }
  return rows;
}

/** 多组共用分箱的直方图（对比用）；counts 与传入序列一一对应 */
export function groupedHistogram(
  series: number[][],
  binCount = COMPARE_BINS
): { centers: number[]; counts: number[][] } {
  const all = series.flat();
  if (all.length === 0) return { centers: [], counts: series.map(() => []) };
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (max === min) {
    return { centers: [min], counts: series.map((v) => [v.length]) };
  }
  const binWidth = (max - min) / binCount;
  const fill = (values: number[]) => {
    const counts = new Array(binCount).fill(0);
    for (const v of values) {
      let idx = Math.floor((v - min) / binWidth);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      counts[idx] += 1;
    }
    return counts;
  };
  const centers = Array.from({ length: binCount }, (_, i) => min + (i + 0.5) * binWidth);
  return { centers, counts: series.map(fill) };
}

export interface WheelCompareRow {
  name: string;
  /** 各组的平均掉速%（与传入的组一一对应；该组没有这个轮组时为 null） */
  drops: (number | null)[];
  /** 各组该轮组的平均轮间差 */
  spreads: (number | null)[];
  /** 各组参与统计的发数 */
  shots: number[];
}

/**
 * 摩擦轮指标并排: 各轮组的平均掉速% 与平均轮间差。
 * 每组可以有自己的轮组分配（cfgs 与 groups 一一对应），轮组按名字对齐。
 */
export function compareWheelRows(
  groups: Group[],
  cfgs: WaveConfig[]
): WheelCompareRow[] {
  const cfgOf = (i: number) => cfgs[i] ?? cfgs[0];
  const repsOf = (g: Group, cfg: WaveConfig) => {
    const reps = g.shots.filter((s) => s.wave).map((s) => reportShotWave(s.wave!, cfg));
    return { reps, n: reps.length };
  };
  const names: string[] = [];
  for (const cfg of cfgs) {
    for (const wg of cfg.groups) {
      if (!names.includes(wg.name)) names.push(wg.name);
    }
  }
  const mean = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((x, y) => x + y, 0) / arr.length : null;
  const data = groups.map((g, i) => repsOf(g, cfgOf(i)));
  const side = (
    wg: WheelGroupCfg | undefined,
    cfg: WaveConfig,
    d: { reps: ReturnType<typeof reportShotWave>[]; n: number }
  ) => {
    if (!wg) return { drop: null, spread: null };
    const idx = cfg.groups.indexOf(wg);
    const drops: number[] = [];
    const spreads: number[] = [];
    for (const rep of d.reps) {
      for (const ch of wg.channels) {
        const m = rep.channelMetrics[ch];
        if (m) drops.push(m.dropPct);
      }
      const sp = rep.groupSpreads[idx]?.spread;
      if (sp != null) spreads.push(sp);
    }
    return { drop: mean(drops), spread: mean(spreads) };
  };
  return names.map((name) => {
    const sides = groups.map((_, i) => {
      const cfg = cfgOf(i);
      return side(cfg.groups.find((x) => x.name === name), cfg, data[i]);
    });
    return {
      name,
      drops: sides.map((s) => s.drop),
      spreads: sides.map((s) => s.spread),
      shots: data.map((d) => d.n),
    };
  });
}

/** 取一个规整的刻度步长，让每边网格线数量适中 */
export function niceStep(range: number): number {
  const candidates = [2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  for (const c of candidates) {
    if (range / c <= 4) return c;
  }
  return 1000;
}

/**
 * 让 x/y 两轴的"毫米/像素"严格一致（否则散布形状会被绘图区比例拉扁）。
 * y 轴范围取整到规整步长，x 轴按绘图区宽高比精确推出；
 * 网格线数量各自就近取整，视觉上接近正方形（不牺牲比例尺精度）。
 */
export function equalScaleRanges(
  maxAbs: number,
  plotW: number,
  plotH: number
): { limX: number; limY: number; step: number; splitX: number; splitY: number } {
  const target = Math.max(1, maxAbs * 1.12);
  const step = niceStep(target);
  const limY = Math.max(step, Math.ceil(target / step) * step);
  const w = Math.max(1, plotW);
  const h = Math.max(1, plotH);
  const limX = Math.max(step, (limY * w) / h);
  const splitY = Math.max(1, Math.round((limY * 2) / step));
  const splitX = Math.max(1, Math.round((limX * 2) / step));
  return { limX, limY, step, splitX, splitY };
}

/** 单组散布分析结果（落点统一到 mm，并以纸面中心为原点） */
export interface DispersionSide {
  hasData: boolean;
  /** 标点数 */
  n: number;
  /** 相对纸面中心的落点(mm)，x 右为正，y 下为正 */
  pointsMm: { x: number; y: number }[];
  /** 平均环数（以各自点群中心为基准） */
  meanRing: number | null;
  /** 平均散布距离(mm) */
  avgDist: number | null;
  /** 最小包围圆半径(mm) */
  mecRadius: number | null;
  hitSmall: number | null;
  hitLarge: number | null;
  hitDart: number | null;
}

/**
 * 把组内散布数据换算成可对比的 mm 坐标（以纸面中心为原点）。
 * 缺少图片天然尺寸时退化为原始像素坐标（仍可看相对形状）。
 */
export function groupDispersion(g: Group): DispersionSide {
  const d = g.dispersion;
  if (!d || d.points.length === 0) {
    return {
      hasData: false,
      n: 0,
      pointsMm: [],
      meanRing: null,
      avgDist: null,
      mecRadius: null,
      hitSmall: null,
      hitLarge: null,
      hitDart: null,
    };
  }
  const imgW = d.imgW ?? 0;
  const imgH = d.imgH ?? 0;
  const hasScale = imgW > 0 && imgH > 0;
  const mmPerPx = hasScale ? d.effSpec.w / imgW : 1;
  // 有图片尺寸时以纸面中心为原点；缺尺寸（旧数据/图片丢失）时退化到点群重心，
  // 这样至少能对比相对散布形状，而不是把像素当毫米
  const rawPts = d.points.map((p) => ({ ...p, x: p.x * mmPerPx, y: p.y * mmPerPx }));
  const fallbackCenter = meanPoint(rawPts) ?? { x: 0, y: 0 };
  const ox = hasScale ? (imgW / 2) * mmPerPx : fallbackCenter.x;
  const oy = hasScale ? (imgH / 2) * mmPerPx : fallbackCenter.y;
  const pointsMm = rawPts.map((p) => ({ x: p.x - ox, y: p.y - oy }));
  const center = meanPoint(pointsMm);
  const mec = minEnclosingCircle(pointsMm);
  // 已换算到 mm，故 mmPerPx 传 1
  return {
    hasData: true,
    n: pointsMm.length,
    pointsMm,
    meanRing: center ? score(pointsMm, center, 1) : null,
    avgDist: center ? avgDistance(pointsMm, center, 1) : null,
    mecRadius: mec ? mec.radius : null,
    hitSmall: center ? hitRate(pointsMm, center, ARMOR.small, 1) : null,
    hitLarge: center ? hitRate(pointsMm, center, ARMOR.large, 1) : null,
    hitDart: center ? hitRate(pointsMm, center, ARMOR.dart, 1) : null,
  };
}

/** 把落点整体平移，使其弹着中心（点群重心）落在原点——用于重合两组散布做形状对比 */
export function recenterToMean(points: { x: number; y: number }[]): {
  x: number;
  y: number;
}[] {
  const c = meanPoint(points);
  if (!c) return points;
  return points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

/** 对比结果导出 CSV（任意组数；cfgs 与 groups 一一对应） */
export function buildCompareCsv(groups: Group[], cfgs: WaveConfig[]): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const fmt = (v: number | null | undefined, digits: number) =>
    v === null || v === undefined || !isFinite(v) ? "" : v.toFixed(digits);
  const names = groups.map((g) => g.name);
  const paramsOf = (g: Group) =>
    `${g.params.stage1_rpm} / ${g.params.stage2_rpm} / 压缩量 ${g.params.compression} / 硬度 ${g.params.hardness}`;
  const lines: string[] = [
    `# 对比,${names.map(cell).join(" vs ")}`,
    ...groups.map((g, i) => `# 组${i + 1} 参数 (${cell(g.name)}),${cell(paramsOf(g))}`),
    ["指标", ...names.map(cell)].join(","),
  ];
  for (const r of statsRowsOf(groups)) {
    lines.push([cell(r.label), ...r.values.map((v) => fmt(v, r.digits))].join(","));
  }
  // 两组：逐指标差值与检验；三组及以上：整体检验 + 两两均值检验
  if (groups.length === 2) {
    lines.push("");
    lines.push(`指标,差值(B-A),95%CI 下限,95%CI 上限,检验方法,p 值`);
    for (const r of compareStatsRows(groups[0], groups[1])) {
      lines.push(
        [
          cell(r.label),
          fmt(r.diff, r.digits),
          fmt(r.ciLow, r.digits),
          fmt(r.ciHigh, r.digits),
          r.method ?? "",
          fmt(r.p, 4),
        ].join(",")
      );
    }
  } else if (groups.length >= 3) {
    lines.push("");
    lines.push("整体差异检验,方法,统计量,p 值");
    for (const t of overallTests(groups)) {
      lines.push([cell(t.label), cell(t.method), fmt(t.stat, 4), fmt(t.p, 4)].join(","));
    }
    lines.push("");
    lines.push("均值两两 Welch t 检验 p 值（未校正多重比较）");
    const p = pairwiseMeanP(groups);
    lines.push(["", ...names.map(cell)].join(","));
    groups.forEach((g, i) => {
      lines.push(
        [cell(g.name), ...groups.map((_, j) => (j <= i ? "" : fmt(p[i][j], 4)))].join(",")
      );
    });
  }
  const wheels = compareWheelRows(groups, cfgs);
  if (wheels.length > 0) {
    lines.push("");
    lines.push(["轮组", "指标", ...names.map(cell)].join(","));
    for (const w of wheels) {
      lines.push([cell(w.name), "平均掉速%", ...w.drops.map((v) => fmt(v, 2))].join(","));
      lines.push([cell(w.name), "平均轮间差", ...w.spreads.map((v) => fmt(v, 1))].join(","));
    }
  }
  const hist = groupedHistogram(groups.map((g) => g.shots.map((s) => s.speed_mps)));
  if (hist.centers.length > 0) {
    lines.push("");
    lines.push(["箱中心(m/s)", ...names.map((n) => `${cell(n)} 频数`)].join(","));
    hist.centers.forEach((c, i) => {
      lines.push([c.toFixed(4), ...hist.counts.map((col) => String(col[i]))].join(","));
    });
  }
  const dis = groups.map(groupDispersion);
  if (dis.some((d) => d.hasData)) {
    const noData = (v: number | null | undefined, digits: number) =>
      v === null || v === undefined ? "" : v.toFixed(digits);
    const pct = (v: number | null) => (v === null ? null : v * 100);
    lines.push("");
    lines.push(["散布(靶纸)", ...names.map(cell)].join(","));
    lines.push(["标点数", ...dis.map((d) => String(d.n))].join(","));
    lines.push(
      ["平均环数(以各自点群中心)", ...dis.map((d) => noData(d.meanRing, 3))].join(",")
    );
    lines.push(["平均散布距离(mm)", ...dis.map((d) => noData(d.avgDist, 2))].join(","));
    lines.push(
      ["最小包围圆半径(mm)", ...dis.map((d) => noData(d.mecRadius, 2))].join(",")
    );
    lines.push(["小装甲命中率(%)", ...dis.map((d) => noData(pct(d.hitSmall), 1))].join(","));
    lines.push(["大装甲命中率(%)", ...dis.map((d) => noData(pct(d.hitLarge), 1))].join(","));
    lines.push(["飞镖命中率(%)", ...dis.map((d) => noData(pct(d.hitDart), 1))].join(","));
    lines.push("落点(mm, 以纸面中心为原点),组,X,Y");
    dis.forEach((d, i) => {
      d.pointsMm.forEach((p) =>
        lines.push([`${cell(names[i])}`, p.x.toFixed(2), p.y.toFixed(2)].join(","))
      );
    });
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
