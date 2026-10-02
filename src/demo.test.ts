import { beforeEach, describe, expect, it } from "vitest";
// ?raw：直接读磁盘上的示例数据文件。用行内导入避免给测试引入 node 类型依赖。
import demoText from "../public/demo/demo-10-1.json?raw";
import {
  demoTestIds,
  insertDemoProject,
  isDemoTest,
  parseDemoProject,
  removeDemoProject,
} from "./demo";
import { useAppStore } from "./store";
import type { TestSession } from "./types";

const demo = parseDemoProject(demoText);
const test = demo.tests[0];

function gaps(times: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] > lo && times[i] <= hi) out.push(times[i] - times[i - 1]);
  }
  return out;
}

/** 从 JPEG 数据里读出真实像素尺寸（扫 SOFn 段） */
function jpegSize(dataUrl: string): [number, number] {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  throw new Error("JPEG 尺寸解析失败");
}

describe("内置示例数据", () => {
  it("整包是一个单测试的 .rmtest（1 个测试 4 个组）", () => {
    expect(demo.tests).toHaveLength(1);
    expect(test.name.startsWith("示例数据")).toBe(true);
    expect(test.startedAt).toBeGreaterThan(0);
    expect(demo.groups).toHaveLength(4);
    expect(demo.groups.every((g) => g.testId === test.id)).toBe(true);
  });

  it("组名/参数/备注已统一，前 3 组老弹丸、第 4 组新弹丸", () => {
    expect(demo.groups.map((g) => g.name)).toEqual([
      "10-1 第1组 · 老弹丸",
      "10-1 第2组 · 老弹丸",
      "10-1 第3组 · 老弹丸",
      "10-1 第4组 · 新弹丸",
    ]);
    expect(demo.groups.map((g) => g.shots.length)).toEqual([28, 20, 27, 15]);
    demo.groups.slice(0, 3).forEach((g, i) => {
      expect(g.params.compression).toBe("1.5");
      expect(g.params.stage1_rpm).toBe("5200");
      expect(g.params.stage2_rpm).toBe("5000");
      expect(g.params.pid).toBe("0.024");
      expect(g.params.hardness).toBe("50a");
      expect(g.params.note).toBe(`老弹丸 · 第 ${i + 1} 组`);
    });
    expect(demo.groups[3].params.note).toBe("新弹丸 · 第 4 组");
  });

  it("每发都有波形，通道等长、索引与分配自洽", () => {
    for (const g of demo.groups) {
      const cfg = g.waveConfig!;
      expect(cfg.channelCount).toBe(8);
      expect(cfg.groups.map((x) => x.name)).toEqual(["一级", "二级"]);
      expect(cfg.groups.map((x) => x.channels)).toEqual([
        [0, 1, 2],
        [3, 4, 5],
      ]);
      expect(cfg.channelLabels[0]).toBe("一1");
      expect(cfg.channelLabels[5]).toBe("二3");
      // 留两个恒定通道，保证「隐藏平直通道」在示例里也能演示
      const kept = new Set([...cfg.groups[0].channels, ...cfg.groups[1].channels]);
      expect([...Object.keys(cfg.channelLabels)].length).toBe(8);
      expect([...kept].length).toBe(6);
      for (const sh of g.shots) {
        expect(sh.wave).toBeTruthy();
        const w = sh.wave!;
        expect(w.channels).toHaveLength(8);
        expect(w.times).toHaveLength(w.channels[0].length);
        // 发射前必须有足够的基线采样点（少数发因缓冲未装满会短一点）
        expect(w.times.filter((t) => t >= -200 && t <= -50).length).toBeGreaterThanOrEqual(50);
        for (const c of w.channels) {
          expect(c).toHaveLength(w.times.length);
          expect(c.some((v) => !Number.isFinite(v))).toBe(false);
          // 全零通道（未接线的槽位）不该留在示例数据里
          expect(c.every((v) => v === 0)).toBe(false);
        }
        // 最长的通道下标必须落在 times 范围内
        for (const ch of cfg.groups.flatMap((x) => x.channels)) {
          expect(ch).toBeLessThan(w.channels.length);
        }
      }
    }
  });

  it("发射段保留 1kHz 分辨率（掉速曲线与真实数据一致），尾段才抽稀", () => {
    for (const g of demo.groups) {
      const w = g.shots[0].wave!;
      // 发射段 [-200, 200]ms 内基本是 1ms 一格（原始数据本身有抖动，留一点余量）
      const fine = gaps(w.times, -201, 200);
      expect(fine.length).toBeGreaterThan(300);
      expect(Math.max(...fine)).toBeLessThanOrEqual(10);
      // 200ms 之后明显变粗
      const coarse = gaps(w.times, 300, 1000);
      const sorted = [...coarse].sort((a, b) => a - b);
      expect(sorted[sorted.length >> 1]).toBeGreaterThanOrEqual(3);
      // 整体点数明显少于原始的 1136
      expect(w.times.length).toBeLessThan(700);
    }
  });

  it("四组都带靶纸散布数据，图与标定点原样保留", () => {
    for (const g of demo.groups) {
      const d = g.dispersion!;
      expect(d).toBeTruthy();
      expect(d.points.length).toBeGreaterThan(0);
      expect(d.imageDataUrl?.startsWith("data:image/jpeg;base64,")).toBe(true);
      // 关键不变量：imgW/imgH 必须就是这张图真实的像素尺寸。
      // 标定点存的是图片像素坐标，图被缩放过而 imgW 没跟着改（或反过来）
      // 都会让所有点整体飘掉——这里直接从 JPEG 头里读真实尺寸来卡住它。
      const [w, h] = jpegSize(d.imageDataUrl!);
      expect(d.imgW).toBe(w);
      expect(d.imgH).toBe(h);
      for (const p of d.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(w);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(h);
      }
    }
  });

  it("整个文件控制在 5 MB 以内", () => {
    expect(new TextEncoder().encode(demoText).length).toBeLessThan(
      5 * 1024 * 1024
    );
  });
});

