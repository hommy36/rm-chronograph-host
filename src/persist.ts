/**
 * 会话持久化: 把分组测试数据（含每发波形快照）存成单个 JSON 文件,
 * 重启自动载入, 支持导出/导入 .rmtest 项目文件。
 * 波形按 Float32Array → base64 存储（每点固定 4 字节, 高精度数据比 JSON 数字小 2~3 倍）。
 */
import type {
  DispersionData,
  Group,
  GroupParams,
  Shot,
  TestSession,
  WaveConfig,
} from "./types";
import type { WaveSnapshot } from "./wave";

export const SESSION_VERSION = 2;
export const SESSION_FILE = "session.json";
export const PROJECT_EXT = "rmtest";

/** Float32 数组 → base64（小端字节序） */
export function f32ToBase64(values: number[]): string {
  const f = new Float32Array(values);
  const u8 = new Uint8Array(f.buffer);
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → number[]（还原为 Float32 精度） */
export function base64ToF32(b64: string): number[] {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  // 长度不是 4 的倍数说明文件损坏
  if (u8.length % 4 !== 0) throw new Error("波形数据长度非法");
  return Array.from(new Float32Array(u8.buffer));
}

interface SerializedSnapshot {
  t0: number;
  /** 相对 t0 的毫秒时间轴 */
  times: number[];
  /** 每通道 base64 的 float32 数据 */
  channels: string[];
}

interface SerializedShot {
  idx: number;
  speed_mps: number;
  dt_us: number;
  at_ms: number;
  wave?: SerializedSnapshot;
}

interface SerializedGroup {
  id: number;
  testId: number;
  name: string;
  params: GroupParams;
  startedAt: number;
  shots: SerializedShot[];
  /** 散布分析数据（含压缩后的靶纸图片 dataURL），原样存 */
  dispersion?: DispersionData;
  /** 该组的波形通道分配 */
  waveConfig?: WaveConfig;
}

export interface SessionFile {
  version: number;
  savedAt: number;
  /** 测试（一次实验）；旧文件没有这个字段，读取时自动迁移 */
  tests: TestSession[];
  nextTestId: number;
  nextGroupId: number;
  targetShots: number;
  waveConfig: WaveConfig;
  groups: SerializedGroup[];
}

export function serializeSession(s: {
  tests: TestSession[];
  groups: Group[];
  nextTestId: number;
  nextGroupId: number;
  targetShots: number;
  waveConfig: WaveConfig;
}): SessionFile {
  return {
    version: SESSION_VERSION,
    savedAt: Date.now(),
    tests: s.tests.map((t) => ({ ...t })),
    nextTestId: s.nextTestId,
    nextGroupId: s.nextGroupId,
    targetShots: s.targetShots,
    waveConfig: s.waveConfig,
    groups: s.groups.map((g) => ({
      id: g.id,
      testId: g.testId,
      name: g.name,
      params: { ...g.params },
      startedAt: g.startedAt,
      waveConfig: g.waveConfig,
      dispersion: g.dispersion ? { ...g.dispersion, points: [...g.dispersion.points], texts: [...g.dispersion.texts] } : undefined,
      shots: g.shots.map((shot) => {
        const out: SerializedShot = {
          idx: shot.idx,
          speed_mps: shot.speed_mps,
          dt_us: shot.dt_us,
          at_ms: shot.at_ms,
        };
        if (shot.wave) {
          out.wave = {
            t0: shot.wave.t0,
            times: shot.wave.times,
            channels: shot.wave.channels.map(f32ToBase64),
          };
        }
        return out;
      }),
    })),
  };
}

export function deserializeSession(text: string): {
  tests: TestSession[];
  groups: Group[];
  nextTestId: number;
  nextGroupId: number;
  targetShots: number;
  waveConfig: WaveConfig;
  savedAt: number;
} {
  const raw = JSON.parse(text) as SessionFile;
  if (!raw || !Array.isArray(raw.groups)) {
    throw new Error("文件格式无法识别");
  }
  // 旧格式（version 1，没有 tests）自动迁移成一个测试
  let tests: TestSession[] = Array.isArray(raw.tests) ? raw.tests : [];
  if (tests.length === 0) {
    const earliest = raw.groups.reduce(
      (min, g) => (g.startedAt && (min === 0 || g.startedAt < min) ? g.startedAt : min),
      0
    );
    tests = [
      {
        id: 1,
        name: "第一次测试",
        createdAt: earliest || Date.now(),
        startedAt: earliest,
      },
    ];
  }
  const firstTestId = tests[0].id;
  const groups: Group[] = raw.groups.map((g) => ({
    id: g.id,
    testId: g.testId ?? firstTestId,
    name: g.name,
    params: { ...g.params },
    startedAt: g.startedAt,
    waveConfig: g.waveConfig,
    dispersion: g.dispersion
      ? ({
          ...g.dispersion,
          points: g.dispersion.points ?? [],
          texts: g.dispersion.texts ?? [],
        } as DispersionData)
      : undefined,
    shots: g.shots.map((shot): Shot => {
      const out: Shot = {
        idx: shot.idx,
        speed_mps: shot.speed_mps,
        dt_us: shot.dt_us,
        at_ms: shot.at_ms,
      };
      if (shot.wave) {
        const channels = shot.wave.channels.map(base64ToF32);
        const wave: WaveSnapshot = {
          t0: shot.wave.t0,
          times: Array.from(shot.wave.times),
          channels,
        };
        out.wave = wave;
      }
      return out;
    }),
  }));
  const maxId = groups.reduce((m, g) => Math.max(m, g.id), 0);
  const maxTestId = tests.reduce((m, t) => Math.max(m, t.id), 0);
  return {
    tests,
    groups,
    nextTestId: Math.max(raw.nextTestId ?? 0, maxTestId + 1),
    nextGroupId: Math.max(raw.nextGroupId ?? 0, maxId + 1),
    targetShots: raw.targetShots ?? 100,
    waveConfig: raw.waveConfig ?? { groups: [], channelLabels: {} },
    savedAt: raw.savedAt ?? 0,
  };
}

/**
 * 导入合并: 把新组追加到现有组之后, 组 id 重编号避免冲突。
 * 返回重编号后的组与新的 nextGroupId。
 */
export function mergeImported(
  existing: { tests: TestSession[]; groups: Group[] },
  incoming: { tests: TestSession[]; groups: Group[] },
  counters: { nextTestId: number; nextGroupId: number }
): {
  tests: TestSession[];
  groups: Group[];
  nextTestId: number;
  nextGroupId: number;
} {
  let nextTestId = counters.nextTestId;
  let nextGroupId = counters.nextGroupId;
  const tests: TestSession[] = [...existing.tests];
  const groups: Group[] = [...existing.groups];

  // 文件里没有测试信息时（旧格式），把全部来组整体包装成一个测试
  const legacy = incoming.tests.length === 0;
  const incomingTests: TestSession[] = legacy
    ? [
        {
          id: -1,
          name: "导入测试",
          createdAt: Date.now(),
          startedAt: incoming.groups[0]?.startedAt ?? Date.now(),
        },
      ]
    : incoming.tests;

  for (const t of incomingTests) {
    const newTestId = nextTestId++;
    const name = existing.tests.some((x) => x.name === t.name)
      ? `${t.name}(导入)`
      : t.name;
    tests.push({ ...t, id: newTestId, name });
    const mine = legacy
      ? incoming.groups
      : incoming.groups.filter((x) => x.testId === t.id);
    for (const g of mine) {
      groups.push({ ...g, id: nextGroupId++, testId: newTestId });
    }
  }
  return { tests, groups, nextTestId, nextGroupId };
}
