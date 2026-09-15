import type { SpeedFrameMsg } from "./types";
import {
  buildFrame,
  HEARTBEAT_BYTE,
  ProtocolParser,
} from "./protocol_ts";

export interface SimulatorCallbacks {
  onHeartbeat: (atMs: number) => void;
  onFrame: (msg: SpeedFrameMsg) => void;
  onCrcError: () => void;
}

/**
 * 模拟数据源：无硬件时演示/自检用。
 * 合成符合协议的字节流（含心跳、测速帧、偶发垃圾字节），
 * 并走与真实链路同款的协议解析状态机。
 */
export class Simulator {
  private heartbeatTimer: number | null = null;
  private shotTimer: number | null = null;
  private parser = new ProtocolParser();
  private baseSpeed = 15.8;

  constructor(private cbs: SimulatorCallbacks) {}

  start() {
    this.stop();
    this.parser = new ProtocolParser();
    // 心跳：约每 100 ms 一次（协议 §3）
    this.heartbeatTimer = window.setInterval(() => {
      this.pump([HEARTBEAT_BYTE]);
    }, 100);

    const shoot = () => {
      // 弹速在基准值附近缓漂 + 抖动，模拟真实测试
      this.baseSpeed += (Math.random() - 0.5) * 0.02;
      const speed = this.baseSpeed + (Math.random() - 0.5) * 0.25;
      const speedMilli = Math.max(1, Math.round(speed * 1000));
      // 与固件一致：50 mm 光电门间距整数公式
      const dtUs = Math.floor(50_000_000 / speedMilli);
      const frame = buildFrame(speedMilli, dtUs);
      const bytes =
        Math.random() < 0.05 ? [0x00, 0x7e, ...frame] : frame; // 偶发噪声字节
      this.pump(bytes);
      this.shotTimer = window.setTimeout(shoot, 600 + Math.random() * 900);
    };
    this.shotTimer = window.setTimeout(shoot, 800);
  }

  stop() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.shotTimer !== null) {
      clearTimeout(this.shotTimer);
      this.shotTimer = null;
    }
  }

  private pump(bytes: number[]) {
    for (const ev of this.parser.feedSlice(bytes)) {
      const at = Date.now();
      if (ev.kind === "heartbeat") {
        this.cbs.onHeartbeat(at);
      } else if (ev.kind === "frame") {
        this.cbs.onFrame({
          speed_mps: ev.frame.speedMilliMps / 1000,
          speed_milli_mps: ev.frame.speedMilliMps,
          dt_us: ev.frame.dtUs,
          at_ms: at,
        });
      } else {
        this.cbs.onCrcError();
      }
    }
  }
}
