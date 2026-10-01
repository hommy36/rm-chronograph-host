/**
 * 测试总结分析：只依赖已采集的数据（弹速/dt/时间戳、波形快照、靶纸标点、组参数），
 * 产出可直接写进文档的结论指标。全部纯函数，vitest 覆盖。
 */
import { computeStats } from "./stats";
import { reportShotWave } from "./wave";
import type { Group, GroupParams, WaveConfig } from "./types";

/** 组参数里取第一个数字： "5200"→5200, "50a"→50, "0.0002, 0.0, 0.0000003"→0.0002, 空→null */
export function parseParam(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** 离群发：|x-mean| ≥ k·σ（σ 为样本标准差） */
export function outliers(
  values: number[],
  k = 2.5
): { idx: number; value: number; z: number }[] {
  const s = computeStats(values);
  if (!s || s.std === 0) return [];
  const out: { idx: number; value: number; z: number }[] = [];
  values.forEach((v, i) => {
    const z = (v - s.mean) / s.std;
    if (Math.abs(z) >= k) out.push({ idx: i + 1, value: v, z });
  });
  return out;
}

/** 连续偏低段：连续 ≥minLen 发低于 mean - k·σ（疑似供弹/摩擦轮异常） */
export function lowRuns(
  values: number[],
  k = 1.2,
  minLen = 2
): { from: number; to: number; mean: number }[] {
  const s = computeStats(values);
  if (!s) return [];
  const th = s.mean - k * s.std;
  const runs: { from: number; to: number; mean: number }[] = [];
  let start = -1;
  const flush = (endIdx: number) => {
    if (start >= 0 && endIdx - start + 1 >= minLen) {
      const seg = values.slice(start, endIdx + 1);
      runs.push({
        from: start + 1,
        to: endIdx + 1,
        mean: seg.reduce((a, b) => a + b, 0) / seg.length,
      });
    }
    start = -1;
  };
  values.forEach((v, i) => {
    if (v < th) {
      if (start < 0) start = i;
    } else {
      flush(i - 1);
    }
  });
  flush(values.length - 1);
  return runs;
}

/** 逐发趋势斜率（最小二乘，单位：m/s 每发）；点数 <3 返回 null */
export function trendSlope(values: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  if (den === 0) return null;
  return num / den;
}

/** 热枪效应：后 k 发均值 − 前 k 发均值 */
export function hotGunDelta(values: number[], k = 3): number | null {
  if (values.length < 2 * k) return null;
  const head = values.slice(0, k);
  const tail = values.slice(-k);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return mean(tail) - mean(head);
}

/** 发弹节奏：由时间戳算发间隔（秒） */
export function intervalStats(atMs: number[]): {
  median: number;
  min: number;
  max: number;
  mean: number;
} | null {
  if (atMs.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < atMs.length; i++) gaps.push((atMs[i] - atMs[i - 1]) / 1000);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    median:
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
  };
}

/** 达标率：落在 target ± tolPct% 内的比例 */
export function passRate(
  values: number[],
  target: number | null | undefined,
  tolPct: number
): number | null {
  if (values.length === 0 || target == null || !Number.isFinite(target)) return null;
  // 容差带一点相对 eps：正好落在边界上的值算达标（浮点误差不该改变结论）
  const tol = Math.abs(target) * (tolPct / 100) * (1 + 1e-9) + 1e-12;
  const hit = values.filter((v) => Math.abs(v - target) <= tol).length;
  return hit / values.length;
}

export interface DispersionGeometry {
  n: number;
  /** 弹着中心相对纸面中心（mm），x 右为正 */
  dx: number;
  /** y 下为正 */
  dy: number;
  /** 偏移距离 */
  dist: number;
  /** 方向角（度）：0°=正右，90°=正下（靶面 y 向下） */
  angleDeg: number;
  /** 水平方向标准差 */
  cx: number;
  /** 垂直方向标准差 */
  cy: number;
  /** 纵横比 = max(Cx,Cy)/min(Cx,Cy) */
  aspect: number;
  /** R50：各点到弹着中心距离的中位数 */
  r50: number;
  meanRing: number | null;
}

