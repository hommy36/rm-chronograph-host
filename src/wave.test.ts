import { describe, expect, it } from "vitest";
import {
  analyzeDrop,
  maxIntraGroupSpread,
  smoothSeries,
  takeSnapshot,
  WaveBuffer,
} from "./wave";

/** 造一个带掉速的通道: 基线 4000, t>=0 按指数掉到 3400 再恢复 */
function makeDip(times: number[], base = 4000, depth = 600, tau = 120): number[] {
  return times.map((t) => {
    if (t < 0) return base;
    const x = t / tau;
    return base - depth * x * Math.exp(1 - x);
  });
}

function makeTimes(pre = 200, post = 1000, step = 2): number[] {
  const out: number[] = [];
  for (let t = -pre; t <= post; t += step) out.push(t);
  return out;
}

describe("WaveBuffer", () => {
  it("push/slice 基本流程", () => {
    const b = new WaveBuffer(100);
    for (let t = 1000; t < 2000; t += 10) b.push(t, [t, -t]);
    expect(b.channelCount).toBe(2);
    expect(b.latestAt()).toBe(1990);
    const s = b.slice(1500, 1520)!;
    expect(s.times).toEqual([1500, 1510, 1520]);
    expect(s.channels[0]).toEqual([1500, 1510, 1520]);
    expect(s.channels[1]).toEqual([-1500, -1510, -1520]);
  });

  it("超过容量丢弃最旧数据", () => {
    const b = new WaveBuffer(10);
    for (let t = 0; t < 20; t++) b.push(t, [t]);
    expect(b.length).toBe(10);
    expect(b.latestAt()).toBe(19);
    expect(b.slice(0, 9)).toBeNull();
  });

  it("通道数变化时清空旧数据", () => {
    const b = new WaveBuffer(100);
    b.push(1, [1, 2]);
    b.push(2, [1, 2, 3]);
    expect(b.channelCount).toBe(3);
    expect(b.length).toBe(1);
  });
});

describe("takeSnapshot", () => {
  it("窗口正确且时间轴相对化", () => {
    const b = new WaveBuffer(10000);
    const t0 = 100000;
    for (let t = t0 - 300; t <= t0 + 1200; t += 5) b.push(t, [1, 2]);
    const snap = takeSnapshot(b, t0)!;
    expect(snap.t0).toBe(t0);
    expect(snap.times[0]).toBe(-200);
    expect(snap.times[snap.times.length - 1]).toBe(1000);
    expect(snap.channels).toHaveLength(2);
  });

  it("数据不足返回 null", () => {
    const b = new WaveBuffer(100);
    b.push(1000, [1]);
    expect(takeSnapshot(b, 1000)).toBeNull();
  });
});

describe("smoothSeries", () => {
  it("window<=1 原样返回", () => {
    const v = [1, 5, 2, 8];
    expect(smoothSeries(v, 1)).toEqual(v);
  });

  it("常数序列平滑后不变", () => {
    const v = Array(50).fill(3.3);
    const s = smoothSeries(v, 9);
    s.forEach((x) => expect(x).toBeCloseTo(3.3, 10));
  });

  it("抑制单点尖峰", () => {
    const v = [10, 10, 10, 100, 10, 10, 10];
    const s = smoothSeries(v, 5);
    expect(s[3]).toBeLessThan(50);
    expect(s[3]).toBeGreaterThan(10);
  });

  it("偶数窗口自动取奇数", () => {
    const v = Array(30).fill(0).map((_, i) => i);
    expect(smoothSeries(v, 4)).toEqual(smoothSeries(v, 5));
  });
});

describe("analyzeDrop", () => {
  it("识别掉速量/谷底/恢复时间", () => {
    const times = makeTimes();
    const v = makeDip(times, 4000, 600, 120);
    const m = analyzeDrop(times, v)!;
    expect(m.baseline).toBeCloseTo(4000, 0);
    expect(m.trough).toBeLessThan(3420);
    expect(m.trough).toBeGreaterThan(3350);
    expect(m.troughAtMs).toBeGreaterThan(100);
    expect(m.troughAtMs).toBeLessThan(140);
    expect(m.drop).toBeCloseTo(m.baseline - m.trough, 6);
    expect(m.dropPct).toBeCloseTo((m.drop / 4000) * 100, 3);
    expect(m.recoverMs).not.toBeNull();
    expect(m.recoverMs!).toBeGreaterThan(0);
  });

  it("无发射前数据返回 null", () => {
    const times = makeTimes(0, 1000); // 只有 t>=0
    const v = makeDip(times);
    expect(analyzeDrop(times, v)).toBeNull();
  });
});

describe("maxIntraGroupSpread", () => {
  it("计算组内最大轮间差", () => {
    const a = [10, 12, 11];
    const b = [10, 20, 11];
    const c = [10, 12, 15];
    expect(maxIntraGroupSpread([a, b, c])).toBe(8);
  });

  it("单通道为 0", () => {
    expect(maxIntraGroupSpread([[1, 2, 3]])).toBe(0);
  });
});
