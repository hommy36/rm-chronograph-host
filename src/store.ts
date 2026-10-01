import { create } from "zustand";
import type { DispersionData, Group, GroupParams, Shot, SpeedFrameMsg, WaveConfig } from "./types";
import { EMPTY_PARAMS, EMPTY_WAVE_CONFIG } from "./types";
import { JustFloatParser } from "./justfloat";
import { SNAP_POST_MS, takeSnapshot, WaveBuffer } from "./wave";
import { mergeImported } from "./persist";

/** 连续 500 ms 无有效心跳/数据帧判离线（协议 §3） */
export const OFFLINE_TIMEOUT_MS = 500;
/** 目标发数默认值（TJSP 文档：每组至少 100 发） */
export const DEFAULT_TARGET_SHOTS = 100;

/** 波形环形缓冲单例：1kHz 采样可回溯 120 s。放 store 外避免高频 set 触发渲染 */
export const waveBuffer = new WaveBuffer(120000);
/** 真实链路的 JustFloat 解析器单例 */
const waveParser = new JustFloatParser();

/** 等待补全波形快照的发 */
interface PendingCapture {
  groupId: number;
  shotIdx: number;
  t0: number;
}
let pendingCaptures: PendingCapture[] = [];
/** 自上次 tick 以来新到的波形帧数（用于状态栏低频展示） */
let waveFramesSinceTick = 0;
/** 波形计数上次刷新时间（限 1Hz） */
let lastWaveFlushMs = 0;

const WAVE_CONFIG_KEY = "rm-chrono-wave-config";

function loadWaveConfig(): WaveConfig {
  try {
    const raw = localStorage.getItem(WAVE_CONFIG_KEY);
    if (!raw) return { ...EMPTY_WAVE_CONFIG };
    const parsed = JSON.parse(raw) as WaveConfig;
    if (!parsed || !Array.isArray(parsed.groups)) return { ...EMPTY_WAVE_CONFIG };
    return { groups: parsed.groups, channelLabels: parsed.channelLabels ?? {} };
  } catch {
    return { ...EMPTY_WAVE_CONFIG };
  }
}

interface Counters {
  frames: number;
  heartbeats: number;
  crcErrors: number;
}

interface AppState {
  connected: boolean;
  /** 真实串口名；模拟数据模式为 null */
  portName: string | null;
  demoMode: boolean;
  online: boolean;
  /** 最近一次心跳/数据帧时间（本地 ms），0 表示未收到 */
  lastEventAt: number;
  counters: Counters;
  latest: SpeedFrameMsg | null;
  groups: Group[];
  /** 正在记录的组 */
  activeGroupId: number | null;
  /** 界面正在查看的组 */
  viewingGroupId: number | null;
  nextGroupId: number;
  /** 目标发数：仅用于进度显示与达标提醒，不写入导出文件 */
  targetShots: number;
  /** 勾选用于对比的组 id（最多 2 个） */
  compareIds: number[];

  /** 波形口（VOFA+ JustFloat）连接状态 */
  waveConnected: boolean;
  wavePortName: string | null;
  /** 自适应识别到的通道数，0 = 未收到 */
  waveChannelCount: number;
  /** 波形帧累计计数（tick 时刷新，低频展示用） */
  waveFrames: number;
  waveConfig: WaveConfig;

  setConnected: (portName: string | null, demo: boolean) => void;
  markDisconnected: () => void;
  onHeartbeat: (atMs: number) => void;
  onFrame: (msg: SpeedFrameMsg) => void;
  onCrcError: () => void;
  /** 看门狗：由定时器周期调用 */
  tick: (nowMs: number) => void;
  startGroup: (params: GroupParams) => void;
  endGroup: () => void;
  setViewingGroup: (id: number) => void;
  setTargetShots: (n: number) => void;
  clearAll: () => void;

  setWaveConnected: (portName: string | null) => void;
  /** 喂入波形口原始字节（真实串口事件 / 模拟器共用） */
  onWaveBytes: (atMs: number, bytes: ArrayLike<number>) => void;
  setWaveConfig: (cfg: WaveConfig) => void;
  /** 勾选/取消勾选对比组（最多 2 个，超出时挤掉最早的） */
  toggleCompare: (groupId: number) => void;
  clearCompare: () => void;
  /** 从持久化数据恢复（启动载入 / 导入合并） */
  hydrate: (data: {
    groups: Group[];
    nextGroupId: number;
    targetShots: number;
    waveConfig: WaveConfig;
    merge?: boolean;
  }) => void;
  /** 清理历史波形快照（保留指标可导出的弹速数据），释放磁盘/内存 */
  clearWaveforms: () => void;
  /** 删除单个组（含其弹速与波形数据） */
  deleteGroup: (id: number) => void;
  /** 写入/清空某组的散布分析数据 */
  setGroupDispersion: (id: number, data: DispersionData | undefined) => void;
  /** 写入某组的波形通道分配（随组保存） */
  setGroupWaveConfig: (id: number, cfg: WaveConfig) => void;
}

