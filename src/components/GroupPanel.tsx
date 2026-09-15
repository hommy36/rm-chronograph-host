import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Badge,
  Button,
  Card,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Progress,
  Space,
  Tooltip,
} from "antd";
import {
  CheckCircleFilled,
  DeleteOutlined,
  ExperimentOutlined,
  InboxOutlined,
  PlusOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store";
import type { GroupParams } from "../types";
import { EMPTY_PARAMS } from "../types";

const FIELDS: {
  key: keyof GroupParams;
  label: string;
  placeholder: string;
  suffix?: string;
}[] = [
  { key: "stage1_rpm", label: "一级转速", placeholder: "如 405" },
  { key: "stage2_rpm", label: "二级转速", placeholder: "如 410" },
  { key: "pid", label: "PID", placeholder: "如 0.0002, 0.0, 0.0000003" },
  { key: "compression", label: "压缩量", placeholder: "如 34.7", suffix: "mm" },
  { key: "hardness", label: "硬度", placeholder: "如 25A-35A" },
  { key: "note", label: "备注", placeholder: "选填" },
];

const addonLabelStyle: CSSProperties = {
  display: "inline-block",
  width: 62,
  textAlign: "left",
  color: "#555",
};

export default function GroupPanel() {
  const groups = useAppStore((s) => s.groups);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const startGroup = useAppStore((s) => s.startGroup);
  const endGroup = useAppStore((s) => s.endGroup);
  const setViewingGroup = useAppStore((s) => s.setViewingGroup);
  const clearAll = useAppStore((s) => s.clearAll);
  const targetShots = useAppStore((s) => s.targetShots);
  const setTargetShots = useAppStore((s) => s.setTargetShots);

  const [params, setParams] = useState<GroupParams>({ ...EMPTY_PARAMS });

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const shotCount = activeGroup?.shots.length ?? 0;
  const reached = shotCount >= targetShots;

  const handleStart = () => {
    startGroup({ ...params });
    message.success("已开始新组，测速帧将计入该组");
  };

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <ExperimentOutlined style={{ color: "#1677ff" }} />
          <span>分组测试</span>
        </Space>
      }
      extra={
        <Space size={4}>
          <span style={{ fontSize: 12, color: "#888" }}>目标</span>
          <InputNumber
            size="small"
            min={1}
            max={99999}
            value={targetShots}
            onChange={(v) => setTargetShots(v ?? 1)}
            style={{ width: 68 }}
          />
          <span style={{ fontSize: 12, color: "#888" }}>发</span>
        </Space>
      }
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
      styles={{ body: { flex: 1, minHeight: 0, overflow: "auto" } }}
    >
      {/* 参数表单：标签内嵌输入框，各行对齐 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FIELDS.map((f) => (
          <Input
            key={f.key}
            addonBefore={<span style={addonLabelStyle}>{f.label}</span>}
            addonAfter={f.suffix}
            placeholder={f.placeholder}
            value={params[f.key]}
            disabled={activeGroup !== null}
            onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}
          />
        ))}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0 10px" }}>
        {activeGroup === null ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleStart}
            block
          >
            开始新组
          </Button>
        ) : (
          <Button danger icon={<StopOutlined />} onClick={endGroup} block>
            结束本组
          </Button>
        )}
        <Popconfirm
          title="清空全部组别与数据？"
          okText="清空"
          cancelText="取消"
          onConfirm={clearAll}
          disabled={groups.length === 0}
        >
          <Tooltip title="清空全部">
            <Button icon={<DeleteOutlined />} disabled={groups.length === 0} />
          </Tooltip>
        </Popconfirm>
      </div>

      {/* 记录中状态条 */}
      {activeGroup && (
        <div
          style={{
            background: reached ? "#f6ffed" : "#f0f7ff",
            border: `1px solid ${reached ? "#b7eb8f" : "#d6e4ff"}`,
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "#666",
              marginBottom: 4,
            }}
          >
            <span>
              <Badge status="processing" /> {activeGroup.name} 记录中
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {shotCount} / {targetShots}
            </span>
          </div>
          <Progress
            percent={Math.min(
              100,
              Math.round((shotCount / targetShots) * 100)
            )}
            size="small"
            showInfo={false}
            status={reached ? "success" : "active"}
          />
          {reached && (
            <div style={{ fontSize: 12, color: "#52c41a", marginTop: 2 }}>
              <CheckCircleFilled /> 已达目标发数，可结束本组
            </div>
          )}
        </div>
      )}

      {/* 组列表 */}
      {groups.length === 0 ? (
        <div
          style={{
            border: "1px dashed #d9d9d9",
            borderRadius: 8,
            padding: "14px 12px",
            textAlign: "center",
            color: "#999",
            fontSize: 12,
            lineHeight: 1.8,
          }}
        >
          <InboxOutlined
            style={{ fontSize: 22, color: "#c9c9c9", marginBottom: 4 }}
          />
          <div style={{ color: "#888", fontWeight: 500 }}>暂无组别</div>
          <div>
            第一发测速帧自动创建「未分组」兜底
            <br />
            有历史组后仅记录到当前组
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#999", margin: "2px 0 6px" }}>
            测试记录
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {groups.map((g) => (
              <Tooltip
                key={g.id}
                placement="right"
                title={
                  <div style={{ fontSize: 12 }}>
                    一级转速 {g.params.stage1_rpm || "--"} · 二级转速{" "}
                    {g.params.stage2_rpm || "--"}
                    <br />
                    PID {g.params.pid || "--"} · 压缩量{" "}
                    {g.params.compression || "--"} mm
                    <br />
                    硬度 {g.params.hardness || "--"}
                    {g.params.note ? ` · ${g.params.note}` : ""}
                  </div>
                }
              >
                <div
                  onClick={() => setViewingGroup(g.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "7px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background:
                      g.id === viewingGroupId ? "#e6f4ff" : "#fafafa",
                    border:
                      g.id === viewingGroupId
                        ? "1px solid #91caff"
                        : "1px solid transparent",
                    transition: "background 0.2s",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {g.name}
                    {g.id === activeGroupId && (
                      <Badge
                        status="processing"
                        text={
                          <span style={{ fontSize: 12, color: "#1677ff" }}>
                            记录中
                          </span>
                        }
                        style={{ marginLeft: 8 }}
                      />
                    )}
                  </span>
                  <span style={{ color: "#999", fontSize: 12 }}>
                    {g.shots.length} 发
                  </span>
                </div>
              </Tooltip>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
