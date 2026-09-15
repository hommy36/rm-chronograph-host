import { useState } from "react";
import { Button, Card, message, Space, Table } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import { buildAllGroupsCsv, buildGroupCsv, saveCsv } from "../csv";
import type { Shot } from "../types";

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

  const handleExport = async (all: boolean) => {
    setExporting(true);
    try {
      if (all) {
        if (groups.length === 0) return;
        const ok = await saveCsv(
          `测速汇总_${new Date().toISOString().slice(0, 10)}.csv`,
          buildAllGroupsCsv(groups)
        );
        if (ok) message.success("已导出全部组汇总");
      } else {
        if (!group) return;
        const ok = await saveCsv(`${group.name}_明细.csv`, buildGroupCsv(group));
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
        ]}
      />
    </Card>
  );
}
