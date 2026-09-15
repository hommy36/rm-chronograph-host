import { create } from "zustand";
import type { Group, GroupParams, Shot, SpeedFrameMsg } from "./types";
import { EMPTY_PARAMS } from "./types";

/** 连续 500 ms 无有效心跳/数据帧判离线（协议 §3） */
export const OFFLINE_TIMEOUT_MS = 500;
/** 目标发数默认值（TJSP 文档：每组至少 100 发） */
export const DEFAULT_TARGET_SHOTS = 100;

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
    if (!s.connected) return;
    const online = s.lastEventAt !== 0 && nowMs - s.lastEventAt <= OFFLINE_TIMEOUT_MS;
    if (online !== s.online) set({ online });
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

  clearAll: () =>
    set({
      groups: [],
      activeGroupId: null,
      viewingGroupId: null,
      nextGroupId: 1,
      latest: null,
      counters: { frames: 0, heartbeats: 0, crcErrors: 0 },
    }),
}));
