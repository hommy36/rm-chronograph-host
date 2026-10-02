import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import { Card, Empty } from "antd";
import { useAppStore } from "../store";
import {
  computeStats,
  deviations,
  histogram,
  movingAverageBand,
} from "../stats";

const MA_WINDOW = 5;

const baseGrid = { left: 56, right: 20, top: 46, bottom: 50 };
const titleStyle = { fontSize: 13 } as const;
const axisLabel = { fontSize: 10 } as const;

const xAxis = (data: string[], name: string) =>
  ({
    type: "category",
    data,
    name,
    nameLocation: "middle",
    nameGap: 30,
    nameTextStyle: { fontSize: 11, color: "#888" },
    axisLabel,
  }) as const;

/** 关闭标注组件动画：避免每来一帧 markPoint/markLine 重放"浮现"动画 */
const noAnimMarkLine = { animation: false, silent: true, symbol: "none" } as const;
const noAnimMarkPoint = { animation: false, silent: true } as const;

/** 图 37 四子图：时间序列 / 分布直方图 / 变化趋势 / 移动平均（±1σ 带） */
export default function ChartsGrid() {
  const groups = useAppStore((s) => s.groups);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const group = groups.find((g) => g.id === viewingGroupId) ?? null;

  const speeds = useMemo(
    () => (group ? group.shots.map((s) => s.speed_mps) : []),
    [group]
  );
  const idxs = useMemo(
    () => (group ? group.shots.map((s) => String(s.idx)) : []),
    [group]
  );
  const stats = useMemo(() => computeStats(speeds), [speeds]);

  const timeSeriesOption = useMemo<EChartsOption>(() => {
    const series: SeriesOption[] = [
      {
        name: "数据",
        type: "line",
        data: speeds,
        symbolSize: 6,
        lineStyle: { width: 1.5 },
        markLine: stats
          ? {
              ...noAnimMarkLine,
              lineStyle: { type: "dashed", color: "#faad14" },
              label: {
                formatter: `均值 ${stats.mean.toFixed(4)}`,
                fontSize: 10,
                position: "insideEndTop",
              },
              data: [{ yAxis: stats.mean }],
            }
          : undefined,
        markPoint: stats
          ? {
              ...noAnimMarkPoint,
              symbol: "pin",
              symbolSize: 40,
              label: { fontSize: 10 },
              data: [
                { type: "max", name: "最大值" },
                { type: "min", name: "最小值" },
              ],
            }
          : undefined,
      },
    ];
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      title: { text: "时间序列图", top: 2, textStyle: titleStyle },
      grid: baseGrid,
      tooltip: { trigger: "axis", valueFormatter: (v) => Number(v).toFixed(3) },
      xAxis: xAxis(idxs, "数据点序号"),
      yAxis: { type: "value", name: "弹速 (m/s)", scale: true, axisLabel },
      series,
    };
  }, [idxs, speeds, stats]);

  const histogramOption = useMemo<EChartsOption>(() => {
    const { centers, counts } = histogram(speeds, 10);
    const labels = centers.map((c) => c.toFixed(2));
    // 均值落到最近的箱，画参考竖线
    let meanIdx = -1;
    if (stats && centers.length > 0) {
      let best = Infinity;
      centers.forEach((c, i) => {
        const d = Math.abs(c - stats.mean);
        if (d < best) {
          best = d;
          meanIdx = i;
        }
      });
    }
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      title: { text: "数据分布直方图", top: 2, textStyle: titleStyle },
      grid: baseGrid,
      tooltip: { trigger: "axis" },
      xAxis: xAxis(labels, "弹速 (m/s)"),
      yAxis: { type: "value", name: "频数", minInterval: 1, axisLabel },
      series: [
        {
          type: "bar",
          data: counts,
          itemStyle: { color: "#7cb5ec", opacity: 0.85 },
          barCategoryGap: "15%",
          markLine:
            meanIdx >= 0
              ? {
                  ...noAnimMarkLine,
                  lineStyle: { type: "dashed", color: "#f5222d" },
                  label: {
                    formatter: `均值 ${stats!.mean.toFixed(4)}`,
                    fontSize: 10,
                    position: "end",
                  },
                  data: [{ xAxis: meanIdx }],
                }
              : undefined,
        },
      ],
    };
  }, [speeds, stats, idxs]);

  const deviationOption = useMemo<EChartsOption>(() => {
    const devs = stats ? deviations(speeds, stats.mean) : [];
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      title: { text: "数据变化趋势图", top: 2, textStyle: titleStyle },
      grid: baseGrid,
      tooltip: { trigger: "axis", valueFormatter: (v) => Number(v).toFixed(4) },
      xAxis: xAxis(idxs, "数据点序号"),
      yAxis: { type: "value", name: "变化量", axisLabel },
      series: [
        {
          name: "数据变化",
          type: "line",
          data: devs,
          symbol: "none",
          lineStyle: { width: 0.5, color: "#52c41a" },
          areaStyle: { color: "rgba(82,196,26,0.45)" },
          markLine: {
            ...noAnimMarkLine,
            lineStyle: { color: "#999", width: 1 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }, [idxs, speeds, stats]);

  const movingAvgOption = useMemo<EChartsOption>(() => {
    const { ma, upper, lower } = movingAverageBand(speeds, MA_WINDOW);
    const bandWidth = upper.map((u, i) =>
      u !== null && lower[i] !== null ? u - (lower[i] as number) : null
    );
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      title: {
        text: "移动平均图",
        subtext: `总方差: ${stats ? stats.variance.toFixed(6) : "--"}`,
        left: 8,
        top: 2,
        textStyle: titleStyle,
        subtextStyle: { fontSize: 11, color: "#999" },
      },
      grid: { ...baseGrid, top: 58 },
      tooltip: { trigger: "axis", valueFormatter: (v) => Number(v).toFixed(3) },
      legend: {
        top: 6,
        right: 8,
        itemWidth: 16,
        itemHeight: 8,
        textStyle: { fontSize: 11 },
        data: [
          { name: "原始数据", itemStyle: { color: "rgba(22,119,255,0.5)" } },
          { name: `移动平均(${MA_WINDOW})`, itemStyle: { color: "#f5222d" } },
          {
            name: "±1标准差带",
            icon: "rect",
            itemStyle: {
              color: "rgba(245,34,45,0.18)",
              borderColor: "rgba(245,34,45,0.45)",
              borderWidth: 1,
            },
          },
        ],
      },
      xAxis: xAxis(idxs, "数据点序号"),
      // 本图左上角被标题+副标题（总方差）占用；显式置空 y 轴名，
      // 避免合并模式下沿用旧 name 与副标题文字打架
      yAxis: { type: "value", name: "", scale: true, axisLabel },
      series: [
        {
          name: "原始数据",
          type: "line",
          data: speeds,
          symbol: "none",
          color: "#1677ff",
          lineStyle: { width: 1, opacity: 0.35 },
        },
        {
          // 方差带下沿（透明基线，不进图例、不进 tooltip）
          name: "band-lower",
          type: "line",
          data: lower,
          stack: "sigma-band",
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          name: "±1标准差带",
          type: "line",
          data: bandWidth,
          stack: "sigma-band",
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(245,34,45,0.18)" },
          tooltip: { show: false },
        },
        {
          name: `移动平均(${MA_WINDOW})`,
          type: "line",
          data: ma,
          symbol: "none",
          color: "#f5222d",
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [idxs, speeds, stats]);

  if (!group || speeds.length === 0) {
    return (
      <Card style={{ height: "100%", minWidth: 0 }} data-tour="charts-grid">
        <Empty
          description="暂无数据：连接设备或打开「模拟数据」，收到测速帧后自动绘图"
          style={{ marginTop: 80 }}
        />
      </Card>
    );
  }

  const chartCardStyle = {
    height: "100%",
    // ECharts 会给内部容器写死像素宽度，grid/flex 项的 min-width 默认是 auto，
    // 不置 0 的话窗口缩小后卡片无法收缩，会把整块内容撑宽、元素跟着错位
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  } as const;
  const chartStyle = { height: "100%", width: "100%" } as const;

  const renderChart = (option: EChartsOption, key: string) => (
    <Card
      key={key}
      size="small"
      style={chartCardStyle}
      styles={{ body: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" } }}
    >
      <ReactECharts option={option} style={chartStyle} />
    </Card>
  );

  return (
    <div
      data-tour="charts-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 12,
        height: "100%",
      }}
    >
      {renderChart(timeSeriesOption, "ts")}
      {renderChart(histogramOption, "hist")}
      {renderChart(deviationOption, "dev")}
      {renderChart(movingAvgOption, "ma")}
    </div>
  );
}