function makeGroup(id: number, name: string, params: GroupParams): Group {
  return { id, name, params, startedAt: Date.now(), shots: [] };
}

export const useAppStore = create<AppState>((set, get) => ({
  connected: false,
  portName: null,
  demoMode: false,
  online: false,
  lastEventAt: 0,
  counters: { frames: 0, heartbeats: 0, crcErrors: 0 },
  latest: null,
  groups: [],
  activeGroupId: null,
  viewingGroupId: null,
  nextGroupId: 1,
  targetShots: DEFAULT_TARGET_SHOTS,
  compareIds: [],
  waveConnected: false,
  wavePortName: null,
  waveChannelCount: 0,
  waveFrames: 0,
  waveConfig: loadWaveConfig(),

  setConnected: (portName, demo) =>
    set({
      connected: true,
      portName,
      demoMode: demo,
      online: false,
      lastEventAt: 0,
      counters: { frames: 0, heartbeats: 0, crcErrors: 0 },
      latest: null,
    }),

  markDisconnected: () =>
    set({ connected: false, portName: null, demoMode: false, online: false }),

  onHeartbeat: (atMs) =>
    set((s) => ({
      lastEventAt: atMs,
      online: true,
      counters: { ...s.counters, heartbeats: s.counters.heartbeats + 1 },
    })),

  onFrame: (msg) =>
    set((s) => {
      let { groups, activeGroupId, viewingGroupId, nextGroupId } = s;
      // 仅在"一个组都没有"时自动创建"未分组"兜底，保证新手不丢数据；
      // 一旦用户结束过组别（存在历史组），未开组的帧只实时显示、不记录，
      // 避免两组测试之间产生垃圾组。
      if (activeGroupId === null && groups.length === 0) {
        const g = makeGroup(nextGroupId, "未分组", { ...EMPTY_PARAMS });
        groups = [...groups, g];
        activeGroupId = g.id;
        viewingGroupId = g.id;
        nextGroupId += 1;
      }
      if (activeGroupId !== null) {
        groups = groups.map((g) => {
          if (g.id !== activeGroupId) return g;
          const shot: Shot = {
            idx: g.shots.length + 1,
            speed_mps: msg.speed_mps,
            dt_us: msg.dt_us,
            at_ms: msg.at_ms,
          };
          // 波形口已连接：登记快照补全，等缓冲攒够窗口数据后由 tick 挂到这一发上
          if (s.waveConnected) {
            pendingCaptures.push({
              groupId: g.id,
              shotIdx: shot.idx,
              t0: msg.at_ms,
            });
          }
          return { ...g, shots: [...g.shots, shot] };
        });
      }
      return {
        groups,
        activeGroupId,
        viewingGroupId,
        nextGroupId,
        latest: msg,
        lastEventAt: msg.at_ms,
        online: true,
        counters: { ...s.counters, frames: s.counters.frames + 1 },
      };
    }),

  onCrcError: () =>
    set((s) => ({
      // CRC 错误的帧直接丢弃，不计为有效数据，也不刷新在线时间（协议 §3/§7）
      counters: { ...s.counters, crcErrors: s.counters.crcErrors + 1 },
    })),

  tick: (nowMs) => {
    const s = get();
    if (s.connected) {
      const online =
        s.lastEventAt !== 0 && nowMs - s.lastEventAt <= OFFLINE_TIMEOUT_MS;
      if (online !== s.online) set({ online });
    }
    // 低频刷新波形帧计数 / 通道数（最多 1Hz，避免高频重渲染）
    if (
      (waveFramesSinceTick > 0 && nowMs - lastWaveFlushMs >= 1000) ||
      s.waveChannelCount !== waveBuffer.channelCount
    ) {
      lastWaveFlushMs = nowMs;
      set({
        waveFrames: s.waveFrames + waveFramesSinceTick,
        waveChannelCount: waveBuffer.channelCount,
      });
      waveFramesSinceTick = 0;
    }
    // 补全到期的波形快照：缓冲已覆盖窗口末尾，或发射已过去足够久（数据不足也收尾，避免泄漏）
    if (pendingCaptures.length > 0) {
      const ready = pendingCaptures.filter(
        (p) =>
          waveBuffer.latestAt() >= p.t0 + SNAP_POST_MS ||
          nowMs > p.t0 + SNAP_POST_MS + 800
      );
      if (ready.length > 0) {
        pendingCaptures = pendingCaptures.filter((p) => !ready.includes(p));
        set((st) => ({
          groups: st.groups.map((g) => {
            const mine = ready.filter((p) => p.groupId === g.id);
            if (mine.length === 0) return g;
            return {
              ...g,
              shots: g.shots.map((shot) => {
                const p = mine.find((m) => m.shotIdx === shot.idx);
                if (!p) return shot;
                const snap = takeSnapshot(waveBuffer, p.t0);
                return snap ? { ...shot, wave: snap } : shot;
              }),
            };
          }),
        }));
      }
    }
  },

  startGroup: (params) =>
    set((s) => {
      const g = makeGroup(s.nextGroupId, `组${s.nextGroupId}`, params);
      return {
        groups: [...s.groups, g],
        activeGroupId: g.id,
        viewingGroupId: g.id,
        nextGroupId: s.nextGroupId + 1,
      };
    }),

  endGroup: () => set({ activeGroupId: null }),

  setViewingGroup: (id) => set({ viewingGroupId: id }),

  setTargetShots: (n) =>
    set({ targetShots: Math.max(1, Math.floor(n) || DEFAULT_TARGET_SHOTS) }),

  clearAll: () => {
    pendingCaptures = [];
    set({
      groups: [],
      activeGroupId: null,
      viewingGroupId: null,
      nextGroupId: 1,
      latest: null,
      counters: { frames: 0, heartbeats: 0, crcErrors: 0 },
    });
  },

  setWaveConnected: (portName) => {
    if (portName === null) {
      waveBuffer.clear();
      pendingCaptures = [];
      waveFramesSinceTick = 0;
      set({
        waveConnected: false,
        wavePortName: null,
        waveChannelCount: 0,
        waveFrames: 0,
      });
    } else {
      waveBuffer.clear();
      waveFramesSinceTick = 0;
      set({
        waveConnected: true,
        wavePortName: portName,
        waveChannelCount: 0,
        waveFrames: 0,
      });
    }
  },

  onWaveBytes: (atMs, bytes) => {
    for (const frame of waveParser.feed(bytes)) {
      waveBuffer.push(atMs, frame.channels);
      waveFramesSinceTick++;
    }
  },

  setWaveConfig: (cfg) => {
    try {
      localStorage.setItem(WAVE_CONFIG_KEY, JSON.stringify(cfg));
    } catch {
      // 存储失败不影响运行
    }
    set({ waveConfig: cfg });
  },

  toggleCompare: (groupId) =>
    set((s) => {
      if (s.compareIds.includes(groupId)) {
        return { compareIds: s.compareIds.filter((id) => id !== groupId) };
      }
      const next = [...s.compareIds, groupId];
      return { compareIds: next.slice(-2) };
    }),

  clearCompare: () => set({ compareIds: [] }),

  hydrate: (data) =>
    set((s) => {
      if (!data.merge) {
        return {
          groups: data.groups,
          nextGroupId: data.nextGroupId,
          targetShots: data.targetShots,
          waveConfig: data.waveConfig,
          viewingGroupId: data.groups.length > 0 ? data.groups[0].id : null,
          activeGroupId: null,
          compareIds: [],
        };
      }
      const merged = mergeImported(s.groups, data.groups, s.nextGroupId);
      return {
        groups: merged.groups,
        nextGroupId: merged.nextGroupId,
      };
    }),

  clearWaveforms: () =>
    set((s) => ({
      groups: s.groups.map((g) => ({
        ...g,
        shots: g.shots.map((shot) =>
          shot.wave ? { ...shot, wave: undefined } : shot
        ),
      })),
    })),

  deleteGroup: (id) =>
    set((s) => {
      pendingCaptures = pendingCaptures.filter((p) => p.groupId !== id);
      const groups = s.groups.filter((g) => g.id !== id);
      return {
        groups,
        activeGroupId: s.activeGroupId === id ? null : s.activeGroupId,
        viewingGroupId:
          s.viewingGroupId === id
            ? groups.length > 0
              ? groups[groups.length - 1].id
              : null
            : s.viewingGroupId,
        compareIds: s.compareIds.filter((x) => x !== id),
      };
    }),

  setGroupDispersion: (id, data) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, dispersion: data } : g)),
    })),

  setGroupWaveConfig: (id, cfg) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, waveConfig: cfg } : g)),
    })),
}));
