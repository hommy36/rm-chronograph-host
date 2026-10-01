/**
 * 统计计算（纯函数，vitest 覆盖）。
 * 方差/标准差为**样本口径**（÷(n−1)），与 Excel 的 VAR.S/STDEV.S、论文常用口径一致。
 */

export interface Stats {
  n: number;
  mean: number;
  max: number;
  min: number;
  /** 极差 = max - min */
  range: number;
  /** 样本方差（÷(n−1)）；n=1 时为 0 */
  variance: number;
  /** 样本标准差（÷(n−1)）；n=1 时为 0 */
  std: number;
}

export function computeStats(values: number[]): Stats | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const variance =
    n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, max, min, range: max - min, variance, std: Math.sqrt(variance) };
}

export interface Histogram {
  /** 各箱中心值 */
  centers: number[];
  counts: number[];
  binWidth: number;
}

export function histogram(values: number[], binCount = 10): Histogram {
  if (values.length === 0) return { centers: [], counts: [], binWidth: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return { centers: [min], counts: [values.length], binWidth: 0 };
  }
  const binWidth = (max - min) / binCount;
  const counts = new Array(binCount).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1; // max 落入最后一箱
    counts[idx] += 1;
  }
  const centers = counts.map((_, i) => min + (i + 0.5) * binWidth);
  return { centers, counts, binWidth };
}

/** 逐发相对均值的偏差 */
export function deviations(values: number[], mean: number): number[] {
  return values.map((v) => v - mean);
}

export interface MovingBand {
  /** 移动平均，前 window-1 个点为 null */
  ma: (number | null)[];
  /** 带上下界（ma ± 1σ），与 ma 同步为 null */
  upper: (number | null)[];
  lower: (number | null)[];
}

/** 移动平均 ±1σ 带（图 37 右下角，窗口默认 5） */
export function movingAverageBand(values: number[], window = 5): MovingBand {
  const ma: (number | null)[] = new Array(values.length).fill(null);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / window;
    // 与全局口径一致：窗口内按样本标准差（÷(window−1)）
    const sd = Math.sqrt(
      slice.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, window - 1)
    );
    ma[i] = m;
    upper[i] = m + sd;
    lower[i] = m - sd;
  }
  return { ma, upper, lower };
}
