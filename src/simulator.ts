import type { SpeedFrameMsg } from "./types";
import {
  buildFrame,
  HEARTBEAT_BYTE,
  ProtocolParser,
} from "./protocol_ts";
import { buildJustFloatFrame } from "./justfloat";

export interface SimulatorCallbacks {
  onHeartbeat: (atMs: number) => void;
  onFrame: (msg: SpeedFrameMsg) => void;
  onCrcError: () => void;
  /** 波形口字节流（JustFloat） */
  onWaveBytes: (atMs: number, bytes: number[]) => void;
}

/** 模拟的波形参数：双级六摩擦轮 3+3 */
const WAVE_CHANNELS = 6;
const WAVE_BASE_RPM = [4500, 4500, 4500, 4800, 4800, 4800];
/** 一级 / 二级掉速深度（额定百分比） */
const DIP_DEPTH = [0.08, 0.08, 0.08, 0.05, 0.05, 0.05];
const DIP_TAU_MS = 120;
/** 波形采样间隔 ms（≈200Hz） */
const WAVE_DT_MS = 5;

/**
 * 模拟数据源：无硬件时演示/自检用。
 * 合成符合协议的字节流（含心跳、测速帧、偶发垃圾字节），
 * 并走与真实链路同款的协议解析状态机；
 * 同时合成 JustFloat 摩擦轮转速波形，发射瞬间带掉速/恢复过程。
 */
export class Simulator {
  private heartbeatTimer: number | null = null;
  private shotTimer: number | null = null;
  private waveTimer: number | null = null;
  private parser = new ProtocolParser();
  private baseSpeed = 15.8;
  /** 进行中的掉速事件（发射时刻列表） */
  private dips: number[] = [];

  constructor(private cbs: SimulatorCallbacks) {}

  start() {
    this.stop();
    this.parser = new ProtocolParser();
    this.dips = [];
    // 心跳：约每 100 ms 一次（协议 §3）
    this.heartbeatTimer = window.setInterval(() => {
      this.pump([HEARTBEAT_BYTE]);
    }, 100);

    // 波形：每 25 ms 批量补发采样点
    let nextWaveAt = Date.now();
    this.waveTimer = window.setInterval(() => {
      const now = Date.now();
      const bytes: number[] = [];
      while (nextWaveAt <= now) {
        bytes.push(...buildJustFloatFrame(this.waveSample(nextWaveAt)));
        nextWaveAt += WAVE_DT_MS;
      }
      if (bytes.length > 0) this.cbs.onWaveBytes(now, bytes);
    }, 25);

    const shoot = () => {
      const at = Date.now();
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
      // 发射瞬间触发摩擦轮掉速
      this.dips.push(at);
      if (this.dips.length > 8) this.dips.shift();
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
    if (this.waveTimer !== null) {
      clearInterval(this.waveTimer);
      this.waveTimer = null;
    }
  }

  /** 某时刻各通道转速：基线 + 噪声 + 所有进行中的掉速叠加 */
  private waveSample(tMs: number): number[] {
    const out: number[] = [];
    for (let ch = 0; ch < WAVE_CHANNELS; ch++) {
      const base = WAVE_BASE_RPM[ch];
      let v = base + (Math.random() - 0.5) * base * 0.01;
      for (const t0 of this.dips) {
        const t = tMs - t0;
        if (t >= 0) {
          const x = t / DIP_TAU_MS;
          v -= base * DIP_DEPTH[ch] * x * Math.exp(1 - x);
        }
      }
      out.push(v);
    }
    return out;
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