/** 散布几何深化指标（输入为相对纸面中心的 mm 坐标） */
export function dispersionGeometry(
  pointsMm: { x: number; y: number }[]
): DispersionGeometry | null {
  const n = pointsMm.length;
  if (n === 0) return null;
  const mx = pointsMm.reduce((a, p) => a + p.x, 0) / n;
  const my = pointsMm.reduce((a, p) => a + p.y, 0) / n;
  const cx = Math.sqrt(
    pointsMm.reduce((a, p) => a + (p.x - mx) ** 2, 0) / Math.max(1, n - 1)
  );
  const cy = Math.sqrt(
    pointsMm.reduce((a, p) => a + (p.y - my) ** 2, 0) / Math.max(1, n - 1)
  );
  const dists = pointsMm
    .map((p) => Math.hypot(p.x - mx, p.y - my))
    .sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const r50 = n % 2 ? dists[mid] : (dists[mid - 1] + dists[mid]) / 2;
  const dist = Math.hypot(mx, my);
  const angleDeg = (Math.atan2(my, mx) * 180) / Math.PI; // y 向下为正
  const lo = Math.min(cx, cy);
  const hi = Math.max(cx, cy);
  return {
    n,
    dx: mx,
    dy: my,
    dist,
    angleDeg: (angleDeg + 360) % 360,
    cx,
    cy,
    aspect: lo > 1e-9 ? hi / lo : 1,
    r50,
    meanRing: null,
  };
}

/**
 * 皮尔逊相关 + 线性回归（x→y）。
 * 注意：两组数组若"几乎没有变化"（例如各组参数都是 0.024，浮点残差不是精确 0），
 * 相关系数没有意义，这里按相对尺度判据直接返回 null，避免出现 r=-0.000 的假相关。
 */
export function correlate(
  xs: number[],
  ys: number[]
): { r: number; n: number; slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const tiny = (ss: number, m: number) =>
    ss < 1e-10 * Math.max(1, m * m) * n;
  if (sxx === 0 || syy === 0 || tiny(sxx, mx) || tiny(syy, my)) return null;
  const slope = sxy / sxx;
  return {
    r: sxy / Math.sqrt(sxx * syy),
    n,
    slope,
    intercept: my - slope * mx,
  };
}

/** 对数伽马（Lanczos 近似），用于 t 分布 */
function lnGamma(x: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** 正则化不完全贝塔函数的连分式部分 */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全贝塔函数 I_x(a,b) */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** 双尾 t 分布 p 值 */
export function tTwoTailedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  return betai(df / 2, 0.5, x);
}

