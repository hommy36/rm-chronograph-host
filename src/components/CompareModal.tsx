import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import { Button, Card, Empty, Modal, Space, Table, Tag, message } from "antd";
import { DownloadOutlined, FundOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import {
  buildCompareCsv,
  compareStatsRows,
  compareWheelRows,
  pairedHistogram,
} from "../compare";
import { saveCsv } from "../csv";

/** 两组配色（与轮组色区分开，用红/蓝对比） */
const COLOR_A = "#1677ff";
const COLOR_B = "#fa541c";

export default function CompareModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const groups = useAppStore((s) => s.groups);
  const compareIds = useAppStore((s) => s.compareIds);
  const waveConfig = useAppStore((s) => s.waveConfig);
  const clearCompare = useAppStore((s) => s.clearCompare);

  const a = groups.find((g) => g.id === compareIds[0]) ?? null;
  const b = groups.find((g) => g.id === compareIds[1]) ?? null;

  const statsRows = useMemo(
    () => (a && b ? compareStatsRows(a, b) : []),
    [a, b]
  );
  const wheelRows = useMemo(
    () => (a && b ? compareWheelRows(a, b, waveConfig) : []),
    [a, b, waveConfig]
  );

  const speedOption = useMemo<EChartsOption>(() => {
    if (!a || !b) return {};
    const maxN = Math.max(a.shots.length, b.shots.length);
    const idx = Array.from({ length: maxN }, (_, i) => String(i + 1));
    const pick = (g: typeof a) => g!.shots.map((s) => s.speed_mps);
    const seriesOf = (name: string, data: number[], color: string, mean: number) =>
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
    const meanOf = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((x, y) => x + y, 0) / arr.length : 0;
    const da = pick(a);
    const db = pick(b);
    return {
      animation: false,
      grid: { left: 60, right: 24, top: 44, bottom: 46 },
      legend: { top: 4, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: idx, name: "发序号" },
      yAxis: { type: "value", scale: true, name: "m/s" },
      series: [
        seriesOf(a.name, da, COLOR_A, meanOf(da)),
        seriesOf(b.name, db, COLOR_B, meanOf(db)),
      ],
    };
  }, [a, b]);

  const histOption = useMemo<EChartsOption>(() => {
    if (!a || !b) return {};
    const h = pairedHistogram(
      a.shots.map((s) => s.speed_mps),
      b.shots.map((s) => s.speed_mps)
    );
    return {
      animation: false,
      grid: { left: 56, right: 24, top: 44, bottom: 46 },
      legend: { top: 4, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: h.centers.map((c) => c.toFixed(3)),
        name: "m/s",
      },
      yAxis: { type: "value", name: "频数" },
      series: [
        {
          name: a.name,
          type: "bar",
          data: h.a,
          itemStyle: { color: COLOR_A, opacity: 0.65 },
        },
        {
          name: b.name,
          type: "bar",
          data: h.b,
          itemStyle: { color: COLOR_B, opacity: 0.65 },
        },
      ],
    };
  }, [a, b]);

  const speedSpread = useMemo(() => {
    if (a && b) {
      const ma = a.shots.reduce((x, s) => x + s.speed_mps, 0) / (a.shots.length || 1);
      const mb = b.shots.reduce((x, s) => x + s.speed_mps, 0) / (b.shots.length || 1);
      return mb - ma;
    }
    return 0;
  }, [a, b]);

  const handleExport = async () => {
    if (!a || !b) return;
    try {
      const ok = await saveCsv(
        `对比_${a.name}_vs_${b.name}.csv`,
        buildCompareCsv(a, b, waveConfig)
      );
      if (ok) message.success("对比结果已导出");
    } catch (e) {
      message.error(`导出失败：${e}`);
    }
  };

  const hasWave = wheelRows.some(
    (w) => w.aDrop !== null || w.bDrop !== null
  );

  return (
    <Modal
      title={
        <Space>
          <FundOutlined />
          两组对比
          {a && b && (
            <span style={{ color: "#888", fontWeight: 400, fontSize: 13 }}>
              <Tag color={COLOR_A}>{a.name}</Tag>vs
              <Tag color={COLOR_B}>{b.name}</Tag>
            </span>
          )}
        </Space>
      }
      open={props.open}
      onCancel={props.onClose}
      width="88%"
      style={{ top: 24 }}
      styles={{
        body: { maxHeight: "calc(100vh - 200px)", overflowY: "auto", paddingRight: 8 },
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
            {a && b && (
              <span style={{ color: "#888", fontSize: 12 }}>
                均值差 {speedSpread >= 0 ? "+" : ""}
                {speedSpread.toFixed(4)} m/s（B-A）
              </span>
            )}
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出对比 CSV
            </Button>
          </Space>
        </Space>
      }
    >
      {!a || !b ? (
        <Empty description="请先在测试记录里勾选两组" />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div style={{ display: "flex", gap: 12 }}>
            <Card
              size="small"
              title="弹速序列对比"
              style={{ flex: 1, minWidth: 0 }}
              styles={{ body: { padding: 4 } }}
            >
              <ReactECharts option={speedOption} style={{ height: 260 }} notMerge />
            </Card>
            <Card
              size="small"
              title="分布对比"
              style={{ flex: 1, minWidth: 0 }}
              styles={{ body: { padding: 4 } }}
            >
              <ReactECharts option={histOption} style={{ height: 260 }} notMerge />
            </Card>
          </div>
          <Card size="small" title="统计指标对比" styles={{ body: { padding: 0 } }}>
            <Table
              size="small"
              rowKey="label"
              pagination={false}
              dataSource={statsRows}
              columns={[
                { title: "指标", dataIndex: "label", width: 160 },
                {
                  title: a.name,
                  dataIndex: "a",
                  render: (v: number | null, r) =>
                    v === null || !isFinite(v) ? "-" : v.toFixed(r.digits),
                },
                {
                  title: b.name,
                  dataIndex: "b",
                  render: (v: number | null, r) =>
                    v === null || !isFinite(v) ? "-" : v.toFixed(r.digits),
                },
                {
                  title: "差值 (B-A)",
                  dataIndex: "diff",
                  render: (v: number | null, r) =>
                    v === null || !isFinite(v) ? (
                      "-"
                    ) : (
                      <span
                        style={{
                          color:
                            Math.abs(v) < 1e-12
                              ? "#888"
                              : v > 0
                                ? "#fa541c"
                                : "#1677ff",
                        }}
                      >
                        {v > 0 ? "+" : ""}
                        {v.toFixed(r.digits)}
                      </span>
                    ),
                },
              ]}
            />
          </Card>
          {hasWave && (
            <Card
              size="small"
              title="摩擦轮指标对比（各组有波形数据的发平均）"
              styles={{ body: { padding: 0 } }}
            >
              <Table
                size="small"
                rowKey="name"
                pagination={false}
                dataSource={wheelRows}
                columns={[
                  { title: "轮组", dataIndex: "name", width: 120 },
                  {
                    title: `平均掉速% · ${a.name}`,
                    dataIndex: "aDrop",
                    render: (v: number | null) => (v === null ? "-" : `${v.toFixed(2)}%`),
                  },
                  {
                    title: `平均掉速% · ${b.name}`,
                    dataIndex: "bDrop",
                    render: (v: number | null) => (v === null ? "-" : `${v.toFixed(2)}%`),
                  },
                  {
                    title: "平均轮间差 A",
                    dataIndex: "aSpread",
                    render: (v: number | null) => (v === null ? "-" : v.toFixed(1)),
                  },
                  {
                    title: "平均轮间差 B",
                    dataIndex: "bSpread",
                    render: (v: number | null) => (v === null ? "-" : v.toFixed(1)),
                  },
                ]}
              />
            </Card>
          )}
        </Space>
      )}
    </Modal>
  );
}
