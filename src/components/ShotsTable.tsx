import { useState } from "react";
import { Button, Card, Checkbox, message, Space, Table, Tooltip } from "antd";
import { DownloadOutlined, LineChartOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import { buildAllGroupsCsv, buildGroupCsv, saveCsv } from "../csv";
import type { Shot } from "../types";
import ShotWaveModal from "./ShotWaveModal";

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3
  )}`;
}

export default function ShotsTable() {
  const groups = useAppStore((s) => s.groups);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const group = groups.find((g) => g.id === viewingGroupId) ?? null;
  const [exporting, setExporting] = useState(false);
  /** 导出时是否附带摩擦轮掉速指标列 */
  const [withWave, setWithWave] = useState(true);
  const waveConfig = useAppStore((s) => s.waveConfig);
  /** 掉速详情弹窗：正在查看的发序号 */
  const [waveShotIdx, setWaveShotIdx] = useState<number | null>(null);

  const handleExport = async (all: boolean) => {
    setExporting(true);
    // 让出一帧让 loading 状态先渲染，再做同步的 CSV 构建
    await new Promise((r) => setTimeout(r, 0));
    // 单组导出用该组自己的通道分配；汇总导出按组分别解析
    const cfg = withWave ? waveConfig : null;
    try {
      if (all) {
        if (groups.length === 0) return;
        const ok = await saveCsv(
          `测速汇总_${new Date().toISOString().slice(0, 10)}.csv`,
          buildAllGroupsCsv(groups, cfg)
        );
        if (ok) message.success("已导出全部组汇总");
      } else {
        if (!group) return;
        const ok = await saveCsv(
          `${group.name}_明细.csv`,
          buildGroupCsv(group, withWave ? (group.waveConfig ?? waveConfig) : null)
        );
        if (ok) message.success(`已导出 ${group.name}`);
      }
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card
      size="small"
      title={group ? `弹速明细 — ${group.name}` : "弹速明细"}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
      styles={{ body: { flex: 1, minHeight: 0, overflow: "auto", padding: 0 } }}
      extra={
        <Space>
          <Tooltip title="导出时每发追加摩擦轮基线/掉速量/掉速%/恢复时间及组内轮间差（需已连接过波形口）">
            <Checkbox
              checked={withWave}
              onChange={(e) => setWithWave(e.target.checked)}
            >
              含摩擦轮数据
            </Checkbox>
          </Tooltip>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={!group || group.shots.length === 0}
            loading={exporting}
            onClick={() => handleExport(false)}
          >
            导出当前组
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={groups.length === 0}
            loading={exporting}
            onClick={() => handleExport(true)}
          >
            导出全部组汇总
          </Button>
        </Space>
      }
    >
      <Table<Shot>
        size="small"
        rowKey="idx"
        dataSource={group ? [...group.shots].reverse() : []}
        pagination={false}
        sticky
        onRow={(shot) => {
          const isNewest = group ? shot.idx === group.shots.length : false;
          return {
            className: isNewest ? "shot-row-new" : undefined,
            onClick: () => {
              if (shot.wave) setWaveShotIdx(shot.idx);
            },
            style: shot.wave ? { cursor: "pointer" } : undefined,
          };
        }}
        columns={[
          { title: "序号", dataIndex: "idx", width: 80 },
          {
            title: "弹速 (m/s)",
            dataIndex: "speed_mps",
            render: (v: number) => v.toFixed(3),
          },
          { title: "dt (µs)", dataIndex: "dt_us" },
          {
            title: "接收时间",
            dataIndex: "at_ms",
            render: (v: number) => fmtTime(v),
          },
          {
            title: "掉速",
            key: "wave",
            width: 64,
            render: (_: unknown, shot: Shot) =>
              shot.wave ? (
                <Tooltip title="查看该发掉速/恢复曲线">
                  <LineChartOutlined style={{ color: "#1677ff" }} />
                </Tooltip>
              ) : null,
          },
        ]}
      />
      {group && waveShotIdx !== null && (
        <ShotWaveModal
          group={group}
          shotIdx={waveShotIdx}
          onClose={() => setWaveShotIdx(null)}
          onNavigate={(idx) => setWaveShotIdx(idx)}
        />
      )}
    </Card>
  );
}
