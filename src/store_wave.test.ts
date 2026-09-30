import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore, waveBuffer } from "./store";
import { buildJustFloatFrame } from "./justfloat";
import { SNAP_POST_MS, SNAP_PRE_MS } from "./wave";

/** 造一段 JustFloat 字节流：t 从 start 到 end，每 step ms 一帧，6 通道 */
function waveBytes(start: number, end: number, step = 5): number[] {
  const bytes: number[] = [];
  for (let t = start; t <= end; t += step) {
    bytes.push(...buildJustFloatFrame([100 + t % 7, 200, 300, 400, 500, 600]));
  }
  return bytes;
}

/** 直接给缓冲喂带准确时间戳的采样（绕过"字节到达时刻"误差） */
function feedSamples(start: number, end: number, step = 5) {
  for (let t = start; t <= end; t += step) {
    waveBuffer.push(t, [1, 2, 3, 4, 5, 6]);
  }
}

describe("store 波形链路", () => {
  beforeEach(() => {
    useAppStore.getState().clearAll();
    useAppStore.getState().setWaveConnected(null);
    useAppStore.setState({
      waveConnected: false,
      wavePortName: null,
      waveChannelCount: 0,
      waveFrames: 0,
    });
    waveBuffer.clear();
  });

  it("onWaveBytes 解析 JustFloat 并识别通道数", () => {
    const now = Date.now();
    useAppStore.getState().setWaveConnected("COM9");
    useAppStore.getState().onWaveBytes(now, waveBytes(now, now + 100));
    useAppStore.getState().tick(now + 200);
    expect(useAppStore.getState().waveChannelCount).toBe(6);
    expect(useAppStore.getState().waveFrames).toBeGreaterThan(10);
  });

  it("弹速帧到达后快照自动挂到该发", () => {
    const t0 = Date.now();
    const s = useAppStore.getState();
    s.setWaveConnected("COM9");
    // 预填发射前波形
    feedSamples(t0 - SNAP_PRE_MS - 100, t0 - 1);
    s.onFrame({ speed_mps: 15.5, speed_milli_mps: 15500, dt_us: 3226, at_ms: t0 });
    // 此刻快照还没齐
    let g = useAppStore.getState().groups[0];
    expect(g.shots[0].wave).toBeUndefined();
    // 补发射后波形并触发 tick
    feedSamples(t0, t0 + SNAP_POST_MS + 50);
    useAppStore.getState().tick(t0 + SNAP_POST_MS + 100);
    g = useAppStore.getState().groups[0];
    const wave = g.shots[0].wave;
    expect(wave).toBeDefined();
    expect(wave!.times[0]).toBeGreaterThanOrEqual(-SNAP_PRE_MS - 1);
    expect(wave!.times[wave!.times.length - 1]).toBeLessThanOrEqual(SNAP_POST_MS + 1);
    expect(wave!.channels).toHaveLength(6);
  });

  it("未连波形口时不登记快照", () => {
    const t0 = Date.now();
    useAppStore.getState().onFrame({
      speed_mps: 15.5,
      speed_milli_mps: 15500,
      dt_us: 3226,
      at_ms: t0,
    });
    useAppStore.getState().tick(t0 + SNAP_POST_MS + 1000);
    expect(useAppStore.getState().groups[0].shots[0].wave).toBeUndefined();
  });

  it("断开波形口清缓冲", () => {
    const now = Date.now();
    const s = useAppStore.getState();
    s.setWaveConnected("COM9");
    s.onWaveBytes(now, waveBytes(now, now + 50));
    expect(waveBuffer.length).toBeGreaterThan(0);
    s.setWaveConnected(null);
    expect(waveBuffer.length).toBe(0);
    expect(useAppStore.getState().waveConnected).toBe(false);
  });
});
