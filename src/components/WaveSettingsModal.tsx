import { useMemo, useState } from "react";
import { Button, Card, Input, InputNumber, Modal, Select, Space, Tag, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
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
  const globalCfg = useAppStore((s) => s.waveConfig);
  const group = useAppStore(
    (s) => s.groups.find((g) => g.id === s.viewingGroupId) ?? null
  );
  const setWaveConfig = useAppStore((s) => s.setWaveConfig);
  const setGroupWaveConfig = useAppStore((s) => s.setGroupWaveConfig);

  // 当前组有自己的分配就用它，否则从全局默认起步；保存回当前组
  const target = group;
  const [draft, setDraft] = useState<WaveConfig>(globalCfg);
  const [prevOpen, setPrevOpen] = useState(false);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) {
      const src = target?.waveConfig ?? globalCfg;
      setDraft({
        groups: src.groups.map((g) => ({ ...g, channels: [...g.channels] })),
        channelLabels: { ...src.channelLabels },
        channelCount: src.channelCount,
      });
    }
  }

  /** 可选通道号：已识别通道数与已用通道取大，至少 8 个 */
  const channelOptions = useMemo(() => {
    let maxUsed = -1;
    for (const g of draft.groups) {
      for (const c of g.channels) if (c > maxUsed) maxUsed = c;
    }
    const n = Math.max(draft.channelCount ?? 0, waveChannelCount, maxUsed + 1, 8);
    return Array.from({ length: n }, (_, i) => ({
      value: i,
      label: `通道 ${i}`,
    }));
  }, [draft, waveChannelCount]);

  /** 已被占用的通道（用于新增轮子时挑一个没被占的） */
  const usedChannels = useMemo(() => {
    const s = new Set<number>();
    for (const g of draft.groups) for (const c of g.channels) s.add(c);
    return s;
  }, [draft]);

  const freeChannel = () => {
    for (let i = 0; i < 64; i++) if (!usedChannels.has(i)) return i;
    return 0;
  };

  const labelOf = (ch: number) => draft.channelLabels[ch] ?? "";

  /** 设置某轮子的通道：标签跟着轮子一起搬到新通道 */
  const setWheelChannel = (gi: number, wi: number, ch: number) => {
    setDraft((d) => {
      const groups = d.groups.map((g, i) =>
        i === gi
          ? { ...g, channels: g.channels.map((c, j) => (j === wi ? ch : c)) }
          : g
      );
      const old = d.groups[gi].channels[wi];
      const labels = { ...d.channelLabels };
      const stillUsed = groups.some((g) => g.channels.includes(old));
      const label = labels[old];
      if (ch !== old) {
        if (!stillUsed) delete labels[old];
        if (label !== undefined) labels[ch] = label;
      }
      return { ...d, groups, channelLabels: labels };
    });
  };

  const setWheelLabel = (ch: number, text: string) =>
    setDraft((d) => ({
      ...d,
      channelLabels: { ...d.channelLabels, [ch]: text },
    }));

  const addWheel = (gi: number) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) =>
        i === gi ? { ...g, channels: [...g.channels, freeChannel()] } : g
      ),
    }));

  const removeWheel = (gi: number, wi: number) =>
    setDraft((d) => {
      const groups = d.groups.map((g, i) =>
        i === gi ? { ...g, channels: g.channels.filter((_, j) => j !== wi) } : g
      );
      const removed = d.groups[gi].channels[wi];
      const labels = { ...d.channelLabels };
      if (!groups.some((g) => g.channels.includes(removed))) delete labels[removed];
      return { ...d, groups, channelLabels: labels };
    });

  const addGroup = () => {
    const ch = freeChannel();
    setDraft((d) => ({
      ...d,
      groups: [
        ...d.groups,
        { id: nextGroupCfgId++, name: `组${d.groups.length + 1}`, channels: [ch] },
      ],
    }));
  };

  const setGroupName = (gi: number, name: string) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) => (i === gi ? { ...g, name } : g)),
    }));

  const removeGroup = (gi: number) =>
    setDraft((d) => {
      const gone = d.groups[gi];
      const groups = d.groups.filter((_, i) => i !== gi);
      const labels = { ...d.channelLabels };
      for (const ch of gone.channels) {
        if (!groups.some((g) => g.channels.includes(ch))) delete labels[ch];
      }
      return { ...d, groups, channelLabels: labels };
    });

  /** 预设：按"轮子数"建组，通道从 0 开始顺序指派 */
  const applyPreset = (stage1: number, stage2: number) => {
    const labels: Record<number, string> = {};
    const build = (
      groupName: string,
      labelPrefix: string,
      n: number,
      from: number
    ): WheelGroupCfg => {
      const channels = Array.from({ length: n }, (_, i) => from + i);
      channels.forEach((c, i) => (labels[c] = `${labelPrefix}${i + 1}`));
      return { id: nextGroupCfgId++, name: groupName, channels };
    };
    const groups: WheelGroupCfg[] = [build("一级", "一", stage1, 0)];
    if (stage2 > 0) groups.push(build("二级", "二", stage2, stage1));
    setDraft({ groups, channelLabels: labels });
  };

  const handleSave = () => {
    const cfg: WaveConfig = {
      groups: draft.groups
        .filter((g) => g.channels.length > 0)
        .map((g) => ({ ...g })),
      channelLabels: { ...draft.channelLabels },
      channelCount: draft.channelCount,
    };
    if (target) setGroupWaveConfig(target.id, cfg);
    else setWaveConfig(cfg);
    props.onClose();
  };

  return (
    <Modal
      title={
        <Space size={8}>
          <span>波形通道设置</span>
          {target ? (
            <Tag color="blue">记录到：{target.name}</Tag>
          ) : (
            <Tag>全局默认（未选择组）</Tag>
          )}
        </Space>
      }
      open={props.open}
      onCancel={props.onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      width={680}
      styles={{ body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto" } }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>
          已识别通道数：
          {waveChannelCount > 0 ? (
            <Tag color="blue">{waveChannelCount}</Tag>
          ) : (
            <Tag>未识别（连接波形口后自动识别）</Tag>
          )}
          给每个摩擦轮选它对应的 JustFloat 通道；同一组内的轮子会算组内轮间差。
          <br />
          没连调试器也能配：手动填一个通道数量即可。
        </div>

        <Space size={8}>
          <span style={{ fontSize: 12, color: "#888" }}>通道数量</span>
          <InputNumber
            size="small"
            min={1}
            max={64}
            style={{ width: 110 }}
            placeholder="自动识别"
            value={draft.channelCount}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                channelCount: v === null ? undefined : Number(v),
              }))
            }
          />
          <span style={{ fontSize: 12, color: "#999" }}>
            留空 = 用自动识别到的通道数
          </span>
        </Space>

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

        {draft.groups.map((g, gi) => (
          <Card
            key={g.id}
            size="small"
            styles={{ body: { padding: "8px 12px" } }}
            title={
              <Space size={6}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: GROUP_COLORS[gi % GROUP_COLORS.length],
                  }}
                />
                <Input
                  size="small"
                  style={{ width: 120 }}
                  value={g.name}
                  onChange={(e) => setGroupName(gi, e.target.value)}
                />
                <span style={{ fontSize: 12, color: "#999", fontWeight: 400 }}>
                  {g.channels.length} 个轮子
                </span>
              </Space>
            }
            extra={
              <Tooltip title="删除该轮组">
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeGroup(gi)}
                />
              </Tooltip>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {g.channels.map((ch, wi) => (
                <div
                  key={wi}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span style={{ fontSize: 12, color: "#888", width: 42 }}>
                    轮 {wi + 1}
                  </span>
                  <Input
                    size="small"
                    style={{ width: 140 }}
                    placeholder={`轮${wi + 1}`}
                    value={labelOf(ch)}
                    onChange={(e) => setWheelLabel(ch, e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: "#888" }}>读通道</span>
                  <Select
                    size="small"
                    style={{ width: 130 }}
                    value={ch}
                    onChange={(v) => setWheelChannel(gi, wi, v)}
                    options={channelOptions}
                  />
                  <Tooltip title="删除这个轮子">
                    <Button
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() => removeWheel(gi, wi)}
                    />
                  </Tooltip>
                </div>
              ))}
              <div>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => addWheel(gi)}
                >
                  加轮子
                </Button>
              </div>
            </div>
          </Card>
        ))}

        <Button icon={<PlusOutlined />} onClick={addGroup} block>
          加轮组
        </Button>
        {draft.groups.length === 0 && (
          <div style={{ fontSize: 12, color: "#999", textAlign: "center" }}>
            还没有轮组：用上面的预设，或点「加轮组」从空配置开始
          </div>
        )}
      </Space>
    </Modal>
  );
}
