import { describe, expect, it } from "vitest";
import {
  base64ToF32,
  deserializeSession,
  f32ToBase64,
  mergeImported,
  serializeSession,
} from "./persist";
import type { Group, TestSession } from "./types";
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
    testId: 1,
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
    tests: [
      {
        id: 1,
        name: "第一次测试",
        createdAt: 1_700_000_000_000,
        startedAt: 1_700_000_000_000,
      },
    ],
    groups: [group(1, "组1", true), group(2, "组2", false)],
    nextTestId: 2,
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
    const withWave = JSON.stringify(
      serializeSession({
        tests: [],
        groups: [g],
        nextTestId: 1,
        nextGroupId: 2,
        targetShots: 100,
        waveConfig: { groups: [], channelLabels: {} },
      })
    );
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

  it("散布分析数据随组往返", () => {
    const g = group(1, "组1", false);
    g.dispersion = {
      imageDataUrl: "data:image/jpeg;base64,/9j/AAAA",
      effSpec: { name: "A4·横向", w: 297, h: 210 },
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      texts: [{ x: 5, y: 6, text: "10 环", size: 18, color: "#f00" }],
      updatedAt: 1700000000000,
    };
    const text = JSON.stringify(
      serializeSession({
        tests: [{ id: 1, name: "第一次测试", createdAt: 0, startedAt: 0 }],
        groups: [g],
        nextTestId: 2,
        nextGroupId: 2,
        targetShots: 100,
        waveConfig: { groups: [], channelLabels: {} },
      })
    );
    const back = deserializeSession(text);
    const d = back.groups[0].dispersion!;
    expect(d.imageDataUrl).toContain("base64");
    expect(d.points).toHaveLength(2);
    expect(d.points[1]).toEqual({ x: 3, y: 4 });
    expect(d.texts[0].text).toBe("10 环");
    expect(d.effSpec.w).toBe(297);
  });

  it("组的波形通道分配随组往返（且不影响全局默认）", () => {
    const g = group(1, "组1", false);
    g.waveConfig = {
      groups: [{ id: 1, name: "一级", channels: [0, 2, 4] }],
      channelLabels: { 0: "一1", 2: "一2", 4: "一3" },
      channelCount: 14,
    };
    const text = JSON.stringify(
      serializeSession({
        tests: [{ id: 1, name: "第一次测试", createdAt: 0, startedAt: 0 }],
        groups: [g],
        nextTestId: 2,
        nextGroupId: 2,
        targetShots: 100,
        waveConfig: { groups: [], channelLabels: {} },
      })
    );
    const back = deserializeSession(text);
    expect(back.groups[0].waveConfig?.groups[0].channels).toEqual([0, 2, 4]);
    expect(back.groups[0].waveConfig?.channelCount).toBe(14);
    // 全局默认仍是传进去的那份，没被组配置污染
    expect(back.waveConfig.groups).toHaveLength(0);
  });

  it("旧文件（v1，无 tests）自动迁移成「第一次测试」", () => {
    const text = JSON.stringify({
      version: 1,
      savedAt: 0,
      nextGroupId: 3,
      targetShots: 100,
      waveConfig: { groups: [], channelLabels: {} },
      groups: [
        { id: 1, name: "组1", params: { ...EMPTY_PARAMS }, startedAt: 5000, shots: [] },
        { id: 2, name: "组2", params: { ...EMPTY_PARAMS }, startedAt: 9000, shots: [] },
      ],
    });
    const back = deserializeSession(text);
    expect(back.tests).toHaveLength(1);
    expect(back.tests[0].name).toBe("第一次测试");
    expect(back.tests[0].startedAt).toBe(5000); // 取最早一组的开始时间
    expect(back.groups.map((g) => g.testId)).toEqual([1, 1]);
    expect(back.groups[0].dispersion).toBeUndefined();
    expect(back.nextTestId).toBe(2);
  });
});

describe("导入（按测试合并）", () => {
  it("文件里的测试变成新测试，组重编号且归到新测试下", () => {
    const existing = {
      tests: [{ id: 1, name: "第一次测试", createdAt: 0, startedAt: 0 }],
      groups: [group(1, "组1", false)],
    };
    const incoming = {
      tests: [{ id: 1, name: "第一次测试", createdAt: 0, startedAt: 0 }],
      groups: [group(1, "组1", false), group(2, "组2", false)],
    };
    const r = mergeImported(existing, incoming, {
      nextTestId: 2,
      nextGroupId: 2,
    });
    expect(r.tests).toHaveLength(2);
    expect(r.tests[1].name).toBe("第一次测试(导入)"); // 重名加后缀
    const importedGroups = r.groups.filter((g) => g.testId === 2);
    expect(importedGroups).toHaveLength(2);
    expect(importedGroups.map((g) => g.id)).toEqual([2, 3]);
    expect(r.nextGroupId).toBe(4);
    expect(r.nextTestId).toBe(3);
  });

  it("旧格式（无 tests）整包包装成一个测试", () => {
    const existing = { tests: [], groups: [] as Group[] };
    const incoming = {
      tests: [] as TestSession[],
      groups: [group(1, "组1", false)],
    };
    const r = mergeImported(existing, incoming, { nextTestId: 1, nextGroupId: 1 });
    expect(r.tests).toHaveLength(1);
    expect(r.tests[0].name).toBe("导入测试");
    expect(r.groups[0].testId).toBe(1);
  });
});
