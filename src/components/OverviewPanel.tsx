import { useMemo, useState } from "react";
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
import { DownloadOutlined, WarningOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import { groupDispersion } from "../compare";
import { groupSummary, type GroupSummaryRow } from "../analysis";
import { saveCsv } from "../csv";
import { buildOverviewCsv } from "../csv";
import CrossGroupCard from "./CrossGroupCard";

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
  v === null || v === undefined || !Number.isFinite(v)
    ? "-"
    : `${v.toFixed(d)}${suffix}`;

/** 测试总览：逐组汇总表 + 跨组时间轴 */
export default function OverviewPanel() {
  const groups = useAppStore((s) => s.groups);
  const globalCfg = useAppStore((s) => s.waveConfig);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const setViewingGroup = useAppStore((s) => s.setViewingGroup);

  const [target, setTarget] = useState<number | null>(loadTarget);
  const [tolPct, setTolPct] = useState<number>(1);
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
                      color:
                        p >= 0.9 ? "#52c41a" : p >= 0.7 ? "#faad14" : "#f5222d",
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

        <CrossGroupCard />
      </Space>
    </Card>
  );
}
