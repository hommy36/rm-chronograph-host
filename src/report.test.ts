import { describe, expect, it } from "vitest";
import { buildOverviewCsv, buildOverviewMarkdown, correlationTable } from "./report";
import { groupSummary } from "./analysis";
import type { Group, WaveConfig } from "./types";
import { EMPTY_PARAMS } from "./types";

const CFG: WaveConfig = { groups: [], channelLabels: {} };

function group(
  id: number,
  name: string,
  speeds: number[],
  params: Partial<typeof EMPTY_PARAMS> = {},
  dispersion?: { x: number; y: number }[]
): Group {
  const t0 = 1_700_000_000_000;
  return {
    id,
    name,
    params: { ...EMPTY_PARAMS, ...params },
    startedAt: t0,
    shots: speeds.map((v, i) => ({
      idx: i + 1,
      speed_mps: v,
      dt_us: 3200,
      at_ms: t0 + i * 1500,
    })),
    ...(dispersion
      ? {
          dispersion: {
            effSpec: { name: "A4·横向", w: 297, h: 210 },
            imgW: 1920,
            imgH: 1358,
            points: dispersion.map((p) => ({ x: 960 + p.x * 6.4, y: 679 + p.y * 6.4 })),
            texts: [],
            updatedAt: 0,
          },
        }
      : {}),
  };
}

const groups = [
  group(1, "组A", [15.5, 15.6, 15.55, 15.58], { stage1_rpm: "5000", hardness: "50a" }),
  group(2, "组B", [15.7, 15.8, 15.75, 15.78], { stage1_rpm: "5500", hardness: "50a" }),
  group(3, "组C", [15.9, 16.0, 15.95, 15.98], {
    stage1_rpm: "6000",
    hardness: "60a",
  }, [
    { x: 5, y: 0 },
    { x: -5, y: 0 },
    { x: 0, y: 5 },
    { x: 0, y: -5 },
  ]),
];

describe("correlationTable", () => {
  it("转速与均值正相关 r≈1", () => {
    const rows = groups.map((g) => groupSummary(g, CFG, null));
    const t = correlationTable(rows);
    const hit = t.find((c) => c.param === "一级转速" && c.metric === "均值(m/s)")!;
    expect(hit.n).toBe(3);
    expect(hit.r!).toBeCloseTo(1, 6);
    // 无法解析的参数（PID 为空）不产生结论
    const pid = t.find((c) => c.param.startsWith("PID"))!;
    expect(pid.r).toBeNull();
  });
});

describe("buildOverviewCsv", () => {
  it("含表头与各组件数值，且目标弹速写入首行", () => {
    const rows = groups.map((g) => groupSummary(g, CFG, null));
    const csv = buildOverviewCsv(rows, 15.75, 1);
    expect(csv.startsWith("\ufeff")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("目标弹速,15.750");
    expect(lines[1]).toContain("组名,一级转速");
    expect(lines[1]).toContain("达标率(±1%)");
    expect(lines).toHaveLength(1 + 1 + 3 + 1); // 目标行 + 表头 + 3 组 + 末尾空行
    const rowA = lines[2].split(",");
    expect(rowA[0]).toBe("组A");
    expect(rowA[6]).toBe("4"); // 发数
    expect(rowA[7]).toBe("15.5575"); // 均值
  });
});

describe("buildOverviewMarkdown", () => {
  const rows = groups.map((g) => groupSummary(g, CFG, null));

  it("包含各章节与关键数值", () => {
    const md = buildOverviewMarkdown({
      rows,
      groups,
      cfgOf: () => CFG,
      target: 15.75,
      tolPct: 1,
      generatedAt: new Date("2026-10-02T10:00:00"),
    });
    expect(md).toContain("# 测速测试总结");
    expect(md).toContain("## 一、逐组总览");
    expect(md).toContain("## 二、稳定性与异常");
    expect(md).toContain("## 三、散布分析");
    expect(md).toContain("## 四、参数与结果的相关性");
    expect(md).toContain("### 组A（4 发）");
    expect(md).toContain("15.5575"); // 均值
    expect(md).toContain("一级转速 | 均值(m/s)");
    expect(md).toContain("组C"); // 有散布的组
    expect(md).toContain("小装甲命中率");
  });

  it("空数据不崩且给出提示", () => {
    const md = buildOverviewMarkdown({
      rows: [],
      groups: [],
      cfgOf: () => CFG,
      target: null,
      tolPct: 1,
      generatedAt: new Date("2026-10-02T10:00:00"),
    });
    expect(md).toContain("0 组 / 0 发");
    expect(md).toContain("暂无可分析的参数差异");
  });

  it("带对比章节时包含显著性列", () => {
    const md = buildOverviewMarkdown({
      rows,
      groups,
      cfgOf: () => CFG,
      target: null,
      tolPct: 1,
      compare: [groups[0], groups[2]],
      generatedAt: new Date("2026-10-02T10:00:00"),
    });
    expect(md).toContain("## 五、两组对比（组A vs 组C）");
    expect(md).toContain("95% CI");
    expect(md).toContain("Welch t 检验");
  });
});
