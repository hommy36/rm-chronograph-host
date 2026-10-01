import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import { Card, Space, Table, Tag, Tooltip } from "antd";
import { useAppStore } from "../store";
import { GROUP_COLORS } from "./WaveSettingsModal";
import {
  alignedProfile,
  crossGroupSeries,
  crossGroupStats,
  driftTrend,
  oneSampleT,
  type CrossGroupStats,
} from "../analysis";

const f = (v: number | null | undefined, d = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d);

/**
 * 多组（当日）汇总：把一天测的多组按时间顺序拼起来，
 * 用"组内冷枪段 vs 热枪段"和"组间均值台阶"估计热枪效应与漂移。
 */
export default function CrossGroupCard() {
  const groups = useAppStore((s) => s.groups);

  const stats = useMemo(() => crossGroupStats(groups, 3), [groups]);
  const series = useMemo(() => crossGroupSeries(groups), [groups]);
  const profile = useMemo(() => alignedProfile(groups, 10), [groups]);

  const coldTest = useMemo(
    () => oneSampleT(stats.filter((s) => s.n > 3).map((s) => s.coldDelta)),
    [stats]
  );
  const hotTest = useMemo(
    () =>
      oneSampleT(
        stats.map((s) => s.hotDelta).filter((v): v is number => v !== null)
      ),
    [stats]
  );
  const drift = useMemo(() => driftTrend(stats), [stats]);

  /** 跨组时间轴：全部发按组顺序拼接 */
  const timelineOption = useMemo<EChartsOption>(() => {
    const cat = series.map((p) =>
      p.shotIdx === 1 ? `${p.groupName}` : ""
    );
    const perGroup: SeriesOption[] = stats.map((g, gi) => {
      const pts = series
        .map((p, i) => ({ p, i }))
        .filter((x) => x.p.groupIndex === gi)
        .map((x) => ({ value: [x.i, x.p.speed] }));
      return {
        name: g.name,
        type: "line",
        data: pts,
        showSymbol: true,
        symbolSize: 5,
        lineStyle: { width: 1.2, color: GROUP_COLORS[gi % GROUP_COLORS.length] },
        itemStyle: { color: GROUP_COLORS[gi % GROUP_COLORS.length] },
        markLine:
          gi < 6
            ? {
                animation: false,
                silent: true,
                symbol: "none",
                lineStyle: {
                  type: "dashed",
                  color: GROUP_COLORS[gi % GROUP_COLORS.length],
                  opacity: 0.6,
                },
                label: {
                  formatter: `${g.name} 均值 ${g.mean.toFixed(3)}`,
                  fontSize: 10,
                  // 各组均值接近时标签会叠在一起，按奇偶上下错开
                  position: gi % 2 === 0 ? "insideEndTop" : "insideEndBottom",
                },
                data: [{ yAxis: g.mean }],
              }
            : undefined,
      } as SeriesOption;
    });
    return {
      animation: false,
      grid: { left: 66, right: 24, top: 38, bottom: 54 },
      legend: { type: "scroll", top: 2, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: cat,
        name: "按测试顺序（跨组合并）",
        nameLocation: "middle",
        nameGap: 30,
        axisLabel: {
          fontSize: 9,
          interval: (idx: number) => cat[idx] !== "",
        },
      },
      yAxis: { type: "value", scale: true, name: "m/s" },
      series: perGroup,
    };
  }, [series, stats]);

  /** 按组内发序号对齐的平均偏离曲线（看头几发系统性偏差） */
  const profileOption = useMemo<EChartsOption>(() => {
    const xs = profile.map((p) => p.shotIdx);
    const meanLine = profile.map((p) => [p.shotIdx, p.meanDev]);
    const upper = profile.map((p) => [p.shotIdx, p.meanDev + p.sd]);
    const lower = profile.map((p) => [p.shotIdx, p.meanDev - p.sd]);
    // 每组一个点，展示各组的分散
    const scatter: [number, number][] = [];
    for (const g of groups) {
      const v = g.shots.map((s) => s.speed_mps);
      if (v.length === 0) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      v.slice(0, 10).forEach((x, i) => scatter.push([i + 1, x - m]));
    }
    return {
      animation: false,
      grid: { left: 66, right: 24, top: 34, bottom: 50 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "value",
        name: "组内第几发",
        nameLocation: "middle",
        nameGap: 26,
        min: 1,
        max: xs.length > 0 ? Math.max(...xs) : 10,
      },
      yAxis: { type: "value", name: "相对本组均值 (m/s)", scale: true },
      series: [
        {
          name: "各组",
          type: "scatter",
          data: scatter,
          symbolSize: 8,
          itemStyle: { color: "#888", opacity: 0.35 },
        },
        {
          name: "平均",
          type: "line",
          data: meanLine,
          showSymbol: true,
          symbolSize: 7,
          lineStyle: { width: 2.2, color: "#fa541c" },
          itemStyle: { color: "#fa541c" },
        },
        {
          name: "+1σ",
          type: "line",
          data: upper,
          showSymbol: false,
          lineStyle: { type: "dashed" as const, color: "#fa541c", opacity: 0.5, width: 1 },
        },
        {
          name: "-1σ",
          type: "line",
          data: lower,
          showSymbol: false,
          lineStyle: { type: "dashed" as const, color: "#fa541c", opacity: 0.5, width: 1 },
        },
      ] as SeriesOption[],
    };
  }, [profile, groups]);

  if (stats.length === 0) return null;

  const testTag = (t: ReturnType<typeof oneSampleT>, unit = " m/s") =>
    t === null ? (
      <span style={{ color: "#999" }}>样本不足</span>
    ) : (
      <span>
        {t.mean >= 0 ? "+" : ""}
        {t.mean.toFixed(4)} m/s（95% CI {t.ciLow.toFixed(4)} ~ {t.ciHigh.toFixed(4)}，
        p={t.p < 0.001 ? "<0.001" : t.p.toFixed(3)}，n={t.n}）
        {t.p < 0.05 ? (
          <Tag color="red" style={{ marginLeft: 6 }}>
            系统性偏差显著
          </Tag>
        ) : (
          <Tag style={{ marginLeft: 6 }}>不显著</Tag>
        )}
        {unit ? "" : ""}
      </span>
    );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Card
        size="small"
        title={
          <Space size={8}>
            <span>跨组时间轴</span>
            <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
              按测试顺序把 {stats.length} 组 {series.length} 发拼成一条序列，虚线为各组均值
            </span>
          </Space>
        }
        styles={{ body: { padding: 4 } }}
      >
        <ReactECharts option={timelineOption} style={{ height: 300 }} notMerge />
      </Card>

      <Card
        size="small"
        title={
          <Space size={12} wrap>
            <span>热枪效应（跨组）</span>
            <Tooltip title="冷枪效应 = 每组前 3 发均值 − 该组其余发均值；组内热枪 = 后 3 发 − 前 3 发">
              <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
                <b>冷枪效应</b>：{testTag(coldTest)}
              </span>
            </Tooltip>
          </Space>
        }
        extra={
          <Space size={12} wrap>
            <span style={{ fontSize: 12, color: "#666" }}>
              <b>组内热枪</b>：{testTag(hotTest)}
            </span>
            {drift && (
              <span style={{ fontSize: 12, color: "#666" }}>
                <b>组间漂移</b>：{drift.slope >= 0 ? "+" : ""}
                {drift.slope.toFixed(4)} m/s 每组（r={drift.r.toFixed(2)}）
              </span>
            )}
          </Space>
        }
        styles={{ body: { padding: 4 } }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <ReactECharts option={profileOption} style={{ height: 260 }} notMerge />
          </div>
          <div style={{ flex: 1, minWidth: 380 }}>
            <Table<CrossGroupStats>
              size="small"
              rowKey="id"
              dataSource={stats}
              pagination={false}
              columns={[
                { title: "组名", dataIndex: "name", width: 86 },
                { title: "发数", dataIndex: "n", width: 56 },
                {
                  title: "均值",
                  dataIndex: "mean",
                  width: 86,
                  render: (v: number) => f(v, 4),
                },
                {
                  title: "前3发",
                  dataIndex: "firstK",
                  width: 86,
                  render: (v: number) => f(v, 4),
                },
                {
                  title: "其余发",
                  dataIndex: "restMean",
                  width: 86,
                  render: (v: number) => f(v, 4),
                },
                {
                  title: "冷枪差",
                  dataIndex: "coldDelta",
                  width: 86,
                  render: (v: number) => (
                    <span
                      style={{ color: v > 0 ? "#fa541c" : v < 0 ? "#1677ff" : "#888" }}
                    >
                      {v >= 0 ? "+" : ""}
                      {f(v, 4)}
                    </span>
                  ),
                },
                {
                  title: "组内热枪",
                  dataIndex: "hotDelta",
                  width: 90,
                  render: (v: number | null) => f(v, 4),
                },
              ]}
            />
          </div>
        </div>
      </Card>
    </Space>
  );
}
