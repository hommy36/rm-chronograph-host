import { describe, expect, it } from "vitest";
import {
  base64ToF32,
  deserializeSession,
  f32ToBase64,
  mergeImported,
  serializeSession,
} from "./persist";
import type { Group } from "./types";
import { EMPTY_PARAMS } from "./types";
import type { WaveSnapshot } from "./wave";

function snap(t0: number): WaveSnapshot {
  const times: number[] = [];
  for (let t = -200; t <= 1000; t += 5) times.push(t);
  const mk = (base: number) => times.map((t) => base + (t >= 0 ? -50 * (t / 100) : 0));
  return { t0, times, channels: [mk(4000), mk(4800)] };
}

function group(id: number, name: string, withWave: boolean): Group {
  const t0 = 1_700_000_000_000;
  return {
    id,
    name,
    params: { ...EMPTY_PARAMS, stage1_rpm: "405" },
    startedAt: t0,
    shots: [1, 2].map((i) => ({
      idx: i,
      speed_mps: 15.5 + i * 0.001,
      dt_us: 3200,
      at_ms: t0 + i * 1000,
      wave: withWave ? snap(t0 + i * 1000) : undefined,
    })),
  };
}

describe("float32 base64 编解码", () => {
  it("往返保持 f32 精度", () => {
    const values = [0, 1.5, -42.25, 4000.125, 1e-8];
    const back = base64ToF32(f32ToBase64(values));
    values.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 3));
  });

  it("大数据量往返", () => {
    const values = Array.from({ length: 5000 }, (_, i) => i * 0.37 - 900);
    const back = base64ToF32(f32ToBase64(values));
    expect(back).toHaveLength(5000);
    expect(back[4999]).toBeCloseTo(values[4999], 3);
  });

  it("损坏数据抛错", () => {
    expect(() => base64ToF32(btoa("abc"))).toThrow();
  });
});

describe("会话序列化", () => {
  const session = {
    groups: [group(1, "组1", true), group(2, "组2", false)],
    nextGroupId: 3,
    targetShots: 100,
    waveConfig: { groups: [{ id: 1, name: "一级", channels: [0, 2] }], channelLabels: { 0: "一1" } },
  };

  it("往返保留组/发/波形", () => {
    const text = JSON.stringify(serializeSession(session));
    const back = deserializeSession(text);
    expect(back.groups).toHaveLength(2);
    expect(back.nextGroupId).toBe(3);
    expect(back.waveConfig.groups[0].name).toBe("一级");
    const shot = back.groups[0].shots[0];
    expect(shot.wave).toBeDefined();
    expect(shot.wave!.times).toHaveLength(241);
    expect(shot.wave!.channels).toHaveLength(2);
    expect(shot.wave!.channels[0][0]).toBeCloseTo(4000, 2);
    expect(back.groups[1].shots[0].wave).toBeUndefined();
  });

  it("波形编码后小于 JSON 数字数组（真实精度数据）", () => {
    // 真实转速数据是 f32 全精度（如 5197.6240234375），JSON 数字约 15 字符/点
    const realSnap: WaveSnapshot = {
      t0: 1_700_000_000_000,
      times: Array.from({ length: 300 }, (_, i) => (i - 60) * 5),
      channels: [
        Array.from({ length: 300 }, (_, i) => 5197.6240234375 + Math.sin(i) * 37.13),
        Array.from({ length: 300 }, (_, i) => 4802.19140625 + Math.cos(i) * 21.7),
      ],
    };
    const g: Group = { ...group(1, "组1", true), shots: [{ idx: 1, speed_mps: 15.5, dt_us: 3200, at_ms: 0, wave: realSnap }] };
    const withWave = JSON.stringify(serializeSession({ groups: [g], nextGroupId: 2, targetShots: 100, waveConfig: { groups: [], channelLabels: {} } }));
    const raw = JSON.stringify(g);
    expect(withWave.length).toBeLessThan(raw.length * 0.8);
  });

  it("nextGroupId 过小时按最大组号修正", () => {
    const text = JSON.stringify({ ...serializeSession(session), nextGroupId: 0 });
    expect(deserializeSession(text).nextGroupId).toBe(3);
  });

  it("非法文件抛错", () => {
    expect(() => deserializeSession("{}")).toThrow();
  });
});

describe("导入合并", () => {
  it("重编号并避免重名", () => {
    const existing = [group(1, "组1", false)];
    const incoming = [group(1, "组1", false), group(2, "新组", false)];
    const { groups, nextGroupId } = mergeImported(existing, incoming, 2);
    expect(groups.map((g) => g.id)).toEqual([1, 2, 3]);
    expect(groups[1].name).toBe("组1(导入)");
    expect(groups[2].name).toBe("新组");
    expect(nextGroupId).toBe(4);
  });
});
