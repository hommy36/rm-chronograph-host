import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Divider, message, Select, Space, Switch, Tooltip } from "antd";
import { LinkOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import {
  connectSerial,
  connectWaveSerial,
  disconnectSerial,
  disconnectWaveSerial,
  isTauri,
  listPorts,
} from "../api";
import type { PortItem } from "../api";
import { useAppStore } from "../store";
import WaveSettingsModal from "./WaveSettingsModal";

/** 波形口可选波特率（测速口协议固定 115200，不可调） */
const WAVE_BAUDS = [9600, 57600, 115200, 230400, 460800, 921600, 1000000, 2000000];
const WAVE_BAUD_KEY = "rm-chrono-wave-baud";

function loadWaveBaud(): number {
  const v = Number(localStorage.getItem(WAVE_BAUD_KEY));
  return WAVE_BAUDS.includes(v) ? v : 115200;
}

export default function ConnectionBar(props: {
  demoOn: boolean;
  onToggleDemo: (on: boolean) => void;
}) {
  const connected = useAppStore((s) => s.connected);
  const portName = useAppStore((s) => s.portName);
  const online = useAppStore((s) => s.online);
  const waveConnected = useAppStore((s) => s.waveConnected);
  const wavePortName = useAppStore((s) => s.wavePortName);
  const waveChannelCount = useAppStore((s) => s.waveChannelCount);
  const waveFrames = useAppStore((s) => s.waveFrames);
  const [ports, setPorts] = useState<PortItem[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [waveSelected, setWaveSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [waveBusy, setWaveBusy] = useState(false);
  const [waveBaud, setWaveBaud] = useState<number>(loadWaveBaud);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 帧/心跳/CRC 计数低频轮询显示（500ms），避免 10Hz 心跳驱动顶栏重渲染 */
  const [counters, setCounters] = useState(() => useAppStore.getState().counters);
  useEffect(() => {
    const t = window.setInterval(
      () => setCounters(useAppStore.getState().counters),
      500
    );
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await listPorts();
      setPorts(list);
      if (list.length > 0 && !list.some((p) => p.name === selected)) {
        setSelected(list[0].name);
      }
      if (list.length > 0 && !list.some((p) => p.name === waveSelected)) {
        setWaveSelected(list[0].name);
      }
    } catch (e) {
      message.error(`枚举串口失败：${e}`);
    }
  }, [selected, waveSelected]);

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

  const handleWaveConnect = async () => {
    if (!waveSelected) return;
    setWaveBusy(true);
    try {
      await connectWaveSerial(waveSelected, waveBaud);
      useAppStore.getState().setWaveConnected(waveSelected);
    } catch (e) {
      message.error(String(e));
    } finally {
      setWaveBusy(false);
    }
  };

  const handleWaveDisconnect = async () => {
    setWaveBusy(true);
    try {
      await disconnectWaveSerial();
    } finally {
      useAppStore.getState().setWaveConnected(null);
      setWaveBusy(false);
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
    <Space size={8} wrap={false} style={{ maxWidth: "100%", overflow: "hidden" }}>
      <span style={{ fontWeight: 600, fontSize: 16, whiteSpace: "nowrap" }}>
        测速模块上位机
      </span>
      <Select
        style={{ width: 190 }}
        placeholder={isTauri() ? "测速口" : "桌面 App 中可用"}
        value={selected}
        onChange={setSelected}
        disabled={connected || props.demoOn || !isTauri()}
        options={ports.map((p) => ({
          value: p.name,
          label: `${p.name}（${p.description}）`,
          disabled: p.name === wavePortName,
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
      <Space size={4} style={{ whiteSpace: "nowrap" }}>
        <span>模拟数据</span>
        <Switch
          checked={props.demoOn}
          onChange={props.onToggleDemo}
          disabled={connected && !props.demoOn}
        />
      </Space>
      <span style={{ whiteSpace: "nowrap" }}>{status}</span>
      <Tooltip
        title={`数据帧 ${counters.frames} · 心跳 ${counters.heartbeats} · CRC校验失败 ${counters.crcErrors}${portName ? ` · ${portName}` : ""}`}
      >
        <span style={{ color: "#888", whiteSpace: "nowrap", cursor: "default" }}>
          帧{counters.frames}·跳{counters.heartbeats}·CRC{counters.crcErrors}
        </span>
      </Tooltip>
      <Divider type="vertical" />
      <Select
        style={{ width: 190 }}
        placeholder={isTauri() ? "波形口 (JustFloat)" : "桌面 App 中可用"}
        value={waveSelected}
        onChange={setWaveSelected}
        disabled={waveConnected || !isTauri()}
        options={ports.map((p) => ({
          value: p.name,
          label: `${p.name}（${p.description}）`,
          disabled: p.name === portName,
        }))}
        notFoundContent="未发现串口"
      />
      <Tooltip title="波形口波特率">
        <Select
          style={{ width: 104 }}
          value={waveBaud}
          onChange={(v) => {
            setWaveBaud(v);
            try {
              localStorage.setItem(WAVE_BAUD_KEY, String(v));
            } catch {
              // 忽略持久化失败
            }
          }}
          disabled={waveConnected || !isTauri()}
          options={WAVE_BAUDS.map((b) => ({ value: b, label: String(b) }))}
        />
      </Tooltip>
      {waveConnected ? (
        <Button danger onClick={handleWaveDisconnect} loading={waveBusy}>
          断开
        </Button>
      ) : (
        <Tooltip title="连接波形口（VOFA+ JustFloat 摩擦轮转速）">
          <Button
            icon={<LinkOutlined />}
            onClick={handleWaveConnect}
            loading={waveBusy}
            disabled={!waveSelected || !isTauri()}
          >
            连接
          </Button>
        </Tooltip>
      )}
      <Tooltip title="波形通道设置（通道→摩擦轮组）">
        <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} />
      </Tooltip>
      {waveConnected && (
        <Tooltip title={`波形通道数 ${waveChannelCount} · 波形帧 ${waveFrames}${wavePortName ? ` · ${wavePortName}` : ""}`}>
          <span style={{ color: "#888", whiteSpace: "nowrap", cursor: "default" }}>
            波{waveChannelCount}ch·{waveFrames}
          </span>
        </Tooltip>
      )}
      <WaveSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Space>
  );
}