/** t 分布双侧 97.5% 分位（用于 95% 置信区间），二分法求解 */
export function tCritical95(df: number): number {
  if (df <= 0) return NaN;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoTailedP(mid, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface DiffTest {
  diff: number;
  /** 均值差 95% 置信区间 */
  ciLow: number;
  ciHigh: number;
  /** 双尾 p 值 */
  p: number;
  nA: number;
  nB: number;
  /** 是否用 Welch t 检验（否则为 bootstrap） */
  method: "welch" | "bootstrap";
}

/** 两组均值差的 Welch t 检验（含 95% CI） */
export function welchTTest(a: number[], b: number[]): DiffTest | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  const va =
    a.reduce((s, v) => s + (v - ma) ** 2, 0) / (a.length - 1);
  const vb =
    b.reduce((s, v) => s + (v - mb) ** 2, 0) / (b.length - 1);
  const se = Math.sqrt(va / a.length + vb / b.length);
  const diff = mb - ma;
  if (se === 0) {
    return {
      diff,
      ciLow: diff,
      ciHigh: diff,
      p: diff === 0 ? 1 : 0,
      nA: a.length,
      nB: b.length,
      method: "welch",
    };
  }
  const df =
    (va / a.length + vb / b.length) ** 2 /
    ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  const t = diff / se;
  const crit = tCritical95(df);
  return {
    diff,
    ciLow: diff - crit * se,
    ciHigh: diff + crit * se,
    p: tTwoTailedP(t, df),
    nA: a.length,
    nB: b.length,
    method: "welch",
  };
}

/** 确定性伪随机（保证 bootstrap 结果可复现，便于测试） */
function makeRng(seed = 20261002) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 任意指标的组间差异显著性（bootstrap 重采样，适合极差/标准差/散布半径这类
 * 分布未知的指标）。返回差值的中位数与 95% 分位区间，以及"差值为 0 或反号"的比例作为 p。
 */
export function bootstrapDiff(
  a: number[],
  b: number[],
  iters = 1000,
  seed = 20261002,
  stat: (v: number[]) => number = (v) => v.reduce((x, y) => x + y, 0) / v.length
): DiffTest | null {
  if (a.length < 3 || b.length < 3) return null;
  const rng = makeRng(seed);
  const pick = (arr: number[]) =>
    arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  const diffs: number[] = [];
  for (let i = 0; i < iters; i++) {
    const sa: number[] = [];
    const sb: number[] = [];
    for (let j = 0; j < a.length; j++) sa.push(pick(a));
    for (let j = 0; j < b.length; j++) sb.push(pick(b));
    diffs.push(stat(sb) - stat(sa));
  }
  diffs.sort((x, y) => x - y);
  const q = (p: number) =>
    diffs[Math.min(diffs.length - 1, Math.max(0, Math.round(p * (diffs.length - 1))))];
  const observed = stat(b) - stat(a);
  const sameSide = diffs.filter((d) => Math.sign(d) !== Math.sign(observed)).length;
  return {
    diff: observed,
    ciLow: q(0.025),
    ciHigh: q(0.975),
    p: Math.min(1, (2 * (sameSide + 1)) / (iters + 1)),
    nA: a.length,
    nB: b.length,
    method: "bootstrap",
  };
}

export interface GroupSummaryRow {
  id: number;
  name: string;
  params: GroupParams;
  n: number;
  mean: number | null;
  max: number | null;
  min: number | null;
  range: number | null;
  std: number | null;
  /** 变异系数 % = std/mean*100 */
  cv: number | null;
  /** 落在目标 ±0.5% / ±1% / ±2% 的比例 */
  pass05: number | null;
  pass1: number | null;
  pass2: number | null;
  outlierCount: number;
  /** 趋势，m/s 每发 */
  trend: number | null;
  hotGun: number | null;
  /** 发间隔（秒） */
  intervalMedian: number | null;
  intervalMax: number | null;
  /** 该组所有轮子的平均掉速 % */
  wheelDropPct: number | null;
  r50: number | null;
  meanRing: number | null;
}

/** 单组总结行（A 总览表 / 报告共用） */
export function groupSummary(
  g: Group,
  waveCfg: WaveConfig,
  dispersionPointsMm: { x: number; y: number }[] | null,
  opts: { target?: number | null } = {}
): GroupSummaryRow {
  const values = g.shots.map((s) => s.speed_mps);
  const s = computeStats(values);
  const target = opts.target ?? (s ? s.mean : null);
  const geo = dispersionPointsMm ? dispersionGeometry(dispersionPointsMm) : null;

  // 摩擦轮：该组所有发、所有通道的平均掉速%
  let wheelDropPct: number | null = null;
  const shotsWithWave = g.shots.filter((sh) => sh.wave);
  if (shotsWithWave.length > 0 && waveCfg.groups.length > 0) {
    const drops: number[] = [];
    for (const sh of shotsWithWave) {
      const rep = reportShotWave(sh.wave!, waveCfg);
      for (const grp of waveCfg.groups) {
        for (const ch of grp.channels) {
          const m = rep.channelMetrics[ch];
          if (m) drops.push(m.dropPct);
        }
      }
    }
    if (drops.length > 0) {
      wheelDropPct = drops.reduce((a, b) => a + b, 0) / drops.length;
    }
  }

  const iv = intervalStats(g.shots.map((sh) => sh.at_ms));
  return {
    id: g.id,
    name: g.name,
    params: g.params,
    n: g.shots.length,
    mean: s ? s.mean : null,
    max: s ? s.max : null,
    min: s ? s.min : null,
    range: s ? s.range : null,
    std: s ? s.std : null,
    cv: s && s.mean !== 0 ? (s.std / Math.abs(s.mean)) * 100 : null,
    pass05: passRate(values, target, 0.5),
    pass1: passRate(values, target, 1),
    pass2: passRate(values, target, 2),
    outlierCount: outliers(values).length,
    trend: trendSlope(values),
    hotGun: hotGunDelta(values),
    intervalMedian: iv ? iv.median : null,
    intervalMax: iv ? iv.max : null,
    wheelDropPct,
    r50: geo ? geo.r50 : null,
    meanRing: geo ? geo.meanRing : null,
  };
}
