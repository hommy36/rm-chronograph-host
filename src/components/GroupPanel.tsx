import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  message,
  Popconfirm,
  Progress,
  Space,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import {
  AimOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExperimentOutlined,
  ExportOutlined,
  FundOutlined,
  ImportOutlined,
  InboxOutlined,
  PlusOutlined,
  RightOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store";
import type { Group, GroupParams, TestSession } from "../types";
import { EMPTY_PARAMS } from "../types";
import { exportProject, importProject } from "../sessionIO";
import { buildGroupCsv, saveCsv } from "../csv";
import CompareModal from "./CompareModal";

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

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

/** 重命名弹窗的目标 */
interface Renaming {
  kind: "test" | "group";
  id: number;
  value: string;
}

export default function GroupPanel() {
  const tests = useAppStore((s) => s.tests);
  const activeTestId = useAppStore((s) => s.activeTestId);
  const groups = useAppStore((s) => s.groups);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const startGroup = useAppStore((s) => s.startGroup);
  const endGroup = useAppStore((s) => s.endGroup);
  const startTest = useAppStore((s) => s.startTest);
  const renameTest = useAppStore((s) => s.renameTest);
  const renameGroup = useAppStore((s) => s.renameGroup);
  const deleteTest = useAppStore((s) => s.deleteTest);
  const setActiveTest = useAppStore((s) => s.setActiveTest);
  const setViewingGroup = useAppStore((s) => s.setViewingGroup);
  const deleteGroup = useAppStore((s) => s.deleteGroup);
  const clearAll = useAppStore((s) => s.clearAll);
  const targetShots = useAppStore((s) => s.targetShots);
  const setTargetShots = useAppStore((s) => s.setTargetShots);
  const compareIds = useAppStore((s) => s.compareIds);
  const toggleCompare = useAppStore((s) => s.toggleCompare);
  const clearWaveforms = useAppStore((s) => s.clearWaveforms);
  const waveConfig = useAppStore((s) => s.waveConfig);

  const [params, setParams] = useState<GroupParams>({ ...EMPTY_PARAMS });
  const [compareOpen, setCompareOpen] = useState(false);
  const [ioBusy, setIoBusy] = useState(false);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  /** 展开的测试（默认跟随当前测试） */
  const [expanded, setExpanded] = useState<number | null>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const shotCount = activeGroup?.shots.length ?? 0;
  const reached = shotCount >= targetShots;
  const waveShotCount = groups.reduce(
    (n, g) => n + g.shots.filter((s) => s.wave).length,
    0
  );

  const groupsOf = (testId: number) => groups.filter((g) => g.testId === testId);
  const expandedId = expanded ?? activeTestId;

  const handleStart = () => {
    startGroup({ ...params });
    message.success("已开始新组，测速帧将计入该组");
  };

  const handleNewTest = () => {
    const id = startTest();
    setExpanded(id);
    message.success("已新建测试，点「开始新组」开始记录");
  };

  const snapshot = () => {
    const s = useAppStore.getState();
    return {
      tests: s.tests,
      groups: s.groups,
      nextTestId: s.nextTestId,
      nextGroupId: s.nextGroupId,
      targetShots: s.targetShots,
      waveConfig: s.waveConfig,
    };
  };

  const handleExportAll = async () => {
    setIoBusy(true);
    try {
      const ok = await exportProject(
        snapshot(),
        `测速项目_${new Date().toISOString().slice(0, 10)}.rmtest`
      );
      if (ok) message.success("项目已导出");
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setIoBusy(false);
    }
  };

  const handleExportTest = async (t: TestSession) => {
    setIoBusy(true);
    try {
      const ok = await exportProject(
        snapshot(),
        `${t.name}.rmtest`,
        t.id
      );
      if (ok) message.success(`已导出测试「${t.name}」`);
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setIoBusy(false);
    }
  };

  const handleExportGroup = async (g: Group) => {
    setIoBusy(true);
    try {
      const ok = await saveCsv(
        `${g.name}_明细.csv`,
        buildGroupCsv(g, g.waveConfig ?? waveConfig)
      );
      if (ok) message.success(`已导出「${g.name}」明细`);
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setIoBusy(false);
    }
  };

  const handleImportTest = async () => {
    setIoBusy(true);
    try {
      const data = await importProject();
      if (!data) return;
      useAppStore.getState().hydrate({ ...data, merge: true });
      setExpanded(null);
      message.success(
        `已导入 ${data.tests.length} 个测试 / ${data.groups.length} 组`
      );
    } catch (e) {
      message.error(`导入失败：${e}`);
    } finally {
      setIoBusy(false);
    }
  };

  const confirmDeleteTest = (t: TestSession) => {
    const n = groupsOf(t.id).length;
    Modal.confirm({
      title: `删除测试「${t.name}」？`,
      content: `其下 ${n} 个组及全部弹速/波形/散布数据都会被删除`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        deleteTest(t.id);
        message.success("已删除测试");
      },
    });
  };

  const testMenu = (t: TestSession): MenuProps["items"] => [
    {
      key: "rename",
      icon: <EditOutlined />,
      label: "重命名",
      onClick: () => setRenaming({ kind: "test", id: t.id, value: t.name }),
    },
    {
      key: "export",
      icon: <ExportOutlined />,
      label: "导出该测试 (.rmtest)",
      onClick: () => handleExportTest(t),
    },
    { type: "divider" },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "删除测试",
      danger: true,
      onClick: () => confirmDeleteTest(t),
    },
  ];

  const groupMenu = (g: Group): MenuProps["items"] => [
    {
      key: "rename",
      icon: <EditOutlined />,
      label: "重命名",
      onClick: () => setRenaming({ kind: "group", id: g.id, value: g.name }),
    },
    {
      key: "export",
      icon: <ExportOutlined />,
      label: "导出该组明细 CSV",
      onClick: () => handleExportGroup(g),
    },
    { type: "divider" },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "删除该组",
      danger: true,
      onClick: () => {
        Modal.confirm({
          title: `删除「${g.name}」？`,
          content: `该组 ${g.shots.length} 发数据（含波形）将被删除`,
          okText: "删除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: () => deleteGroup(g.id),
        });
      },
    },
  ];

  const handleRenameOk = () => {
    if (!renaming) return;
    const name = renaming.value.trim();
    if (name) {
      if (renaming.kind === "test") renameTest(renaming.id, name);
      else renameGroup(renaming.id, name);
    }
    setRenaming(null);
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
      styles={{
        body: {
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        },
      }}
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
          title="清空全部测试与数据？"
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

      {/* 测试记录工具栏 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          margin: "2px 0 6px",
        }}
      >
        <span style={{ fontSize: 12, color: "#999" }}>测试记录</span>
        <Space size={2}>
          <Tooltip title="新建测试（一次实验包含多个组）">
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              onClick={handleNewTest}
            />
          </Tooltip>
          <Tooltip title="导入 .rmtest（导入为一个或多个新测试）">
            <Button
              size="small"
              type="text"
              icon={<ImportOutlined />}
              loading={ioBusy}
              onClick={handleImportTest}
            />
          </Tooltip>
          <Tooltip title="导出全部测试 (.rmtest)">
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              disabled={tests.length === 0}
              loading={ioBusy}
              onClick={handleExportAll}
            />
          </Tooltip>
          <Popconfirm
            title="清理全部波形快照？"
            description="仅删除掉速曲线数据，弹速指标与分组参数保留"
            okText="清理"
            cancelText="取消"
            onConfirm={() => {
              clearWaveforms();
              message.success("已清理波形快照");
            }}
            disabled={waveShotCount === 0}
          >
            <Tooltip title={`清理历史波形（当前 ${waveShotCount} 发有波形）`}>
              <Button
                size="small"
                type="text"
                icon={<ThunderboltOutlined />}
                disabled={waveShotCount === 0}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      </div>

      {compareIds.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <Button
            type="primary"
            size="small"
            block
            icon={<FundOutlined />}
            disabled={compareIds.length !== 2}
            onClick={() => setCompareOpen(true)}
          >
            {compareIds.length === 2 ? "一键对比两组" : "再勾选一组进行对比"}
          </Button>
        </div>
      )}

      {/* 测试 → 组 两级列表 */}
      {tests.length === 0 ? (
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
          <div style={{ color: "#888", fontWeight: 500 }}>暂无测试</div>
          <div>
            点上方 ＋ 新建测试，再「开始新组」记录
            <br />
            收到测速帧也会自动建测试兜底
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {tests.map((t) => {
            const mine = groupsOf(t.id);
            const shots = mine.reduce((a, g) => a + g.shots.length, 0);
            const isOpen = expandedId === t.id;
            const at = t.startedAt || t.createdAt;
            return (
              <div key={t.id}>
                <Dropdown
                  menu={{ items: testMenu(t) }}
                  trigger={["contextMenu"]}
                >
                  <div
                    onClick={() => {
                      setActiveTest(t.id);
                      setExpanded(isOpen ? -1 : t.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background: t.id === activeTestId ? "#e6f4ff" : "#fafafa",
                      border:
                        t.id === activeTestId
                          ? "1px solid #91caff"
                          : "1px solid transparent",
                    }}
                  >
                    <span style={{ fontSize: 10, color: "#888" }}>
                      {isOpen ? <DownOutlined /> : <RightOutlined />}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#999",
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtDateTime(at)} · {mine.length} 组 / {shots} 发
                    </span>
                  </div>
                </Dropdown>
                {isOpen && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      margin: "4px 0 2px 14px",
                    }}
                  >
                    {mine.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#bbb", padding: 4 }}>
                        还没有组，点「开始新组」开始记录
                      </div>
                    ) : (
                      mine.map((g) => (
                        <Dropdown
                          key={g.id}
                          menu={{ items: groupMenu(g) }}
                          trigger={["contextMenu"]}
                        >
                          <div
                            onClick={() => setViewingGroup(g.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "6px 8px",
                              borderRadius: 6,
                              cursor: "pointer",
                              background:
                                g.id === viewingGroupId ? "#e6f4ff" : "#fafafa",
                              border:
                                g.id === viewingGroupId
                                  ? "1px solid #91caff"
                                  : "1px solid transparent",
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flex: 1,
                                minWidth: 0,
                              }}
                            >
                              <Checkbox
                                checked={compareIds.includes(g.id)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleCompare(g.id)}
                              />
                              <span
                                style={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {g.name}
                              </span>
                              {g.id === activeGroupId && (
                                <Badge
                                  status="processing"
                                  text={
                                    <span
                                      style={{ fontSize: 12, color: "#1677ff" }}
                                    >
                                      记录中
                                    </span>
                                  }
                                />
                              )}
                            </span>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                flexShrink: 0,
                              }}
                            >
                              {g.dispersion && (
                                <Tooltip title="该组已有散布分析数据">
                                  <span
                                    style={{ color: "#1677ff", fontSize: 12 }}
                                  >
                                    <AimOutlined />
                                    {g.dispersion.points.length > 0
                                      ? g.dispersion.points.length
                                      : ""}
                                  </span>
                                </Tooltip>
                              )}
                              <span style={{ color: "#999", fontSize: 12 }}>
                                {g.shots.length} 发
                              </span>
                              <Popconfirm
                                title={`删除「${g.name}」？`}
                                description={`该组 ${g.shots.length} 发数据（含波形）将被删除`}
                                okText="删除"
                                okButtonProps={{ danger: true }}
                                cancelText="取消"
                                onConfirm={() => deleteGroup(g.id)}
                              >
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </Popconfirm>
                            </span>
                          </div>
                        </Dropdown>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={renaming !== null}
        title={renaming?.kind === "test" ? "重命名测试" : "重命名组"}
        okText="保存"
        cancelText="取消"
        onOk={handleRenameOk}
        onCancel={() => setRenaming(null)}
      >
        <Input
          value={renaming?.value ?? ""}
          autoFocus
          onChange={(e) =>
            setRenaming((r) => (r ? { ...r, value: e.target.value } : r))
          }
          onPressEnter={handleRenameOk}
          placeholder="输入新名称"
        />
      </Modal>

      <CompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
    </Card>
  );
}
