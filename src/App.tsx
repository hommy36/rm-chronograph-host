import { useEffect, useRef, useState } from "react";
import { Layout } from "antd";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./api";
import { useAppStore } from "./store";
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

export default function App() {
  useSerialEvents();
  useOfflineWatchdog();

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
      });
      simulatorRef.current = sim;
      sim.start();
      store.setConnected(null, true);
      setDemoOn(true);
    } else {
      simulatorRef.current?.stop();
      simulatorRef.current = null;
      store.markDisconnected();
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
            padding: 12,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <LiveSpeedCard />
          <GroupPanel />
        </div>
        <Content
          style={{
            padding: 12,
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
            </div>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