describe("示例数据的载入与移除", () => {
  const base = useAppStore.getState();

  beforeEach(() => {
    useAppStore.setState({
      tests: [],
      groups: [],
      activeTestId: null,
      viewingGroupId: null,
      nextTestId: 1,
      nextGroupId: 1,
      targetShots: base.targetShots,
      compareIds: [],
    });
  });

  it("按名字前缀识别示例测试", () => {
    const t = (id: number, name: string) =>
      ({ id, name, createdAt: 0, startedAt: 0 }) as TestSession;
    expect(isDemoTest(t(1, "示例数据：10-1 四次测试"))).toBe(true);
    expect(isDemoTest(t(2, "第一次测试"))).toBe(false);
    expect(demoTestIds([t(1, "示例数据：a"), t(2, "组"), t(3, "示例数据：b")])).toEqual([
      1, 3,
    ]);
  });

  it("并入后是一个独立新测试，可整包移除", () => {
    const mine = useAppStore.getState().startTest("我自己的测试");
    const id = insertDemoProject(demo)!;
    expect(id).not.toBeNull();
    expect(id).not.toBe(mine);

    const s = useAppStore.getState();
    expect(s.tests.map((t) => t.name)).toContain("示例数据：10-1 四次测试");
    expect(s.tests.filter(isDemoTest)).toHaveLength(1);
    // 示例组不改动原有测试
    expect(s.groups.filter((g) => g.testId === mine)).toHaveLength(0);
    expect(s.groups.filter((g) => g.testId === id)).toHaveLength(4);
    // 载入后自动选中示例测试的第一组
    expect(s.activeTestId).toBe(id);
    expect(s.viewingGroupId).toBe(s.groups.find((g) => g.testId === id)!.id);

    expect(removeDemoProject()).toBe(1);
    const after = useAppStore.getState();
    expect(after.tests.map((t) => t.name)).toEqual(["我自己的测试"]);
    expect(after.groups).toHaveLength(0);
  });

  it("重复并入时名字自动去重", () => {
    insertDemoProject(demo);
    insertDemoProject(demo);
    const names = useAppStore.getState().tests.map((t) => t.name);
    expect(names).toEqual([
      "示例数据：10-1 四次测试",
      "示例数据：10-1 四次测试(导入)",
    ]);
  });
});
