import { useCallback, useEffect, useState } from "react";
import { Badge, Button, message, Select, Space, Switch, Tooltip } from "antd";
import { LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { connectSerial, disconnectSerial, isTauri, listPorts } from "../api";
import type { PortItem } from "../api";
import { useAppStore } from "../store";

export default function ConnectionBar(props: {
  demoOn: boolean;
  onToggleDemo: (on: boolean) => void;
}) {
  const { connected, portName, online, counters } = useAppStore();
  const [ports, setPorts] = useState<PortItem[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listPorts();
      setPorts(list);
      if (list.length > 0 && !list.some((p) => p.name === selected)) {
        setSelected(list[0].name);
      }
    } catch (e) {
      message.error(`枚举串口失败：${e}`);
    }
  }, [selected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await connectSerial(selected);
      useAppStore.getState().setConnected(selected, false);
    } catch (e) {
      message.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnectSerial();
    } finally {
      useAppStore.getState().markDisconnected();
      setBusy(false);
    }
  };

  const status = !connected ? (
    <Badge status="default" text="未连接" />
  ) : online ? (
    <Badge status="success" text="在线" />
  ) : (
    <Badge status="error" text="离线" />
  );

  return (
    <Space size="middle" wrap>
      <span style={{ fontWeight: 600, fontSize: 16 }}>测速模块上位机</span>
      <Select
        style={{ minWidth: 220 }}
        placeholder={isTauri() ? "选择串口" : "桌面 App 中可用"}
        value={selected}
        onChange={setSelected}
        disabled={connected || props.demoOn || !isTauri()}
        options={ports.map((p) => ({
          value: p.name,
          label: `${p.name}（${p.description}）`,
        }))}
        notFoundContent="未发现串口"
      />
      <Tooltip title="刷新串口列表">
        <Button
          icon={<ReloadOutlined />}
          onClick={refresh}
          disabled={connected || props.demoOn || !isTauri()}
        />
      </Tooltip>
      {connected && !props.demoOn ? (
        <Button danger onClick={handleDisconnect} loading={busy}>
          断开
        </Button>
      ) : (
        <Button
          type="primary"
          icon={<LinkOutlined />}
          onClick={handleConnect}
          loading={busy}
          disabled={!selected || props.demoOn || !isTauri()}
        >
          连接
        </Button>
      )}
      <Space size={4}>
        <span>模拟数据</span>
        <Switch
          checked={props.demoOn}
          onChange={props.onToggleDemo}
          disabled={connected && !props.demoOn}
        />
      </Space>
      {status}
      <span style={{ color: "#888" }}>
        帧 {counters.frames} · 心跳 {counters.heartbeats} · CRC错{" "}
        {counters.crcErrors}
        {portName ? ` · ${portName}` : ""}
      </span>
    </Space>
  );
}
