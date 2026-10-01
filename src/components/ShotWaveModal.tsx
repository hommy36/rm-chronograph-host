import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, SeriesOption } from "echarts";
import { Button, Modal, Slider, Space, Switch, Table, Tag } from "antd";
import { LeftOutlined, LineChartOutlined, RightOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import type { Group, Shot } from "../types";
import { analyzeDrop, maxIntraGroupSpread, smoothSeries } from "../wave";
import { GROUP_COLORS } from "./WaveSettingsModal";

/** 每通道曲线配色（互相可区分；轮组身份用标签/色点表达） */
const CHANNEL_COLORS = [
  "#1677ff",
  "#fa8c16",
  "#52c41a",
  "#eb2f96",
  "#722ed1",
  "#13c2c2",
  "#f5222d",
  "#faad14",
  "#2f54eb",
  "#a0d911",
  "#fa541c",
  "#08979c",
];

const channelColor = (ch: number) => CHANNEL_COLORS[ch % CHANNEL_COLORS.length];

interface Row {
  key: string;
  label: string;
  color: string;
  flat: boolean;
  groupName: string | null;
  groupColor: string;
  baseline: number;
  drop: number;
  dropPct: number;
  recoverMs: number | null;
}

export default function ShotWaveModal(props: {
  group: Group;
  shotIdx: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const waveConfig = useAppStore((s) => s.waveConfig);
  const [smoothWin, setSmoothWin] = useState(9);
  const [showRaw, setShowRaw] = useState(false);

  const shot: Shot | undefined = props.group.shots.find(
    (s) => s.idx === props.shotIdx
  );
  const wave = shot?.wave;

  const channelOf = useMemo(() => {
    // 通道 → { 组名, 组色, 组内序号 }
    const m = new Map<number, { name: string; color: string; gi: number }>();
    waveConfig.groups.forEach((g, gi) => {
      g.channels.forEach((c) => {
        m.set(c, {
          name: g.name,
          color: GROUP_COLORS[gi % GROUP_COLORS.length],
          gi: g.channels.indexOf(c),
        });
      });
    });
    return m;
  }, [waveConfig]);

  const labelOf = (ch: number) =>
    waveConfig.channelLabels[ch]?.trim() || `通道${ch}`;

  const smoothed = useMemo(() => {
    if (!wave) return [];
    return wave.channels.map((s) => smoothSeries(s, smoothWin));
  }, [wave, smoothWin]);

  /** 平直通道（全程无变化，如未使用的恒零通道） */
  const flatChannels = useMemo(() => {
    const set = new Set<number>();
    if (!wave) return set;
    wave.channels.forEach((s, ch) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of s) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo < 1e-6) set.add(ch);
    });
    return set;
  }, [wave]);
  const [hideFlat, setHideFlat] = useState(true);

  const rows: Row[] = useMemo(() => {
    if (!wave) return [];
    return wave.channels.map((_raw, ch) => {
      const m = analyzeDrop(wave.times, smoothed[ch]);
      const grp = channelOf.get(ch);
      return {
        key: String(ch),
        label: labelOf(ch),
        color: channelColor(ch),
        flat: flatChannels.has(ch),
        groupName: grp?.name ?? null,
        groupColor: grp?.color ?? "#888",
        baseline: m?.baseline ?? 0,
        drop: m?.drop ?? 0,
        dropPct: m?.dropPct ?? 0,
        recoverMs: m?.recoverMs ?? null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave, smoothed, channelOf, waveConfig, flatChannels]);

  const groupSpreads = useMemo(() => {
    if (!wave) return [];
    return waveConfig.groups.map((g, gi) => {
      const list = g.channels
        .filter((c) => c < wave.channels.length)
        .map((c) => smoothed[c]);
      return {
        name: g.name,
        color: GROUP_COLORS[gi % GROUP_COLORS.length],
        spread: list.length >= 2 ? maxIntraGroupSpread(list) : 0,
        n: list.length,
      };
    });
  }, [wave, waveConfig, smoothed]);

  const option = useMemo<EChartsOption>(() => {
    if (!wave) return {};
    const series: SeriesOption[] = wave.channels
      .map((raw, ch) => ({ raw, ch }))
      .filter(({ ch }) => !(hideFlat && flatChannels.has(ch)))
      .map(({ raw, ch }) => {
        const color = channelColor(ch);
        const pts = wave.times.map((t, i) => [
          t,
          showRaw ? raw[i] : smoothed[ch][i],
        ]);
        return {
          name: labelOf(ch),
          type: "line",
          data: pts,
          showSymbol: false,
          lineStyle: { width: 1.5, color },
          itemStyle: { color },
          emphasis: { focus: "series" },
        };
      });
    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 250,
      animationEasingUpdate: "cubicOut",
      grid: { left: 70, right: 46, top: 46, bottom: 60 },
      legend: { type: "scroll", top: 4, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis", valueFormatter: (v) => Number(v).toFixed(1) },
      xAxis: {
        type: "value",
        name: "ms（0 = 发射）",
        nameLocation: "middle",
        nameGap: 28,
        min: wave.times[0],
        max: wave.times[wave.times.length - 1],
      },
      yAxis: { type: "value", scale: true },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, zoomOnMouseWheel: true },
        { type: "inside", yAxisIndex: 0, zoomOnMouseWheel: "shift" },
        { type: "slider", xAxisIndex: 0, height: 18, bottom: 6 },
        { type: "slider", yAxisIndex: 0, width: 14, right: 8 },
      ],
      series: [
        ...series,
        {
          name: "发射时刻",
          type: "line",
          data: [],
          markLine: {
            animation: false,
            silent: true,
            symbol: "none",
            lineStyle: { color: "#f5222d", type: "dashed" },
            label: { formatter: "发射", fontSize: 10 },
            data: [{ xAxis: 0 }],
          },
        },
      ],
    };
  }, [wave, smoothed, showRaw, channelOf, waveConfig, hideFlat, flatChannels]);

  const hasPrev = props.shotIdx > 1;
  const hasNext = props.shotIdx < props.group.shots.length;

  return (
    <Modal
      title={
        <Space>
          <LineChartOutlined />
          {`掉速详情 — ${props.group.name} · 第 ${props.shotIdx} 发`}
          {shot && <Tag color="blue">{shot.speed_mps.toFixed(3)} m/s</Tag>}
        </Space>
      }
      open
      onCancel={props.onClose}
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Space>
            <Button
              icon={<LeftOutlined />}
              disabled={!hasPrev}
              onClick={() => props.onNavigate(props.shotIdx - 1)}
            >
              上一发
            </Button>
            <Button
              icon={<RightOutlined />}
              iconPosition="end"
              disabled={!hasNext}
              onClick={() => props.onNavigate(props.shotIdx + 1)}
            >
              下一发
            </Button>
          </Space>
          <Space size="large">
            <span>
              原始{" "}
              <Switch size="small" checked={showRaw} onChange={setShowRaw} />
            </span>
            <span>
              隐藏平直通道{" "}
              <Switch size="small" checked={hideFlat} onChange={setHideFlat} />
            </span>
            <span>
              平滑窗口{" "}
              <Slider
                style={{ width: 140, display: "inline-block", verticalAlign: "middle" }}
                min={1}
                max={31}
                step={2}
                value={smoothWin}
                onChange={setSmoothWin}
              />{" "}
              {smoothWin <= 1 ? "关" : smoothWin}
            </span>
          </Space>
        </Space>
      }
      width="80%"
      centered
      styles={{
        body: { maxHeight: "calc(100vh - 180px)", overflowY: "auto", paddingRight: 8 },
      }}
    >
      {!wave ? (
        <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
          这一发没有波形快照（发射时波形口未连接或数据不足）
        </div>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <ReactECharts option={option} style={{ height: 380 }} notMerge />
          {groupSpreads.length > 0 && (
            <Space wrap size="middle">
              {groupSpreads.map((g) => (
                <Tag key={g.name} color={g.color} style={{ fontSize: 13, padding: "2px 10px" }}>
                  {g.name} 组内最大轮间差：{g.n >= 2 ? g.spread.toFixed(1) : "—（单轮）"}
                </Tag>
              ))}
            </Space>
          )}
          <Table<Row>
            size="small"
            rowKey="key"
            pagination={false}
            dataSource={rows}
            columns={[
              {
                title: "轮子",
                dataIndex: "label",
                render: (v: string, r) => (
                  <Space size={6}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: r.color,
                      }}
                    />
                    {v}
                    {r.flat && <Tag style={{ marginInlineStart: 2 }}>平直</Tag>}
                    {r.groupName && (
                      <Tag color={r.groupColor} style={{ marginInlineStart: 2 }}>
                        {r.groupName}
                      </Tag>
                    )}
                  </Space>
                ),
              },
              {
                title: "基线",
                dataIndex: "baseline",
                render: (v: number) => v.toFixed(1),
              },
              {
                title: "掉速量",
                dataIndex: "drop",
                render: (v: number) => v.toFixed(1),
              },
              {
                title: "掉速 %",
                dataIndex: "dropPct",
                render: (v: number) => `${v.toFixed(2)}%`,
              },
              {
                title: "恢复时间",
                dataIndex: "recoverMs",
                render: (v: number | null) => (v === null ? "未恢复" : `${v.toFixed(0)} ms`),
              },
            ]}
          />
        </Space>
      )}
    </Modal>
  );
}
