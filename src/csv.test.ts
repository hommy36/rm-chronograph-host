import { describe, expect, it } from "vitest";
import { buildAllGroupsCsv, buildGroupCsv, buildOverviewCsv } from "./csv";
import { groupSummary } from "./analysis";
import type { Group, WaveConfig } from "./types";
import { EMPTY_PARAMS } from "./types";
import type { WaveSnapshot } from "./wave";

const CFG: WaveConfig = {
  groups: [
    { id: 1, name: "一级", channels: [0, 1] },
    { id: 2, name: "二级", channels: [2, 3] },
  ],
  channelLabels: { 0: "一1", 1: "一2", 2: "二1", 3: "二2" },
};

/** 4 通道快照: 发射后各通道跌 400/300/200/100 */
function makeSnap(t0: number): WaveSnapshot {
  const times: number[] = [];
  for (let t = -200; t <= 1000; t += 10) times.push(t);
  const mk = (depth: number) =>
    times.map((t) => {
      if (t < 0) return 4000;
      const x = t / 120;
      return 4000 - depth * x * Math.exp(1 - x);
    });
  return { t0, times, channels: [mk(400), mk(300), mk(200), mk(100)] };
}

function makeGroup(withWave: boolean): Group {
  const t0 = Date.now();
  return {
    id: 1,
    testId: 1,
    name: "组1",
    params: { ...EMPTY_PARAMS, stage1_rpm: "4500" },
    startedAt: t0 - 60000,
    shots: [1, 2].map((i) => ({
      idx: i,
      speed_mps: 15.5 + i * 0.01,
      dt_us: 3200,
      at_ms: t0 + i * 1000,
      wave: withWave ? makeSnap(t0 + i * 1000) : undefined,
    })),
  };
}

describe("csv 摩擦轮数据导出", () => {
  it("明细 CSV 带配置时追加掉速指标列", () => {
    const csv = buildGroupCsv(makeGroup(true), CFG);
    const lines = csv.split(String.fromCharCode(13, 10));
    const header = lines.find((l) => l.startsWith("序号"))!;
    expect(header).toContain("一1基线");
    expect(header).toContain("一1掉速%");
    expect(header).toContain("一级轮间差");
    expect(header).toContain("二级轮间差");
    const row = lines.find((l) => l.startsWith("1,"))!;
    const cells = row.split(",");
    // 4 基础列 + 4 通道 × 4 指标 + 2 组轮间差 = 22
    expect(cells.length).toBe(22);
    // 一1 掉速约 400
    const drop = Number(cells[4 + 1]);
    expect(drop).toBeGreaterThan(300);
    expect(drop).toBeLessThan(450);
  });

  it("不传配置时明细列保持原样", () => {
    const csv = buildGroupCsv(makeGroup(true));
    const header = csv.split(String.fromCharCode(13, 10)).find((l) => l.startsWith("序号"))!;
    expect(header).toBe("序号,弹速(m/s),dt(us),接收时间");
  });

  it("汇总 CSV 带配置时追加轮组均值列", () => {
    const csv = buildAllGroupsCsv([makeGroup(true)], CFG);
    const [header, row] = csv.split(String.fromCharCode(13, 10));
    expect(header).toContain("一级平均掉速%");
    expect(header).toContain("一级平均轮间差");
    const cells = row.split(",");
    // 一级平均掉速% ≈ (10% + 7.5%) / 2 = 8.75
    const idx = header.split(",").indexOf("一级平均掉速%");
    const v = Number(cells[idx]);
    expect(v).toBeGreaterThan(7);
    expect(v).toBeLessThan(11);
  });

  it("无快照的发行留空不报错", () => {
    const g = makeGroup(false);
    const csv = buildGroupCsv(g, CFG);
    // 没有任何快照: 不加列
    expect(csv.split(String.fromCharCode(13, 10)).find((l) => l.startsWith("序号"))).toBe(
      "序号,弹速(m/s),dt(us),接收时间"
    );
  });
});

describe("buildOverviewCsv（测试总览导出）", () => {
  const mk = (id: number, name: string, speeds: number[]) => {
    const t0 = 1_700_000_000_000;
    return {
      id,
      name,
      params: { ...EMPTY_PARAMS, stage1_rpm: "5200", hardness: "50a" },
      startedAt: t0,
      shots: speeds.map((v, i) => ({
        idx: i + 1,
        speed_mps: v,
        dt_us: 3200,
        at_ms: t0 + i * 1500,
      })),
    } as Group;
  };

  it("表头齐全、目标弹速写入首行、数值与表格一致", () => {
    const rows = [
      groupSummary(mk(1, "组A", [15.5, 15.6, 15.55, 15.58]), CFG, null, {
        target: 15.75,
      }),
      groupSummary(mk(2, "组B", [15.7, 15.8, 15.75, 15.78]), CFG, null, {
        target: 15.75,
      }),
    ];
    const csv = buildOverviewCsv(rows, 15.75, 1);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.split(String.fromCharCode(13, 10));
    expect(lines[0]).toContain("目标弹速,15.750");
    expect(lines[1]).toContain("组名,一级转速");
    expect(lines[1]).toContain("达标率(±1%)");
    expect(lines[1]).toContain("散布半径R50(mm)");
    const rowA = lines[2].split(",");
    expect(rowA[0]).toBe("组A");
    expect(rowA[6]).toBe("4"); // 发数
    expect(rowA[7]).toBe("15.5575"); // 均值
    // 目标 15.75 ±1% → 组A 只有 15.6 达标（1/4）
    expect(rowA[13]).toBe("25.0%");
  });

  it("未指定目标时标注为各组均值", () => {
    const rows = [groupSummary(mk(1, "组A", [15.5]), CFG, null)];
    const csv = buildOverviewCsv(rows, null, 2);
    expect(csv.split(String.fromCharCode(13, 10))[0]).toContain("目标弹速,各组均值");
    expect(csv.split(String.fromCharCode(13, 10))[1]).toContain("达标率(±2%)");
  });
});
