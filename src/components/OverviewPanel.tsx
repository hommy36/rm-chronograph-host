import { useMemo, useState } from "react";
import {
  Button,
  Card,
  InputNumber,
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
import { buildOverviewCsv, saveCsv } from "../csv";
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

/** 带说明的列标题：悬浮显示该指标的含义 */
function H(title: string, tip: string) {
  return (
    <Tooltip title={tip}>
      <span style={{ borderBottom: "1px dotted #bbb", cursor: "help" }}>
        {title}
      </span>
    </Tooltip>
  );
}

const TIP = {
  mean: "该组所有发弹速的平均值",
  range: "最大值 − 最小值",
  std: "样本标准差（÷(n−1)，与 Excel STDEV.S 一致）；越小说明越稳定",
  cv: "变异系数 = 标准差 ÷ 均值 × 100%；不同弹速水平的组之间比稳定性更公平",
  pass: "弹速落在「目标弹速 ± 容差%」内的发数占比。目标留空时按各组自身均值计算",
  outlier: "离群发数：|z| ≥ 2.5 的发数，z =（弹速 − 均值）÷ 标准差",
  trend: "逐发最小二乘斜率（m/s 每发）：正=越打越快，负=越打越慢",
  r50: "R50 = 半数落点半径：以弹着中心为圆心，50% 的落点落在这个半径内，越小越密集",
  ring: "以弹着中心为基准的平均环数：每 14mm 一环，最内环 10 分，9 环外记 0 分（需在散布分析里标过点）",
  drop: "该组所有发、所有摩擦轮通道的平均掉速百分比（需连接波形口采集过转速）",
};

/** 测试总览：逐组汇总表 + 跨组时间轴 */
export default function OverviewPanel() {
  const allGroups = useAppStore((s) => s.groups);
  const activeTestId = useAppStore((s) => s.activeTestId);
  const tests = useAppStore((s) => s.tests);
  // 只统计当前选中的测试
  const groups = useMemo(
    () => allGroups.filter((g) => g.testId === activeTestId),
    [allGroups, activeTestId]
  );
  const testName = tests.find((t) => t.id === activeTestId)?.name ?? "未选择测试";
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
          { target, tolPct }
        );
      }),
    [groups, globalCfg, target, tolPct]
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

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <span>测试总览</span>
          <Tag color="blue">{testName}</Tag>
          <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
            共 {groups.length} 组 / {groups.reduce((a, g) => a + g.shots.length, 0)} 发
          </span>
        </Space>
      }
      extra={
        <Space size={8}>
          <Tooltip title="达标率的判定基准。留空时各组用自身均值作为目标">
            <span style={{ fontSize: 12, color: "#888", cursor: "help" }}>
              目标弹速
            </span>
          </Tooltip>
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
          <Tooltip title="达标判定范围：弹速与目标值相差不超过「目标值 × 该百分比」即算达标（可自行输入，如 1.5）">
            <span style={{ fontSize: 12, color: "#888", cursor: "help" }}>
              容差
            </span>
          </Tooltip>
          <InputNumber
            size="small"
            min={0.05}
            max={20}
            step={0.1}
            style={{ width: 96 }}
            value={tolPct}
            onChange={(v) => setTolPct(v === null ? 1 : Number(v))}
            addonAfter="%"
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
            {
              title: "PID",
              dataIndex: ["params", "pid"],
              width: 110,
              ellipsis: true,
            },
            { title: "压缩量", dataIndex: ["params", "compression"], width: 70 },
            { title: "硬度", dataIndex: ["params", "hardness"], width: 70 },
            {
              title: "发数",
              dataIndex: "n",
              width: 60,
              sorter: (a, b) => a.n - b.n,
            },
            {
              title: H("均值 (m/s)", TIP.mean),
              dataIndex: "mean",
              width: 104,
              sorter: (a, b) => (a.mean ?? 0) - (b.mean ?? 0),
              render: (v: number | null) => fmt(v, 4),
            },
            {
              title: H("极差", TIP.range),
              dataIndex: "range",
              width: 86,
              sorter: (a, b) => (a.range ?? 0) - (b.range ?? 0),
              render: (v: number | null) => fmt(v, 3),
            },
            {
              title: H("标准差", TIP.std),
              dataIndex: "std",
              width: 90,
              sorter: (a, b) => (a.std ?? 0) - (b.std ?? 0),
              render: (v: number | null) => fmt(v, 4),
            },
            {
              title: H("CV%", TIP.cv),
              dataIndex: "cv",
              width: 78,
              sorter: (a, b) => (a.cv ?? 0) - (b.cv ?? 0),
              render: (v: number | null) => fmt(v, 2),
            },
            {
              title: H(`达标率 ±${tolPct}%`, TIP.pass),
              key: "pass",
              width: 104,
              render: (_: unknown, r) => {
                const p = r.pass;
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
              title: H("离群", TIP.outlier),
              dataIndex: "outlierCount",
              width: 70,
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
              title: H("趋势/发", TIP.trend),
              dataIndex: "trend",
              width: 92,
              render: (v: number | null) => fmt(v, 4),
            },
            {
              title: H("R50 (mm)", TIP.r50),
              dataIndex: "r50",
              width: 94,
              sorter: (a, b) => (a.r50 ?? 1e9) - (b.r50 ?? 1e9),
              render: (v: number | null) => fmt(v, 2),
            },
            {
              title: H("平均环数", TIP.ring),
              dataIndex: "meanRing",
              width: 94,
              sorter: (a, b) => (a.meanRing ?? -1) - (b.meanRing ?? -1),
              render: (v: number | null) => fmt(v, 2),
            },
            {
              title: H("平均掉速%", TIP.drop),
              dataIndex: "wheelDropPct",
              width: 102,
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
