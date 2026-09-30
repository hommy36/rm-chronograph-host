import { useMemo, useState } from "react";
import { Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import type { WaveConfig, WheelGroupCfg } from "../types";

/** 组配色（与掉速详情图曲线用色一致） */
export const GROUP_COLORS = [
  "#1677ff",
  "#52c41a",
  "#fa8c16",
  "#eb2f96",
  "#722ed1",
  "#13c2c2",
  "#f5222d",
  "#a0d911",
];

let nextGroupCfgId = 1;

export default function WaveSettingsModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const waveChannelCount = useAppStore((s) => s.waveChannelCount);
  const saved = useAppStore((s) => s.waveConfig);
  const setWaveConfig = useAppStore((s) => s.setWaveConfig);

  // 打开时把当前配置拷进本地草稿
  const [draft, setDraft] = useState<WaveConfig>(saved);
  const [prevOpen, setPrevOpen] = useState(false);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) {
      setDraft({
        groups: saved.groups.map((g) => ({ ...g, channels: [...g.channels] })),
        channelLabels: { ...saved.channelLabels },
      });
    }
  }

  // 展示的通道行数：已识别通道数与已配置通道取大，至少 8
  const maxConfigured = useMemo(() => {
    let m = -1;
    for (const g of draft.groups) {
      for (const c of g.channels) if (c > m) m = c;
    }
    for (const k of Object.keys(draft.channelLabels)) {
      const c = Number(k);
      if (c > m) m = c;
    }
    return m;
  }, [draft]);
  const rowCount = Math.max(waveChannelCount, maxConfigured + 1, 8);

  /** 通道 → 所属组 id */
  const channelGroup = useMemo(() => {
    const map = new Map<number, number>();
    for (const g of draft.groups) {
      for (const c of g.channels) map.set(c, g.id);
    }
    return map;
  }, [draft]);

  const assignChannel = (ch: number, groupId: number | null) => {
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g) => ({
        ...g,
        channels:
          groupId === g.id
            ? [...new Set([...g.channels, ch])].sort((a, b) => a - b)
            : g.channels.filter((c) => c !== ch),
      })),
    }));
  };

  const applyPreset = (stage1: number, stage2: number) => {
    const g1: WheelGroupCfg = {
      id: nextGroupCfgId++,
      name: "一级",
      channels: Array.from({ length: stage1 }, (_, i) => i),
    };
    const groups: WheelGroupCfg[] = [g1];
    const labels: Record<number, string> = {};
    g1.channels.forEach((c, i) => (labels[c] = `一${i + 1}`));
    if (stage2 > 0) {
      const g2: WheelGroupCfg = {
        id: nextGroupCfgId++,
        name: "二级",
        channels: Array.from({ length: stage2 }, (_, i) => stage1 + i),
      };
      groups.push(g2);
      g2.channels.forEach((c, i) => (labels[c] = `二${i + 1}`));
    }
    setDraft({ groups, channelLabels: labels });
  };

  const handleSave = () => {
    const cfg: WaveConfig = {
      groups: draft.groups
        .filter((g) => g.channels.length > 0)
        .map((g) => ({ ...g })),
      channelLabels: { ...draft.channelLabels },
    };
    setWaveConfig(cfg);
    props.onClose();
  };

  return (
    <Modal
      title="波形通道设置"
      open={props.open}
      onCancel={props.onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      width={640}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          已识别通道数：
          {waveChannelCount > 0 ? (
            <Tag color="blue">{waveChannelCount}</Tag>
          ) : (
            <Tag>未识别（连接波形口后自动识别）</Tag>
          )}
          <span style={{ color: "#888" }}>
            把每个 JustFloat 通道指派到对应摩擦轮组，同组轮子会算轮间差
          </span>
        </div>
        <Space wrap>
          <span style={{ color: "#888" }}>快捷预设：</span>
          <Button size="small" onClick={() => applyPreset(1, 1)}>
            单级 1+1
          </Button>
          <Button size="small" onClick={() => applyPreset(2, 2)}>
            双级 2+2
          </Button>
          <Button size="small" onClick={() => applyPreset(3, 3)}>
            双级六摩擦 3+3
          </Button>
        </Space>
        <Table
          size="small"
          rowKey={(r) => r.ch}
          pagination={false}
          dataSource={Array.from({ length: rowCount }, (_, ch) => ({ ch }))}
          columns={[
            {
              title: "通道",
              dataIndex: "ch",
              width: 70,
              render: (ch: number) => `#${ch}`,
            },
            {
              title: "标签（轮子名）",
              dataIndex: "ch",
              render: (ch: number) => (
                <Input
                  size="small"
                  style={{ width: 120 }}
                  placeholder={`通道${ch}`}
                  value={draft.channelLabels[ch] ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      channelLabels: { ...d.channelLabels, [ch]: e.target.value },
                    }))
                  }
                />
              ),
            },
            {
              title: "所属轮组",
              dataIndex: "ch",
              render: (ch: number) => (
                <Select
                  size="small"
                  style={{ width: 160 }}
                  value={channelGroup.get(ch) ?? null}
                  placeholder="未分配"
                  allowClear
                  onChange={(v: number | null) => assignChannel(ch, v)}
                  options={draft.groups.map((g) => ({ value: g.id, label: g.name }))}
                />
              ),
            },
          ]}
        />
        <div>
          <div style={{ marginBottom: 6, color: "#888" }}>轮组管理：</div>
          <Space wrap>
            {draft.groups.map((g, gi) => (
              <Tag
                key={g.id}
                closable
                color={GROUP_COLORS[gi % GROUP_COLORS.length]}
                onClose={() =>
                  setDraft((d) => ({
                    ...d,
                    groups: d.groups.filter((x) => x.id !== g.id),
                  }))
                }
              >
                <Input
                  size="small"
                  bordered={false}
                  style={{
                    width: 56,
                    background: "transparent",
                    color: "inherit",
                    padding: 0,
                  }}
                  value={g.name}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      groups: d.groups.map((x) =>
                        x.id === g.id ? { ...x, name: e.target.value } : x
                      ),
                    }))
                  }
                />
                （{g.channels.length} 轮）
              </Tag>
            ))}
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  groups: [
                    ...d.groups,
                    { id: nextGroupCfgId++, name: `组${d.groups.length + 1}`, channels: [] },
                  ],
                }))
              }
            >
              加轮组
            </Button>
          </Space>
        </div>
      </Space>
    </Modal>
  );
}
