import { describe, expect, it } from "vitest";
import {
  applyHighPass,
  DEFAULT_ENHANCE,
  isNoopEnhance,
  localBlurRadius,
  PRESET_HITS,
  replicateChannel,
} from "./enhance";

/** 造一张灰度测试图：灰底 + 一个"浅印记"（比背景暗 6 级） */
function makeGrayPatch(w: number, h: number, bg = 240, mark = 234) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inMark = x > w / 2 - 3 && x < w / 2 + 3 && y > h / 2 - 3 && y < h / 2 + 3;
      const v = inMark ? mark : bg;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** 均匀低频（模拟大半径模糊结果） */
function flat(w: number, h: number, v: number) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = a[i + 1] = a[i + 2] = v;
    a[i + 3] = 255;
  }
  return a;
}

describe("enhance 参数", () => {
  it("默认参数视为无需处理", () => {
    expect(isNoopEnhance(DEFAULT_ENHANCE)).toBe(true);
    expect(isNoopEnhance({ ...DEFAULT_ENHANCE, on: true })).toBe(true);
    expect(isNoopEnhance({ ...DEFAULT_ENHANCE, on: true, local: 1 })).toBe(false);
  });

  it("落点增强预设会真正做事", () => {
    expect(isNoopEnhance(PRESET_HITS)).toBe(false);
    expect(PRESET_HITS.local).toBeGreaterThan(0);
  });

  it("局部对比半径随图像尺寸缩放且有下限", () => {
    expect(localBlurRadius(4096, 3072)).toBe(Math.round(3072 / 40));
    expect(localBlurRadius(200, 120)).toBe(8);
  });
});

describe("applyHighPass", () => {
  it("背景减除后浅印记与背景的差异变大（更容易看见）", () => {
    const w = 60;
    const h = 60;
    const src = makeGrayPatch(w, h, 240, 234);
    const before = 240 - 234; // 6
    applyHighPass(src, flat(w, h, 237), null, 2, 0);
    const center = ((30 * w + 30) * 4);
    const corner = ((2 * w + 2) * 4);
    const after = src[corner] - src[center];
    expect(after).toBeGreaterThan(before * 2);
  });

  it("无低频时不做任何改动", () => {
    const src = makeGrayPatch(20, 20);
    const copy = Uint8ClampedArray.from(src);
    applyHighPass(src, null, null, 2, 1);
    expect(Array.from(src)).toEqual(Array.from(copy));
  });

  it("结果被夹在 0~255", () => {
    const w = 8;
    const h = 8;
    const src = makeGrayPatch(w, h, 250, 250);
    applyHighPass(src, flat(w, h, 10), flat(w, h, 10), 3, 3);
    for (let i = 0; i < src.length; i += 4) {
      expect(src[i]).toBeLessThanOrEqual(255);
      expect(src[i]).toBeGreaterThanOrEqual(0);
    }
    expect(src[0]).toBe(255);
  });

  it("replicateChannel 把 R 复制到 G/B（灰度图防偏色）", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    replicateChannel(data, 0);
    expect(Array.from(data)).toEqual([10, 10, 10, 255, 40, 40, 40, 255]);
  });
});
