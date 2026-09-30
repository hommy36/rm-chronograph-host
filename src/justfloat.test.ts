import { describe, expect, it } from "vitest";
import { buildJustFloatFrame, JustFloatParser } from "./justfloat";

describe("justfloat", () => {
  it("解析单帧多通道", () => {
    const p = new JustFloatParser();
    const frames = p.feed(buildJustFloatFrame([1.5, -2.25, 3000]));
    expect(frames).toHaveLength(1);
    expect(frames[0].channels).toHaveLength(3);
    expect(frames[0].channels[0]).toBeCloseTo(1.5, 6);
    expect(frames[0].channels[1]).toBeCloseTo(-2.25, 6);
    expect(frames[0].channels[2]).toBeCloseTo(3000, 4);
  });

  it("分包喂入也能解析(尾帧被拆开)", () => {
    const p = new JustFloatParser();
    const bytes = buildJustFloatFrame([42, 43]);
    const frames = [
      ...p.feed(bytes.slice(0, 5)),
      ...p.feed(bytes.slice(5, 10)),
      ...p.feed(bytes.slice(10)),
    ];
    expect(frames).toHaveLength(1);
    expect(frames[0].channels[0]).toBeCloseTo(42, 6);
    expect(frames[0].channels[1]).toBeCloseTo(43, 6);
  });

  it("连续多帧一次喂入", () => {
    const p = new JustFloatParser();
    const bytes = [
      ...buildJustFloatFrame([1]),
      ...buildJustFloatFrame([2, 3]),
      ...buildJustFloatFrame([4]),
    ];
    const frames = p.feed(bytes);
    expect(frames).toHaveLength(3);
    expect(frames[0].channels).toEqual([1]);
    expect(frames[1].channels).toEqual([2, 3]);
    expect(frames[2].channels).toEqual([4]);
  });

  it("噪声段丢弃后下一帧恢复同步", () => {
    const p = new JustFloatParser();
    const frames = p.feed([
      0x11, 0x22, 0x33, // 3 字节垃圾, 与后一帧负载拼成长度非 4 倍数的坏段
      ...buildJustFloatFrame([7.5]), // 被噪声污染, 丢弃
      ...buildJustFloatFrame([9.25]), // 重新同步
    ]);
    expect(frames).toHaveLength(1);
    expect(frames[0].channels[0]).toBeCloseTo(9.25, 6);
  });

  it("空喂入不产生帧", () => {
    const p = new JustFloatParser();
    expect(p.feed([])).toHaveLength(0);
  });
});
