import { useEffect, useRef, useState } from "react";
import { Layout, message } from "antd";
import { listen } from "@tauri-apps/api/event";
import { isTauri, b64ToBytes } from "./api";
import { useAppStore } from "./store";
import { loadSession, saveSession } from "./sessionIO";
import { Simulator } from "./simulator";
import type { SpeedFrameMsg } from "./types";
import ConnectionBar from "./components/ConnectionBar";
import WindowControls from "./components/WindowControls";
import LiveSpeedCard from "./components/LiveSpeedCard";
import GroupPanel from "./components/GroupPanel";
import ChartsGrid from "./components/ChartsGrid";
import StatsCards from "./components/StatsCards";
import ShotsTable from "./components/ShotsTable";
import DispersionPanel from "./components/DispersionPanel";
import OverviewPanel from "./components/OverviewPanel";
import type { MainView } from "./types";
import "./App.css";

const { Header, Content } = Layout;

/** 订阅 Rust 端串口事件（真实串口链路） */
function useSerialEvents() {
  useEffect(() => {
    if (!isTauri()) return;
    const store = useAppStore;
    const unlistens = [
      listen<{ at_ms: number }>("proto://heartbeat", (e) =>
        store.getState().onHeartbeat(e.payload.at_ms)
      ),
      listen<SpeedFrameMsg>("proto://frame", (e) =>
        store.getState().onFrame(e.payload)
      ),
      listen("proto://crc_error", () => store.getState().onCrcError()),
      listen("proto://disconnected", () => {
        store.getState().markDisconnected();
      }),
      listen<{ at_ms: number; b64: string }>("wave://bytes", (e) =>
        store.getState().onWaveBytes(e.payload.at_ms, b64ToBytes(e.payload.b64))
      ),
      listen("wave://disconnected", () => {
        store.getState().setWaveConnected(null);
      }),
    ];
    return () => {
      unlistens.forEach((p) => p.then((u) => u()));
    };
  }, []);
}

/** 离线看门狗：周期检查距上次心跳/数据帧是否超 500 ms（协议 §3） */
function useOfflineWatchdog() {
  useEffect(() => {
    const t = window.setInterval(() => {
      useAppStore.getState().tick(Date.now());
    }, 200);
    return () => clearInterval(t);
  }, []);
}

/** 会话持久化：启动载入历史数据 + 变更后去抖 2s 自动落盘 */
function useSessionPersistence() {
  const [loadedInfo, setLoadedInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    (async () => {
      const data = await loadSession();
      if (!alive || !data || data.groups.length === 0) return;
      useAppStore.getState().hydrate(data);
      setLoadedInfo(
        `已载入 ${data.groups.length} 组历史数据（保存于 ${new Date(
          data.savedAt
        ).toLocaleString()}）`
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (loadedInfo) message.success(loadedInfo, 5);
  }, [loadedInfo]);

  useEffect(() => {
    if (!isTauri()) return;
    let dirty = false;
    let lastChangeAt = 0;
    let lastSaveAt = 0;
    const unsub = useAppStore.subscribe((s, prev) => {
      if (
        s.groups !== prev.groups ||
        s.waveConfig !== prev.waveConfig ||
        s.targetShots !== prev.targetShots
      ) {
        dirty = true;
        lastChangeAt = Date.now();
      }
    });
    // 数据静止 2s 即落盘; 连续记录中（打靶不停）最迟 15s 强存一次, 避免去抖被永久推迟
    const timer = window.setInterval(() => {
      if (!dirty) return;
      const now = Date.now();
      const idle = now - lastChangeAt >= 2000;
      const stale = now - lastSaveAt >= 15000;
      if (!idle && !stale) return;
      dirty = false;
      lastSaveAt = now;
      const st = useAppStore.getState();
      void saveSession({
        groups: st.groups,
        nextGroupId: st.nextGroupId,
        targetShots: st.targetShots,
        waveConfig: st.waveConfig,
      });
    }, 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);
}

/** 未落在投放区的拖放一律拦掉，避免 WebView 直接导航到被拖入的文件 */
function useGlobalDropGuard() {
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);
}

export default function App() {
  useSerialEvents();
  useOfflineWatchdog();
  useSessionPersistence();
  useGlobalDropGuard();

  const [demoOn, setDemoOn] = useState(false);
  const [view, setView] = useState<MainView>("charts");
  const simulatorRef = useRef<Simulator | null>(null);

  const toggleDemo = (on: boolean) => {
    const store = useAppStore.getState();
    if (on) {
      const sim = new Simulator({
        onHeartbeat: (at) => useAppStore.getState().onHeartbeat(at),
        onFrame: (msg) => useAppStore.getState().onFrame(msg),
        onCrcError: () => useAppStore.getState().onCrcError(),
        onWaveBytes: (at, bytes) => useAppStore.getState().onWaveBytes(at, bytes),
      });
      simulatorRef.current = sim;
      sim.start();
      store.setConnected(null, true);
      // 模拟模式下波形口随主链路一起"连接"
      if (!store.waveConnected) store.setWaveConnected("模拟");
      setDemoOn(true);
    } else {
      simulatorRef.current?.stop();
      simulatorRef.current = null;
      store.markDisconnected();
      if (store.wavePortName === "模拟") store.setWaveConnected(null);
      setDemoOn(false);
    }
  };

  // 卸载时停掉模拟器
  useEffect(() => {
    return () => simulatorRef.current?.stop();
  }, []);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          background: "#fff",
          borderBottom: "1px solid #f0f0f0",
          boxShadow: "0 1px 4px rgba(0,21,41,0.08)",
          zIndex: 1,
          height: "auto",
          padding: 0,
          lineHeight: "normal",
        }}
      >
        {/* 无边框窗口：左侧 data-tauri-drag-region 区域拖动窗口/双击最大化，
            右侧自定义窗口操作按钮 */}
        <div style={{ display: "flex", alignItems: "stretch", minHeight: 56 }}>
          <div
            data-tauri-drag-region
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              padding: "0 8px 0 16px",
            }}
          >
            <ConnectionBar demoOn={demoOn} onToggleDemo={toggleDemo} />
          </div>
          <WindowControls />
        </div>
      </Header>
      <Layout style={{ flexDirection: "row" }}>
        <div
          style={{
            width: 340,
            flexShrink: 0,
            minHeight: 0,
            background: "#f0f2f5",
            padding: "12px 6px 12px 12px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <LiveSpeedCard />
          <GroupPanel />
        </div>
        <Content
          style={{
            padding: "12px 12px 12px 6px",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="main-content-stack">
            <StatsCards view={view} onChangeView={setView} />
            <div className="charts-area">
              <ChartsGrid />
              {view === "details" && (
                <div className="details-overlay">
                  <ShotsTable />
                </div>
              )}
              {view === "dispersion" && (
                <div className="details-overlay">
                  <DispersionPanel onBack={() => setView("charts")} />
                </div>
              )}
              {view === "overview" && (
                <div className="details-overlay">
                  <OverviewPanel />
                </div>
              )}
            </div>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
