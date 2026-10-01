import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import {
  Button,
  Card,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  DownloadOutlined,
  FileMarkdownOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store";
import { groupDispersion } from "../compare";
import {
  buildOverviewCsv,
  buildOverviewMarkdown,
  correlationTable,
  METRIC_DEFS,
  PARAM_DEFS,
} from "../report";
import {
  dispersionGeometry,
  groupSummary,
  hotGunDelta,
  intervalStats,
  lowRuns,
  outliers,
  parseParam,
  trendSlope,
  type GroupSummaryRow,
} from "../analysis";
import { saveCsv, saveText } from "../csv";

const TARGET_KEY = "rm-chrono-target-speed";

function loadTarget(): number | null {
  try {
    const v = Number(localStorage.getItem(TARGET_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

const fmt = (v: number | null | undefined, d = 3, suffix = "") =>
  v === null || v === undefined || !Number.isFinite(v) ? "-" : `${v.toFixed(d)}${suffix}`;

/** 测试总览：逐组汇总表 + 当前组稳定性 + 参数↔结果关联 + 报告导出 */
export default function OverviewPanel() {
  const groups = useAppStore((s) => s.groups);
  const globalCfg = useAppStore((s) => s.waveConfig);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const setViewingGroup = useAppStore((s) => s.setViewingGroup);
  const compareIds = useAppStore((s) => s.compareIds);

  const [target, setTarget] = useState<number | null>(loadTarget);
  const [tolPct, setTolPct] = useState<number>(1);
  const [paramKey, setParamKey] = useState<string>("stage1_rpm");
  const [metricKey, setMetricKey] = useState<keyof GroupSummaryRow>("mean");
  const [busy, setBusy] = useState(false);

  const setTargetPersist = (v: number | null) => {
    setTarget(v);
    try {
      if (v === null) localStorage.removeItem(TARGET_KEY);
      else localStorage.setItem(TARGET_KEY, String(v));
    } catch {
      // 忽略持久化失败
    }
  };

  const summaryRows = useMemo(
    () =>
      groups.map((g) => {
        const side = groupDispersion(g);
        return groupSummary(
          g,
          g.waveConfig ?? globalCfg,
          side.hasData ? side.pointsMm : null,
          { target }
        );
      }),
    [groups, globalCfg, target]
  );

  const corrRows = useMemo(() => correlationTable(summaryRows), [summaryRows]);

  /** 关联散点：参数（数值化）× 结果指标 */
  const scatterOption = useMemo<EChartsOption>(() => {
    const label =
      PARAM_DEFS.find((p) => p.key === paramKey)?.label ?? paramKey;
    const metricLabel =
      METRIC_DEFS.find((m) => m.key === metricKey)?.label ?? String(metricKey);
    const pts: [number, number][] = [];
    for (const r of summaryRows) {
      const x = parseParam(r.params[paramKey as keyof typeof r.params]);
      const y = r[metricKey] as number | null;
      if (x === null || y === null) continue;
      pts.push([x, y]);
    }
    const c = correlationTable(summaryRows).find(
      (x) => x.param === label && x.metric === metricLabel
    );
    const xs = pts.map((p) => p[0]);
    const line =
      c?.r != null && xs.length >= 3 && Math.min(...xs) !== Math.max(...xs)
        ? (() => {
            const n = pts.length;
            const mx = xs.reduce((a, b) => a + b, 0) / n;
            const my = pts.reduce((a, p) => a + p[1], 0) / n;
            const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
            const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
            const k = sxx === 0 ? 0 : sxy / sxx;
            const b = my - k * mx;
            const lo = Math.min(...xs);
            const hi = Math.max(...xs);
            return [
              [lo, k * lo + b],
              [hi, k * hi + b],
            ];
          })()
        : null;
    return {
      animation: true,
      animationDuration: 250,
      grid: { left: 70, right: 24, top: 34, bottom: 52 },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const it = p as { value: [number, number]; seriesName: string };
          return `${label} ${it.value[0]}<br/>${metricLabel} ${Number(
            it.value[1]
          ).toFixed(4)}`;
        },
      },
      xAxis: { type: "value", name: label, nameLocation: "middle", nameGap: 28 },
      yAxis: { type: "value", name: metricLabel, scale: true },
      series: [
        { name: "各组", type: "scatter", data: pts, symbolSize: 14 },
        ...(line
          ? [
              {
                name: "回归线",
                type: "line" as const,
                data: line,
                showSymbol: false,
                lineStyle: { type: "dashed" as const, color: "#fa541c" },
              },
            ]
          : []),
      ] as SeriesOption[],
    };
  }, [summaryRows, paramKey, metricKey]);

  const currentCorr = useMemo(() => {
    const label = PARAM_DEFS.find((p) => p.key === paramKey)?.label ?? paramKey;
    const metricLabel =
      METRIC_DEFS.find((m) => m.key === metricKey)?.label ?? String(metricKey);
    return corrRows.find((c) => c.param === label && c.metric === metricLabel);
  }, [corrRows, paramKey, metricKey]);

  /** 当前查看组的稳定性明细（C） */
  const insight = useMemo(() => {
    const g = groups.find((x) => x.id === viewingGroupId) ?? null;
    if (!g || g.shots.length === 0) return null;
    const values = g.shots.map((s) => s.speed_mps);
    const geoPts = groupDispersion(g);
    return {
      group: g,
      outliers: outliers(values),
      lows: lowRuns(values),
      slope: trendSlope(values),
      hot: hotGunDelta(values),
      intervals: intervalStats(g.shots.map((s) => s.at_ms)),
      geo: geoPts.hasData ? dispersionGeometry(geoPts.pointsMm) : null,
    };
  }, [groups, viewingGroupId]);

  const handleExportMd = async () => {
    setBusy(true);
    try {
      const cmp =
        compareIds.length === 2
          ? ([
              groups.find((g) => g.id === compareIds[0]),
              groups.find((g) => g.id === compareIds[1]),
            ].filter(Boolean) as [typeof groups[0], typeof groups[0]])
          : null;
      const md = buildOverviewMarkdown({
        rows: summaryRows,
        groups,
        cfgOf: (g) => g.waveConfig ?? globalCfg,
        target,
        tolPct,
        compare: cmp && cmp.length === 2 ? cmp : null,
      });
      const ok = await saveText(
        `测速测试总结_${new Date().toISOString().slice(0, 10)}.md`,
        md,
        "Markdown",
        "md",
        "text/markdown;charset=utf-8"
      );
      if (ok) message.success("测试报告已导出");
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = async () => {
    setBusy(true);
    try {
      const ok = await saveCsv(
        `测试总览_${new Date().toISOString().slice(0, 10)}.csv`,
        buildOverviewCsv(summaryRows, target, tolPct)
      );
      if (ok) message.success("总览已导出");
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const passOf = (r: GroupSummaryRow) =>
    tolPct === 0.5 ? r.pass05 : tolPct === 2 ? r.pass2 : r.pass1;

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <span>测试总览</span>
          <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
            共 {groups.length} 组 / {groups.reduce((a, g) => a + g.shots.length, 0)} 发
          </span>
        </Space>
      }
      extra={
        <Space size={8}>
          <span style={{ fontSize: 12, color: "#888" }}>目标弹速</span>
          <InputNumber
            size="small"
            min={1}
            max={100}
            step={0.05}
            style={{ width: 92 }}
            placeholder="各组均值"
            value={target ?? undefined}
            onChange={(v) => setTargetPersist(v === null ? null : Number(v))}
          />
          <span style={{ fontSize: 12, color: "#888" }}>容差</span>
          <Select
            size="small"
            style={{ width: 80 }}
            value={tolPct}
            onChange={setTolPct}
            options={[
              { value: 0.5, label: "±0.5%" },
              { value: 1, label: "±1%" },
              { value: 2, label: "±2%" },
            ]}
          />
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={busy}
            disabled={groups.length === 0}
            onClick={handleExportCsv}
          >
            总览 CSV
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<FileMarkdownOutlined />}
            loading={busy}
            disabled={groups.length === 0}
            onClick={handleExportMd}
          >
            导出测试报告
          </Button>
        </Space>
      }
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
      styles={{ body: { flex: 1, minHeight: 0, overflow: "auto", padding: 8 } }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Table<GroupSummaryRow>
          size="small"
          rowKey="id"
          dataSource={summaryRows}
          pagination={false}
          scroll={{ x: "max-content" }}
          onRow={(r) => ({
            onClick: () => setViewingGroup(r.id),
            style: {
              cursor: "pointer",
              background: r.id === viewingGroupId ? "#e6f4ff" : undefined,
            },
          })}
          columns={[
            { title: "组名", dataIndex: "name", fixed: "left", width: 100 },
            { title: "一级", dataIndex: ["params", "stage1_rpm"], width: 72 },
            { title: "二级", dataIndex: ["params", "stage2_rpm"], width: 72 },
            { title: "PID", dataIndex: ["params", "pid"], width: 110, ellipsis: true },
            { title: "压缩量", dataIndex: ["params", "compression"], width: 70 },
            { title: "硬度", dataIndex: ["params", "hardness"], width: 70 },
            { title: "发数", dataIndex: "n", width: 60, sorter: (a, b) => a.n - b.n },
            {
              title: "均值 (m/s)",
              dataIndex: "mean",
              width: 100,
              sorter: (a, b) => (a.mean ?? 0) - (b.mean ?? 0),
              render: (v: number | null) => fmt(v, 4),
            },
            {
              title: "极差",
              dataIndex: "range",
              width: 80,
              sorter: (a, b) => (a.range ?? 0) - (b.range ?? 0),
              render: (v: number | null) => fmt(v, 3),
            },
            {
              title: "标准差",
              dataIndex: "std",
              width: 84,
              sorter: (a, b) => (a.std ?? 0) - (b.std ?? 0),
              render: (v: number | null) => fmt(v, 4),
            },
            {
              title: "CV%",
              dataIndex: "cv",
              width: 70,
              sorter: (a, b) => (a.cv ?? 0) - (b.cv ?? 0),
              render: (v: number | null) => fmt(v, 2),
            },
            {
              title: `达标率 ±${tolPct}%`,
              key: "pass",
              width: 96,
              render: (_: unknown, r) => {
                const p = passOf(r);
                if (p === null) return "-";
                return (
                  <span
                    style={{
                      color: p >= 0.9 ? "#52c41a" : p >= 0.7 ? "#faad14" : "#f5222d",
                    }}
                  >
                    {(p * 100).toFixed(0)}%
                  </span>
                );
              },
            },
            {
              title: "离群",
              dataIndex: "outlierCount",
              width: 62,
              render: (v: number) =>
                v > 0 ? (
                  <Tooltip title={`|z| ≥ 2.5 的发数：${v}`}>
                    <Tag color="orange" icon={<WarningOutlined />}>
                      {v}
                    </Tag>
                  </Tooltip>
                ) : (
                  <span style={{ color: "#bbb" }}>0</span>
                ),
            },
            {
              title: "趋势/发",
              dataIndex: "trend",
              width: 86,
              render: (v: number | null) => fmt(v, 4),
            },
            {
              title: "R50 (mm)",
              dataIndex: "r50",
              width: 88,
              sorter: (a, b) => (a.r50 ?? 1e9) - (b.r50 ?? 1e9),
              render: (v: number | null) => fmt(v, 2),
            },
            {
              title: "平均环数",
              dataIndex: "meanRing",
              width: 88,
              render: (v: number | null) => fmt(v, 2),
            },
            {
              title: "平均掉速%",
              dataIndex: "wheelDropPct",
              width: 96,
              sorter: (a, b) => (a.wheelDropPct ?? 0) - (b.wheelDropPct ?? 0),
              render: (v: number | null) => fmt(v, 2),
            },
          ]}
        />

        {insight && (
          <Card
            size="small"
            title={`稳定性与异常 — ${insight.group.name}`}
            styles={{ body: { padding: "8px 12px" } }}
          >
            <Space direction="vertical" size={4} style={{ fontSize: 13 }}>
              <span>
                <b>离群发</b>（|z| ≥ 2.5）：
                {insight.outliers.length === 0
                  ? "无"
                  : insight.outliers
                      .map(
                        (o) =>
                          `第 ${o.idx} 发 ${o.value.toFixed(3)}（z=${o.z.toFixed(1)}）`
                      )
                      .join("、")}
              </span>
              <span>
                <b>连续偏低段</b>（&lt; 均值−1.2σ 且连续 ≥2 发）：
                {insight.lows.length === 0
                  ? "无"
                  : insight.lows
                      .map(
                        (r) =>
                          `第 ${r.from}–${r.to} 发（均值 ${r.mean.toFixed(3)}）`
                      )
                      .join("、")}
              </span>
              <span>
                <b>趋势</b>：{fmt(insight.slope, 4)} m/s 每发（正=越打越快）；
                <b> 热枪效应</b>（后3发−前3发）：{fmt(insight.hot, 4)} m/s
              </span>
              {insight.intervals && (
                <span>
                  <b>发弹节奏</b>：中位 {insight.intervals.median.toFixed(2)} s（最快{" "}
                  {insight.intervals.min.toFixed(2)} / 最慢{" "}
                  {insight.intervals.max.toFixed(2)}）
                </span>
              )}
              {insight.geo && (
                <span>
                  <b>散布几何</b>：弹着中心偏移 {insight.geo.dist.toFixed(1)} mm（
                  {insight.geo.dx >= 0 ? "右" : "左"}
                  {Math.abs(insight.geo.dx).toFixed(1)} ·{" "}
                  {insight.geo.dy >= 0 ? "下" : "上"}
                  {Math.abs(insight.geo.dy).toFixed(1)}）；Cx·Cy{" "}
                  {insight.geo.cx.toFixed(1)} / {insight.geo.cy.toFixed(1)} mm；R50{" "}
                  {insight.geo.r50.toFixed(2)} mm；纵横比{" "}
                  {insight.geo.aspect.toFixed(2)}
                </span>
              )}
            </Space>
          </Card>
        )}

        <Card
          size="small"
          title={
            <Space size={8}>
              <span>参数 → 结果 关联</span>
              {currentCorr && currentCorr.r !== null && (
                <Tag color={Math.abs(currentCorr.r) > 0.7 ? "green" : "default"}>
                  r = {currentCorr.r.toFixed(3)}（{currentCorr.n} 组）
                </Tag>
              )}
              <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
                仅统计参数能解析出数值的组；PID 取第一个数
              </span>
            </Space>
          }
          extra={
            <Space size={8}>
              <Select
                size="small"
                style={{ width: 140 }}
                value={paramKey}
                onChange={setParamKey}
                options={PARAM_DEFS.map((p) => ({ value: p.key, label: p.label }))}
              />
              <Select
                size="small"
                style={{ width: 150 }}
                value={metricKey}
                onChange={(v) => setMetricKey(v as keyof GroupSummaryRow)}
                options={METRIC_DEFS.map((m) => ({ value: m.key, label: m.label }))}
              />
            </Space>
          }
          styles={{ body: { padding: 4 } }}
        >
          <ReactECharts option={scatterOption} style={{ height: 300 }} notMerge />
        </Card>
      </Space>
    </Card>
  );
}
