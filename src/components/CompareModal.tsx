import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import {
  Button,
  Card,
  Empty,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import type { TableColumnsType } from "antd";
import {
  DownloadOutlined,
  FundOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store";
import type { Group } from "../types";
import {
  buildCompareCsv,
  compareColor,
  compareStatsRows,
  compareWheelRows,
  equalScaleRanges,
  groupDispersion,
  groupedHistogram,
  overallTests,
  pairwiseMeanP,
  recenterToMean,
  statsRowsOf,
} from "../compare";
import type { StatsRow } from "../compare";
import { saveCsv } from "../csv";
import { meanPoint } from "../dispersion/math";

interface StatRowView extends StatsRow {
  diff?: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  p?: number | null;
}

interface DispRowView {
  label: string;
  digits: number;
  suffix: string;
  values: (number | null)[];
}

function fmtCell(v: number | null | undefined, digits: number, suffix = "") {
  if (v === null || v === undefined || !isFinite(v)) return "-";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtP(v: number | null | undefined) {
  if (v === null || v === undefined || !isFinite(v)) return "-";
  return v < 0.001 ? "<0.001" : v.toFixed(3);
}

/** p 值单元格：显著时标红加粗 */
function pCell(v: number | null | undefined) {
  return (
    <span
      style={{
        fontWeight: (v ?? 1) < 0.05 ? 700 : 400,
        color: (v ?? 1) < 0.05 ? "#fa541c" : "#888",
      }}
    >
      {fmtP(v)}
    </span>
  );
}

export default function CompareModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const groups = useAppStore((s) => s.groups);
  const compareIds = useAppStore((s) => s.compareIds);
  const globalWaveConfig = useAppStore((s) => s.waveConfig);
  const clearCompare = useAppStore((s) => s.clearCompare);

  /** 勾选顺序即列顺序；组被删掉时自动跳过 */
  const picked = useMemo(
    () =>
      compareIds
        .map((id) => groups.find((g) => g.id === id))
        .filter((g): g is Group => !!g),
    [compareIds, groups]
  );
  const names = picked.map((g) => g.name);
  const multi = picked.length >= 3;
  const tooManyColors = picked.length > 10;

  const statRows = useMemo<StatRowView[]>(() => {
    const base = statsRowsOf(picked);
    if (picked.length !== 2) return base;
    const t = compareStatsRows(picked[0], picked[1]);
    return base.map((r) => {
      const m = t.find((x) => x.label === r.label);
      return {
        ...r,
        diff: m?.diff ?? null,
        ciLow: m?.ciLow ?? null,
        ciHigh: m?.ciHigh ?? null,
        p: m?.p ?? null,
      };
    });
  }, [picked]);

  const wheels = useMemo(
    () =>
      compareWheelRows(
        picked,
        picked.map((g) => g.waveConfig ?? globalWaveConfig)
      ),
    [picked, globalWaveConfig]
  );
  const overall = useMemo(() => overallTests(picked), [picked]);
  const pairwise = useMemo(() => pairwiseMeanP(picked), [picked]);
  const sides = useMemo(() => picked.map(groupDispersion), [picked]);

  const [alignCenters, setAlignCenters] = useState(true);

  /** 散布对比图的绘图区尺寸：用它把 x/y 轴 mm 比例尺对齐（不然形状会被拉扁） */
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [chartBox, setChartBox] = useState({ w: 760, h: 340 });
  useEffect(() => {
    if (!props.open) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const update = () =>
      setChartBox({ w: el.clientWidth || 760, h: el.clientHeight || 340 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.open]);

  const dispersionOption = useMemo<EChartsOption>(() => {
    if (!sides.some((s) => s.hasData)) return {};
    // 重合弹着中心：各组平移到点群重心为原点，直接比散布形状
    const plots = sides.map((s) =>
      alignCenters ? recenterToMean(s.pointsMm) : s.pointsMm
    );
    const all = plots.flat();
    const maxAbs = Math.max(
      30,
      ...all.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))
    );
    // 两轴 mm/像素 必须一致，否则散布形状会失真
    const PAD_L = 58;
    const PAD_R = 26;
    const PAD_T = 44;
    const PAD_B = 44;
    const plotW = Math.max(120, chartBox.w - PAD_L - PAD_R);
    const plotH = Math.max(120, chartBox.h - PAD_T - PAD_B);
    const { limX, limY, splitX, splitY } = equalScaleRanges(maxAbs, plotW, plotH);
    const seriesOf = (
      name: string,
      pts: { x: number; y: number }[],
      color: string
    ) => {
      if (pts.length === 0) return [];
      const center = meanPoint(pts);
      const series: SeriesOption[] = [
        {
          name,
          type: "scatter",
          data: pts.map((p) => [p.x, p.y]),
          symbolSize: 24,
          itemStyle: { color, opacity: 0.4, borderColor: color, borderWidth: 1 },
          emphasis: { itemStyle: { opacity: 0.75 } },
        },
      ];
      if (center) {
        series.push({
          name: `${name} 弹着中心`,
          type: "scatter",
          data: [[center.x, center.y]],
          symbol: "diamond",
          symbolSize: 16,
          itemStyle: { color, borderColor: "#fff", borderWidth: 1.5 },
          z: 5,
        });
      }
      return series;
    };
    return {
      animation: true,
      animationDuration: 300,
      grid: { left: PAD_L, right: PAD_R, top: PAD_T, bottom: PAD_B },
      legend: { type: "scroll", top: 4, textStyle: { fontSize: 11 } },
      tooltip: {
        formatter: (p: unknown) => {
          const item = p as { seriesName: string; value: [number, number] };
          return `${item.seriesName}<br/>x ${item.value[0].toFixed(1)} mm · y ${item.value[1].toFixed(1)} mm`;
        },
      },
      xAxis: {
        type: "value",
        name: "mm（右为正）",
        min: -limX,
        max: limX,
        splitNumber: splitX,
        splitLine: { lineStyle: { type: "dashed" } },
      },
      yAxis: {
        type: "value",
        name: "mm（上为正）",
        min: -limY,
        max: limY,
        inverse: true,
        splitNumber: splitY,
        splitLine: { lineStyle: { type: "dashed" } },
      },
      series: plots.flatMap((pts, i) => seriesOf(names[i], pts, compareColor(i))),
    };
  }, [names, sides, alignCenters, chartBox]);

  const dispersionRows = useMemo<DispRowView[]>(() => {
    const pct = (v: number | null) => (v === null ? null : v * 100);
    const pick = (
      label: string,
      digits: number,
      suffix: string,
      get: (s: (typeof sides)[number]) => number | null
    ): DispRowView => ({
      label,
      digits,
      suffix,
      values: sides.map(get),
    });
    return [
      pick("标点数", 0, "", (s) => (s.hasData ? s.n : null)),
      pick("平均环数", 3, "", (s) => s.meanRing),
      pick("平均散布距离", 2, " mm", (s) => s.avgDist),
      pick("最小包围圆半径", 2, " mm", (s) => s.mecRadius),
      pick("小装甲命中率", 1, "%", (s) => pct(s.hitSmall)),
      pick("大装甲命中率", 1, "%", (s) => pct(s.hitLarge)),
      pick("飞镖命中率", 1, "%", (s) => pct(s.hitDart)),
    ];
  }, [sides]);

  const speedOption = useMemo<EChartsOption>(() => {
    if (picked.length === 0) return {};
    const maxN = picked.reduce((m, g) => Math.max(m, g.shots.length), 0);
    const idx = Array.from({ length: maxN }, (_, i) => String(i + 1));
    const meanOf = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((x, y) => x + y, 0) / arr.length : 0;
    const seriesOf = (
      name: string,
      data: number[],
      color: string,
      mean: number
    ) =>
      ({
        name,
        type: "line",
        data,
        showSymbol: true,
        symbolSize: 5,
        lineStyle: { width: 1.4, color },
        itemStyle: { color },
        markLine: {
          animation: false,
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color },
          label: { formatter: `均值 ${mean.toFixed(3)}`, fontSize: 10 },
          data: [{ yAxis: mean }],
        },
      }) as SeriesOption;
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      grid: { left: 60, right: 24, top: 44, bottom: 46 },
      legend: { type: "scroll", top: 4, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: idx, name: "发序号" },
      yAxis: {
        type: "value",
        scale: true,
        name: "m/s",
        // 竖排贴轴放，避免与顶部图例抢位置
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 46,
      },
      series: picked.map((g, i) => {
        const data = g.shots.map((s) => s.speed_mps);
        return seriesOf(g.name, data, compareColor(i), meanOf(data));
      }),
    };
  }, [picked]);

  const histOption = useMemo<EChartsOption>(() => {
    if (picked.length === 0) return {};
    const h = groupedHistogram(
      picked.map((g) => g.shots.map((s) => s.speed_mps))
    );
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      grid: { left: 56, right: 24, top: 44, bottom: 46 },
      legend: { type: "scroll", top: 4, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: h.centers.map((c) => c.toFixed(3)),
        name: "m/s",
      },
      yAxis: {
        type: "value",
        name: "频数",
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 46,
      },
      series: h.counts.map((counts, i) => ({
        name: names[i],
        type: "bar",
        data: counts,
        itemStyle: { color: compareColor(i), opacity: 0.65 },
      })),
    };
  }, [picked, names]);

  /** 各组均值区间（浮动/回归，非全距） */
  const meanSpan = useMemo(() => {
    const means = picked
      .map((g) =>
        g.shots.length > 0
          ? g.shots.reduce((x, s) => x + s.speed_mps, 0) / g.shots.length
          : null
      )
      .filter((v): v is number => v !== null);
    if (means.length < 2) return null;
    const lo = Math.min(...means);
    const hi = Math.max(...means);
    return { lo, hi, span: hi - lo };
  }, [picked]);

  const handleExport = async () => {
    if (picked.length < 2) return;
    try {
      const ok = await saveCsv(
        `对比_${names.join("_vs_")}.csv`,
        buildCompareCsv(
          picked,
          picked.map((g) => g.waveConfig ?? globalWaveConfig)
        )
      );
      if (ok) message.success("对比结果已导出");
    } catch (e) {
      message.error(`导出失败：${e}`);
    }
  };

  const hasWave = wheels.some((w) => w.drops.some((v) => v !== null));
  const headerTag = (i: number) => (
    <span style={{ color: compareColor(i) }}>{names[i]}</span>
  );

  const statsColumns: TableColumnsType<StatRowView> = [
    { title: "指标", dataIndex: "label", width: 150, fixed: "left" },
    ...picked.map((_, i) => ({
      title: headerTag(i),
      key: `g${i}`,
      render: (_: unknown, r: StatRowView) => fmtCell(r.values[i], r.digits),
    })),
    ...(picked.length === 2
      ? ([
          {
            title: "差值 (B-A)",
            key: "diff",
            render: (_: unknown, r: StatRowView) =>
              r.diff === null || r.diff === undefined || !isFinite(r.diff) ? (
                "-"
              ) : (
                <span
                  style={{
                    color:
                      Math.abs(r.diff) < 1e-12
                        ? "#888"
                        : r.diff > 0
                          ? "#fa541c"
                          : "#1677ff",
                  }}
                >
                  {r.diff > 0 ? "+" : ""}
                  {r.diff.toFixed(r.digits)}
                </span>
              ),
          },
          {
            title: "95% 置信区间",
            key: "ci",
            width: 190,
            render: (_: unknown, r: StatRowView) =>
              r.ciLow === null || r.ciLow === undefined ? (
                "-"
              ) : (
                <span style={{ fontSize: 12, color: "#666" }}>
                  {r.ciLow.toFixed(r.digits)} ~ {(r.ciHigh ?? 0).toFixed(r.digits)}
                </span>
              ),
          },
          {
            title: "p 值",
            key: "p",
            width: 90,
            render: (_: unknown, r: StatRowView) => pCell(r.p),
          },
        ] as TableColumnsType<StatRowView>)
      : []),
  ];

  const dispersionColumns: TableColumnsType<DispRowView> = [
    { title: "指标", dataIndex: "label", width: 130, fixed: "left" },
    ...picked.map((_, i) => ({
      title: headerTag(i),
      key: `d${i}`,
      render: (_: unknown, r: DispRowView) =>
        fmtCell(r.values[i], r.digits, r.suffix),
    })),
    ...(picked.length === 2
      ? ([
          {
            title: "差值 (B-A)",
            key: "diff",
            render: (_: unknown, r: DispRowView) => {
              const [x, y] = r.values;
              if (x === null || y === null || x === undefined || y === undefined)
                return "-";
              const d = y - x;
              return (
                <span
                  style={{
                    color:
                      Math.abs(d) < 1e-9 ? "#888" : d > 0 ? "#fa541c" : "#1677ff",
                  }}
                >
                  {d > 0 ? "+" : ""}
                  {d.toFixed(r.digits)}
                  {r.suffix}
                </span>
              );
            },
          },
        ] as TableColumnsType<DispRowView>)
      : []),
  ];

  const wheelColumns: TableColumnsType<(typeof wheels)[number]> = [
    { title: "轮组", dataIndex: "name", width: 110, fixed: "left" },
    ...picked.map((_, i) => ({
      title: headerTag(i),
      key: `w${i}`,
      render: (_: unknown, r: (typeof wheels)[number]) => (
        <span>
          {r.drops[i] === null ? "-" : `${r.drops[i]!.toFixed(2)}%`}
          <span style={{ color: "#bbb", fontSize: 11 }}>
            {" "}
            / {r.spreads[i] === null ? "-" : r.spreads[i]!.toFixed(0)}
          </span>
        </span>
      ),
    })),
  ];

  const pairRows = names.map((n, i) => ({ key: i, name: n, cells: pairwise[i] }));
  const pairColumns: TableColumnsType<(typeof pairRows)[number]> = [
    {
      title: "组 \\ 组",
      dataIndex: "name",
      width: 240,
      fixed: "left",
      ellipsis: true,
    },
    ...picked.map((_, j) => ({
      title: headerTag(j),
      key: `p${j}`,
      render: (_: unknown, r: (typeof pairRows)[number]) =>
        j <= r.key ? <span style={{ color: "#ddd" }}>—</span> : pCell(r.cells[j]),
    })),
  ];

  return (
    <Modal
      title={
        <Space size={6} wrap>
          <FundOutlined />
          {multi ? `${picked.length} 组对比` : "两组对比"}
          <span style={{ fontWeight: 400, fontSize: 13 }}>
            {picked.map((g, i) => (
              <Tag key={g.id} color={compareColor(i)}>
                {g.name}
              </Tag>
            ))}
          </span>
          {tooManyColors && (
            <span style={{ fontSize: 12, color: "#faad14", fontWeight: 400 }}>
              组数超过 10，配色循环使用
            </span>
          )}
        </Space>
      }
      open={props.open}
      onCancel={props.onClose}
      width="90%"
      centered
      styles={{
        body: {
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
          paddingRight: 8,
        },
      }}
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Button
            onClick={() => {
              clearCompare();
              props.onClose();
            }}
          >
            清除勾选
          </Button>
          <Space>
            {meanSpan && (
              <span style={{ color: "#888", fontSize: 12 }}>
                均值区间 {meanSpan.lo.toFixed(4)} ~ {meanSpan.hi.toFixed(4)} m/s（极差{" "}
                {meanSpan.span.toFixed(4)}）
              </span>
            )}
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出对比 CSV
            </Button>
          </Space>
        </Space>
      }
    >
      {picked.length < 2 ? (
        <Empty description="请先在测试记录里勾选至少两组" />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div style={{ display: "flex", gap: 12 }}>
            <Card
              size="small"
              title="弹速序列对比"
              style={{ flex: 1, minWidth: 0 }}
              styles={{ body: { padding: 4 } }}
            >
              <ReactECharts
                option={speedOption}
                style={{ height: 260 }}
                notMerge
              />
            </Card>
            <Card
              size="small"
              title="分布对比"
              style={{ flex: 1, minWidth: 0 }}
              styles={{ body: { padding: 4 } }}
            >
              <ReactECharts
                option={histOption}
                style={{ height: 260 }}
                notMerge
              />
            </Card>
          </div>

          <Card
            size="small"
            title={
              <Space size={8} wrap>
                <span>统计指标对比</span>
                <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
                  {picked.length === 2
                    ? "均值差用 Welch t 检验；极差/标准差用 bootstrap 重采样"
                    : "列顺序即勾选顺序"}
                </span>
              </Space>
            }
            styles={{ body: { padding: 0 } }}
          >
            <Table
              size="small"
              rowKey="label"
              pagination={false}
              scroll={{ x: "max-content" }}
              dataSource={statRows}
              columns={statsColumns}
            />
          </Card>

          {multi && (
            <Card
              size="small"
              title={
                <Space size={6} wrap>
                  <span>组间差异检验</span>
                  <Tooltip
                    title={
                      <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                        先把这几组放一起，看「整体上有没有差别」：
                        <br />
                        均值用 Welch 单因素方差分析（F 检验，不要求各组方差相等）；
                        <br />
                        极差与标准差这类分布未知的指标用置换检验（把标签打乱 1000 次，
                        看真实分组有多极端）。
                        <br />
                        p &lt; 0.05 表示这几组整体上有差异；具体差在哪两组，看下面的两两比较。
                      </div>
                    }
                  >
                    <QuestionCircleOutlined style={{ color: "#999" }} />
                  </Tooltip>
                </Space>
              }
              styles={{ body: { padding: 0 } }}
            >
              <Table
                size="small"
                rowKey="label"
                pagination={false}
                dataSource={overall}
                columns={[
                  { title: "指标", dataIndex: "label", width: 90 },
                  { title: "检验方法", dataIndex: "method", width: 240 },
                  {
                    title: (
                      <Tooltip title="均值一行是 F 值（括号内为两个自由度）；极差/标准差一行是置换检验的组间方差">
                        <span>
                          检验统计量{" "}
                          <QuestionCircleOutlined style={{ color: "#bbb" }} />
                        </span>
                      </Tooltip>
                    ),
                    dataIndex: "stat",
                    width: 140,
                    render: (v: number | null) => (v === null ? "-" : v.toFixed(4)),
                  },
                  {
                    title: "p 值",
                    dataIndex: "p",
                    width: 100,
                    render: (v: number | null) => pCell(v),
                  },
                ]}
              />
              <div
                style={{
                  padding: "10px 12px 0",
                  fontSize: 12,
                  color: "#666",
                }}
              >
                均值两两比较（Welch t 检验，格内为 p 值）
                <Tooltip
                  title={
                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                      每一对组单独做一次 t 检验，格子里就是这一对的 p 值：
                      <br />
                      p &lt; 0.05 说明这两组均值差异显著（红色加粗）。
                      <br />
                      组多时两两比较的次数会变多，偶尔出现的 p &lt; 0.05 可能只是巧合，
                      这里没有做多重比较校正，判断时请结合 p 值大小与样本量。
                    </div>
                  }
                >
                  <QuestionCircleOutlined style={{ marginLeft: 4, color: "#999" }} />
                </Tooltip>
                <span style={{ color: "#bbb", marginLeft: 8 }}>
                  只填右上三角（A 对 B 与 B 对 A 相同）
                </span>
              </div>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: "max-content" }}
                dataSource={pairRows}
                columns={pairColumns}
                style={{ marginTop: 4 }}
              />
            </Card>
          )}

          {hasWave && (
            <Card
              size="small"
              title={
                <Space size={8} wrap>
                  <span>摩擦轮指标对比（各组有波形数据的发平均）</span>
                  <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
                    平均掉速% / 平均轮间差
                  </span>
                </Space>
              }
              styles={{ body: { padding: 0 } }}
            >
              <Table
                size="small"
                rowKey="name"
                pagination={false}
                scroll={{ x: "max-content" }}
                dataSource={wheels}
                columns={wheelColumns}
              />
            </Card>
          )}

          {sides.some((s) => s.hasData) && (
            <Card
              size="small"
              title={
                <Space size={8} wrap>
                  <span>散布对比（靶纸落点，圆点为一发弹孔）</span>
                  <span style={{ color: "#888", fontWeight: 400, fontSize: 12 }}>
                    {alignCenters
                      ? "坐标：以各自弹着中心为原点（已重合）"
                      : "坐标：以各自纸面中心为原点"}
                  </span>
                </Space>
              }
              extra={
                <Tooltip title="把各组落点平移到各自弹着中心重合，直接比散布形状；关掉则按靶纸上的真实位置对比（可看出归零差异）">
                  <Space size={4}>
                    <Switch
                      size="small"
                      checked={alignCenters}
                      onChange={setAlignCenters}
                    />
                    <span style={{ fontSize: 12 }}>重合弹着中心</span>
                  </Space>
                </Tooltip>
              }
              styles={{ body: { padding: 4 } }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  // 多组时表格列多，放到图下方通栏展示（免得横向滚动看数据），
                  // 图则保持近方形宽度，否则等比例尺下 x 轴会被拉宽、落点缩成一小团
                  alignItems: multi ? "center" : "stretch",
                  flexDirection: multi ? "column" : "row",
                }}
              >
                <div
                  style={{
                    flex: multi ? undefined : 1,
                    width: multi ? 820 : undefined,
                    maxWidth: "100%",
                    minWidth: 0,
                  }}
                  ref={chartWrapRef}
                >
                  <ReactECharts
                    option={dispersionOption}
                    style={{ height: 340 }}
                    notMerge
                  />
                </div>
                <div
                  style={{
                    flexShrink: 0,
                    width: multi ? "100%" : 420,
                    minWidth: 0,
                    alignSelf: "stretch",
                  }}
                >
                  <Table
                    size="small"
                    rowKey="label"
                    pagination={false}
                    scroll={{ x: "max-content" }}
                    dataSource={dispersionRows}
                    columns={dispersionColumns}
                  />
                </div>
              </div>
            </Card>
          )}
        </Space>
      )}
    </Modal>
  );
}
