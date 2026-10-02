import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import { Card, Space } from "antd";
import { useAppStore } from "../store";
import { GROUP_COLORS } from "./WaveSettingsModal";
import { crossGroupSeries, crossGroupStats } from "../analysis";

/** 跨组时间轴：把一天测的多组按测试顺序拼成一条序列 */
export default function CrossGroupCard() {
  const allGroups = useAppStore((s) => s.groups);
  const activeTestId = useAppStore((s) => s.activeTestId);
  // 跨组时间轴只拼当前测试的组（热枪/漂移按天看才准）
  const groups = useMemo(
    () => allGroups.filter((g) => g.testId === activeTestId),
    [allGroups, activeTestId]
  );

  const stats = useMemo(() => crossGroupStats(groups, 3), [groups]);
  const series = useMemo(() => crossGroupSeries(groups), [groups]);

  const timelineOption = useMemo<EChartsOption>(() => {
    const cat = series.map((p) => (p.shotIdx === 1 ? `${p.groupName}` : ""));
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
        markLine: {
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
        },
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

  if (stats.length === 0) return null;

  return (
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
      <ReactECharts option={timelineOption} style={{ height: 340 }} notMerge />
    </Card>
  );
}
