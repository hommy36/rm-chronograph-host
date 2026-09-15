import { describe, expect, it } from "vitest";
import {
  buildFrame,
  crc8Dji,
  ProtocolParser,
} from "./protocol_ts";
import { computeStats, deviations, histogram, movingAverageBand } from "./stats";

describe("protocol_ts（与 USART1_PROTOCOL.md §6 示例对应）", () => {
  it("crc8 与协议文档示例一致", () => {
    expect(crc8Dji([0x36, 0xa8, 0x61, 0x00, 0x00, 0xd0, 0x07, 0x00, 0x00])).toBe(0xf0);
    expect(crc8Dji([0x36, 0x88, 0x13, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00])).toBe(0x5c);
  });

  it("buildFrame 复现协议示例字节", () => {
    expect(buildFrame(25000, 2000)).toEqual([
      0x36, 0xa8, 0x61, 0x00, 0x00, 0xd0, 0x07, 0x00, 0x00, 0xf0,
    ]);
    expect(buildFrame(5000, 10000)).toEqual([
      0x36, 0x88, 0x13, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00, 0x5c,
    ]);
  });

  it("解析 25.000 / 5.000 m/s 示例帧", () => {
    const p = new ProtocolParser();
    const ev1 = p.feedSlice(buildFrame(25000, 2000));
    expect(ev1).toEqual([
      { kind: "frame", frame: { speedMilliMps: 25000, dtUs: 2000 } },
    ]);
    const ev2 = p.feedSlice(buildFrame(5000, 10000));
    expect(ev2).toEqual([
      { kind: "frame", frame: { speedMilliMps: 5000, dtUs: 10000 } },
    ]);
  });

  it("心跳与垃圾字节", () => {
    const p = new ProtocolParser();
    expect(p.feed(0x48)).toEqual({ kind: "heartbeat" });
    expect(p.feedSlice([0x00, 0x11, 0x22, 0x99, 0xff])).toEqual([]);
  });

  it("载荷内嵌 0x36/0x48 按普通字节处理", () => {
    const p = new ProtocolParser();
    const ev = p.feedSlice(buildFrame(0x00003648, 0x00004836));
    expect(ev).toEqual([
      { kind: "frame", frame: { speedMilliMps: 0x3648, dtUs: 0x4836 } },
    ]);
  });

  it("CRC 错误丢帧并重新同步", () => {
    const bad = buildFrame(25000, 2000);
    bad[9] ^= 0xff;
    const p = new ProtocolParser();
    const ev = p.feedSlice([...bad, ...buildFrame(5000, 10000)]);
    expect(ev).toEqual([
      { kind: "crcError" },
      { kind: "frame", frame: { speedMilliMps: 5000, dtUs: 10000 } },
    ]);
  });

  it("逐字节喂入与帧间心跳", () => {
    const p = new ProtocolParser();
    const frame = buildFrame(25000, 2000);
    const events = [0x48, ...frame, 0x48].flatMap((b) => {
      const e = p.feed(b);
      return e ? [e] : [];
    });
    expect(events.map((e) => e.kind)).toEqual(["heartbeat", "frame", "heartbeat"]);
  });
});

describe("stats", () => {
  const values = [15.7, 15.8, 15.9, 15.8, 15.7];

  it("computeStats：均值/极差/方差", () => {
    const s = computeStats(values)!;
    expect(s.n).toBe(5);
    expect(s.mean).toBeCloseTo(15.78, 6);
    expect(s.max).toBeCloseTo(15.9, 6);
    expect(s.min).toBeCloseTo(15.7, 6);
    expect(s.range).toBeCloseTo(0.2, 6);
    expect(s.variance).toBeCloseTo(0.0056, 6);
    expect(s.std).toBeCloseTo(Math.sqrt(0.0056), 9);
  });

  it("computeStats 空数组返回 null", () => {
    expect(computeStats([])).toBeNull();
  });

  it("histogram：计数与极值落箱", () => {
    const h = histogram([1, 1, 2, 3, 10], 3);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(Math.max(...h.counts)).toBe(h.counts[0]); // 1,1,2,3 在首箱
    expect(h.counts[2]).toBe(1); // 10 落入末箱
  });

  it("histogram：全部相等时单箱", () => {
    const h = histogram([2, 2, 2]);
    expect(h.centers).toEqual([2]);
    expect(h.counts).toEqual([3]);
  });

  it("deviations 相对均值", () => {
    const s = computeStats(values)!;
    const d = deviations(values, s.mean);
    expect(d[0]).toBeCloseTo(-0.08, 6);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });

  it("movingAverageBand：窗口 5，±1σ 包络", () => {
    const { ma, upper, lower } = movingAverageBand(values, 5);
    expect(ma.slice(0, 4)).toEqual([null, null, null, null]);
    expect(ma[4]).toBeCloseTo(15.78, 6);
    expect(upper[4]!).toBeCloseTo(15.78 + Math.sqrt(0.0056), 6);
    expect(lower[4]!).toBeCloseTo(15.78 - Math.sqrt(0.0056), 6);
  });
});
