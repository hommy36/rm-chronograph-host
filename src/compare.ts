/** 两组测试对比: 统计指标并排、共享分箱直方图、摩擦轮指标并排（纯计算, 可测） */
import type { Group, WaveConfig, WheelGroupCfg } from "./types";
import { computeStats } from "./stats";
import { reportShotWave } from "./wave";
import { bootstrapDiff, welchTTest } from "./analysis";
import {
  ARMOR,
  avgDistance,
  hitRate,
  meanPoint,
  minEnclosingCircle,
  score,
} from "./dispersion/math";

export const COMPARE_BINS = 15;

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

/** 两组共用分箱的直方图（对比用） */
export function pairedHistogram(
  a: number[],
  b: number[],
  binCount = COMPARE_BINS
): { centers: number[]; a: number[]; b: number[] } {
  const all = [...a, ...b];
  if (all.length === 0) return { centers: [], a: [], b: [] };
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (max === min) {
    return {
      centers: [min],
      a: [a.length],
      b: [b.length],
    };
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
  return { centers, a: fill(a), b: fill(b) };
}

export interface WheelCompareRow {
  name: string;
  /** 平均掉速 % */
  aDrop: number | null;
  bDrop: number | null;
  /** 平均组内最大轮间差 */
  aSpread: number | null;
  bSpread: number | null;
  /** 参与统计的发数 */
  aShots: number;
  bShots: number;
}

/**
 * 摩擦轮指标并排: 各轮组的平均掉速% 与平均轮间差。
 * 两组可以各有自己的轮组分配（cfgA/cfgB），轮组按名字对齐。
 */
export function compareWheelRows(
  a: Group,
  b: Group,
  cfgA: WaveConfig,
  cfgB: WaveConfig = cfgA
): WheelCompareRow[] {
  const repsOf = (g: Group, cfg: WaveConfig) => {
    const reps = g.shots.filter((s) => s.wave).map((s) => reportShotWave(s.wave!, cfg));
    return { reps, n: reps.length };
  };
  const names: string[] = [];
  for (const n of [
    ...cfgA.groups.map((g) => g.name),
    ...cfgB.groups.map((g) => g.name),
  ]) {
    if (!names.includes(n)) names.push(n);
  }
  const mean = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((x, y) => x + y, 0) / arr.length : null;
  const A = repsOf(a, cfgA);
  const B = repsOf(b, cfgB);
  const side = (
    g: WheelGroupCfg | undefined,
    cfg: WaveConfig,
    data: { reps: ReturnType<typeof reportShotWave>[]; n: number }
  ) => {
    if (!g) return { drop: null, spread: null };
    const idx = cfg.groups.indexOf(g);
    const drops: number[] = [];
    const spreads: number[] = [];
    for (const rep of data.reps) {
      for (const ch of g.channels) {
        const m = rep.channelMetrics[ch];
        if (m) drops.push(m.dropPct);
      }
      const sp = rep.groupSpreads[idx]?.spread;
      if (sp != null) spreads.push(sp);
    }
    return { drop: mean(drops), spread: mean(spreads) };
  };
  return names.map((name) => {
    const ga = cfgA.groups.find((g) => g.name === name);
    const gb = cfgB.groups.find((g) => g.name === name);
    const ca = side(ga, cfgA, A);
    const cb = side(gb, cfgB, B);
    return {
      name,
      aDrop: ca.drop,
      bDrop: cb.drop,
      aSpread: ca.spread,
      bSpread: cb.spread,
      aShots: A.n,
      bShots: B.n,
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

export function compareDispersion(a: Group, b: Group): [DispersionSide, DispersionSide] {
  return [groupDispersion(a), groupDispersion(b)];
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

/** 对比结果导出 CSV */export function buildCompareCsv(
  a: Group,
  b: Group,
  cfgA: WaveConfig,
  cfgB: WaveConfig = cfgA
): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const fmt = (v: number | null, digits: number) =>
    v === null || !isFinite(v) ? "" : v.toFixed(digits);
  const lines: string[] = [
    `# 对比,${cell(a.name)} vs ${cell(b.name)}`,
    `# A 组参数,${cell(`${a.params.stage1_rpm} / ${a.params.stage2_rpm} / 压缩量 ${a.params.compression} / 硬度 ${a.params.hardness}`)}`,
    `# B 组参数,${cell(`${b.params.stage1_rpm} / ${b.params.stage2_rpm} / 压缩量 ${b.params.compression} / 硬度 ${b.params.hardness}`)}`,
    `指标,A(${cell(a.name)}),B(${cell(b.name)}),差值(B-A)`,
  ];
  for (const r of compareStatsRows(a, b)) {
    lines.push([cell(r.label), fmt(r.a, r.digits), fmt(r.b, r.digits), fmt(r.diff, r.digits)].join(","));
  }
  const wheels = compareWheelRows(a, b, cfgA, cfgB);
  if (wheels.length > 0) {
    lines.push("");
    lines.push("轮组,指标,A,B,差值(B-A)");
    for (const w of wheels) {
      const dDrop =
        w.aDrop !== null && w.bDrop !== null ? w.bDrop - w.aDrop : null;
      const dSpread =
        w.aSpread !== null && w.bSpread !== null ? w.bSpread - w.aSpread : null;
      lines.push(
        [cell(w.name), "平均掉速%", fmt(w.aDrop, 2), fmt(w.bDrop, 2), fmt(dDrop, 2)].join(",")
      );
      lines.push(
        [cell(w.name), "平均轮间差", fmt(w.aSpread, 1), fmt(w.bSpread, 1), fmt(dSpread, 1)].join(",")
      );
    }
  }
  const hist = pairedHistogram(
    a.shots.map((s) => s.speed_mps),
    b.shots.map((s) => s.speed_mps)
  );
  if (hist.centers.length > 0) {
    lines.push("");
    lines.push("箱中心(m/s),A 频数,B 频数");
    hist.centers.forEach((c, i) => {
      lines.push([c.toFixed(4), String(hist.a[i]), String(hist.b[i])].join(","));
    });
  }
  const [da, db] = compareDispersion(a, b);
  if (da.hasData || db.hasData) {
    lines.push("");
    lines.push(`散布(靶纸),A(${cell(a.name)}),B(${cell(b.name)}),差值(B-A)`);
    const row = (label: string, x: number | null, y: number | null, digits: number) => {
      const diff = x !== null && y !== null ? y - x : null;
      lines.push([cell(label), fmt(x, digits), fmt(y, digits), fmt(diff, digits)].join(","));
    };
    row("标点数", da.n, db.n, 0);
    row("平均环数(以各自点群中心)", da.meanRing, db.meanRing, 3);
    row("平均散布距离(mm)", da.avgDist, db.avgDist, 2);
    row("最小包围圆半径(mm)", da.mecRadius, db.mecRadius, 2);
    row("小装甲命中率(%)", da.hitSmall === null ? null : da.hitSmall * 100, db.hitSmall === null ? null : db.hitSmall * 100, 1);
    row("大装甲命中率(%)", da.hitLarge === null ? null : da.hitLarge * 100, db.hitLarge === null ? null : db.hitLarge * 100, 1);
    row("飞镖命中率(%)", da.hitDart === null ? null : da.hitDart * 100, db.hitDart === null ? null : db.hitDart * 100, 1);
    lines.push("落点(mm, 以纸面中心为原点),X,Y");
    da.pointsMm.forEach((p) => lines.push([`A(${cell(a.name)})`, p.x.toFixed(2), p.y.toFixed(2)].join(",")));
    db.pointsMm.forEach((p) => lines.push([`B(${cell(b.name)})`, p.x.toFixed(2), p.y.toFixed(2)].join(",")));
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
