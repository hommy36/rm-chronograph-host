import { useEffect, useState } from "react";
import { Card } from "antd";
import { useAppStore } from "../store";

/** 实时弹速大卡片：最新一发速度、dt、距上一发时间 */
export default function LiveSpeedCard() {
  const latest = useAppStore((s) => s.latest);
  const online = useAppStore((s) => s.online);
  const connected = useAppStore((s) => s.connected);
  const [, force] = useState(0);

  // 每 200ms 刷新一次"距上一发"显示
  useEffect(() => {
    const t = window.setInterval(() => force((v) => v + 1), 200);
    return () => clearInterval(t);
  }, []);

  const agoMs = latest ? Date.now() - latest.at_ms : null;
  const color = !connected ? "#bbb" : online ? "#1677ff" : "#d4380d";

  return (
    <Card
      size="small"
      title="实时弹速"
      style={{ marginBottom: 12 }}
      data-tour="live-speed"
    >
      <div style={{ textAlign: "center", padding: "4px 0" }}>
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.1,
            color,
          }}
        >
          <span key={latest?.at_ms ?? 0} className="speed-pop">
            {latest ? latest.speed_mps.toFixed(3) : "--.---"}
          </span>
          <span style={{ fontSize: 18, fontWeight: 400, marginLeft: 6 }}>
            m/s
          </span>
        </div>
        <div style={{ color: "#888", marginTop: 8 }}>
          dt：{latest ? `${latest.dt_us} µs` : "--"} · 距上一发：
          {agoMs !== null ? `${(agoMs / 1000).toFixed(1)} s` : "--"}
        </div>
      </div>
    </Card>
  );
}
