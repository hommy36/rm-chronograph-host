/**
 * 摩擦轮转速波形: 环形缓冲、发射瞬间快照、离线平滑、掉速/恢复指标。
 * 所有时间戳均为本地 Date.now() 毫秒, 与弹速帧接收时间同一时钟。
 */

/** 快照窗口: 发射前 200 ms ~ 发射后 1000 ms */
export const SNAP_PRE_MS = 200;
export const SNAP_POST_MS = 1000;

export interface WaveSnapshot {
  /** 发射时刻(弹速帧接收时间) */
  t0: number;
  /** 相对 t0 的毫秒时间轴, 长度 = 采样点数 */
  times: number[];
  /** channels[c][i] = 通道 c 在第 i 个采样点的值 */
  channels: number[][];
}

/** 环形缓冲: 保留最近 capacity 个采样点 */
export class WaveBuffer {
  private times: number[] = [];
  private data: number[][] = [];
  /** 最近一帧的通道数, 0 = 尚未收到 */
  channelCount = 0;

  constructor(private capacity = 60000) {}

  push(atMs: number, channels: number[]) {
    if (channels.length === 0) return;
    if (this.channelCount !== channels.length) {
      // 通道数变化: 旧数据维度不一致, 清空重来
      this.times = [];
      this.data = [];
      this.channelCount = channels.length;
    }
    this.times.push(atMs);
    this.data.push(channels.slice());
    if (this.times.length > this.capacity) {
      const over = this.times.length - this.capacity;
      this.times.splice(0, over);
      this.data.splice(0, over);
    }
  }

  get length() {
    return this.times.length;
  }

  /** 最新采样点时间, 空缓冲返回 0 */
  latestAt(): number {
    return this.times.length > 0 ? this.times[this.times.length - 1] : 0;
  }

  /** 截取 [startMs, endMs] 窗口, 通道数变化导致的空洞自然被时间轴反映 */
  slice(startMs: number, endMs: number): { times: number[]; channels: number[][] } | null {
    if (this.channelCount === 0) return null;
    const times: number[] = [];
    const cols: number[][] = Array.from({ length: this.channelCount }, () => []);
    for (let i = 0; i < this.times.length; i++) {
      const t = this.times[i];
      if (t < startMs || t > endMs) continue;
      times.push(t);
      for (let c = 0; c < this.channelCount; c++) cols[c].push(this.data[i][c]);
    }
    if (times.length === 0) return null;
    return { times, channels: cols };
  }

  clear() {
    this.times = [];
    this.data = [];
    this.channelCount = 0;
  }
}

/** 以 t0 为锚点从缓冲提取一发快照; 数据不足返回 null */
export function takeSnapshot(buf: WaveBuffer, t0: number): WaveSnapshot | null {
  const s = buf.slice(t0 - SNAP_PRE_MS, t0 + SNAP_POST_MS);
  if (!s || s.times.length < 8) return null;
  return {
    t0,
    times: s.times.map((t) => t - t0),
    channels: s.channels,
  };
}

/**
 * 居中滑动平均(离线平滑)。window <= 1 时原样返回。
 * 窗口自动取奇数; 两端用可用点平均。
 */
export function smoothSeries(values: number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window) | 1); // 强制奇数
  if (w <= 1 || values.length === 0) return values.slice();
  const half = (w - 1) / 2;
  const out = new Array<number>(values.length);
  // 前缀和加速
  const pre = new Array<number>(values.length + 1);
  pre[0] = 0;
  for (let i = 0; i < values.length; i++) pre[i + 1] = pre[i] + values[i];
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}

export interface ChannelDropMetrics {
  /** 发射前基线([-SNAP_PRE,-50]ms 均值) */
  baseline: number;
  /** 发射后最低值 */
  trough: number;
  /** trough 相对 t0 的时间 ms */
  troughAtMs: number;
  /** 掉速量 baseline - trough (上升型通道为负) */
  drop: number;
  /** 掉速百分比(基线为 0 时为 0) */
  dropPct: number;
  /** 恢复时间: 谷底之后首次回到基线 98% 的时间(ms), 未恢复为 null */
  recoverMs: number | null;
}

/** 单通道掉速分析(输入应为平滑后的序列) */
export function analyzeDrop(times: number[], values: number[]): ChannelDropMetrics | null {
  if (times.length < 8) return null;
  // 基线: 发射前 [-SNAP_PRE, -50]ms
  let bSum = 0;
  let bN = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= -SNAP_PRE_MS && times[i] <= -50) {
      bSum += values[i];
      bN++;
    }
  }
  if (bN === 0) return null;
  const baseline = bSum / bN;
  // 谷底: t >= 0 段最小值
  let trough = Infinity;
  let troughAtMs = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= 0 && values[i] < trough) {
      trough = values[i];
      troughAtMs = times[i];
    }
  }
  if (!isFinite(trough)) return null;
  const drop = baseline - trough;
  const dropPct = baseline !== 0 ? (drop / Math.abs(baseline)) * 100 : 0;
  // 恢复: 谷底后首次 >= 基线的 98%(基线为负时按幅值口径)
  let recoverMs: number | null = null;
  const target = baseline - (baseline >= 0 ? 1 : -1) * Math.abs(baseline) * 0.02;
  for (let i = 0; i < times.length; i++) {
    if (times[i] > troughAtMs && values[i] >= target) {
      recoverMs = times[i] - troughAtMs;
      break;
    }
  }
  return { baseline, trough, troughAtMs, drop, dropPct, recoverMs };
}

/** 组内轮间差: 每个采样点上组内 max-min, 返回全窗口最大值 */
export function maxIntraGroupSpread(seriesList: number[][]): number {
  if (seriesList.length < 2) return 0;
  const n = Math.min(...seriesList.map((s) => s.length));
  let maxSpread = 0;
  for (let i = 0; i < n; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of seriesList) {
      if (s[i] < lo) lo = s[i];
      if (s[i] > hi) hi = s[i];
    }
    if (hi - lo > maxSpread) maxSpread = hi - lo;
  }
  return maxSpread;
}

/** 一发快照的完整指标报表（CSV 导出 / 详情弹窗共用） */
export interface ShotWaveReport {
  /** 每通道掉速指标, 下标 = JustFloat 通道号 */
  channelMetrics: (ChannelDropMetrics | null)[];
  /** 每个配置轮组的最大轮间差, 组内通道不足 2 个为 null */
  groupSpreads: { name: string; spread: number | null }[];
}

export function reportShotWave(
  snap: WaveSnapshot,
  config: { groups: { name: string; channels: number[] }[] },
  smoothWin = 9
): ShotWaveReport {
  const smoothed = snap.channels.map((s) => smoothSeries(s, smoothWin));
  return {
    channelMetrics: smoothed.map((s) => analyzeDrop(snap.times, s)),
    groupSpreads: config.groups.map((g) => {
      const list = g.channels
        .filter((c) => c < smoothed.length)
        .map((c) => smoothed[c]);
      return { name: g.name, spread: list.length >= 2 ? maxIntraGroupSpread(list) : null };
    }),
  };
}
