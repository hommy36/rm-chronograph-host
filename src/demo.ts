/**
 * 内置示例数据：把随应用打包的 public/demo/demo-10-1.json 载入为一个独立测试，
 * 供第一次使用时体验功能。格式与 .rmtest 项目文件一致，走同一套解析与合并逻辑，
 * 不会覆盖或改写用户自己的数据。
 */
import { deserializeSession } from "./persist";
import { useAppStore } from "./store";
import type { Group, TestSession, WaveConfig } from "./types";

/** 示例数据的文件位置（相对前端根目录） */
export const DEMO_FILE = "demo/demo-10-1.json";
/** 示例测试的识别前缀 */
export const DEMO_TEST_PREFIX = "示例数据";

export interface DemoProject {
  tests: TestSession[];
  groups: Group[];
  nextTestId: number;
  nextGroupId: number;
  targetShots: number;
  waveConfig: WaveConfig;
}

/** 是否内置示例测试（按名字前缀识别，不额外占用数据字段） */
export function isDemoTest(t: { name: string }): boolean {
  return t.name.startsWith(DEMO_TEST_PREFIX);
}

/** 当前会话里的示例测试 id */
export function demoTestIds(tests: TestSession[]): number[] {
  return tests.filter(isDemoTest).map((t) => t.id);
}

/** 解析示例数据文件内容（抽成纯函数，方便测试） */
export function parseDemoProject(text: string): DemoProject {
  return deserializeSession(text);
}

/** 读取并解析内置示例数据 */
export async function loadDemoProject(): Promise<DemoProject> {
  const res = await fetch(`${import.meta.env.BASE_URL}${DEMO_FILE}`);
  if (!res.ok) throw new Error(`示例数据读取失败（HTTP ${res.status}）`);
  return parseDemoProject(await res.text());
}

/**
 * 并入当前会话：走导入合并逻辑，示例数据成为一个新的独立测试。
 * 返回新测试的 id（找不到时返回 null）。
 */
export function insertDemoProject(data: DemoProject): number | null {
  const before = new Set(useAppStore.getState().tests.map((t) => t.id));
  useAppStore.getState().hydrate({ ...data, merge: true });
  const added = useAppStore.getState().tests.filter((t) => !before.has(t.id));
  return added.length > 0 ? added[added.length - 1].id : null;
}

/** 载入并并入示例数据，返回新测试 id */
export async function addDemoProject(): Promise<number | null> {
  return insertDemoProject(await loadDemoProject());
}

/** 删除会话里所有示例测试（连同其下的组） */
export function removeDemoProject(): number {
  const ids = demoTestIds(useAppStore.getState().tests);
  ids.forEach((id) => useAppStore.getState().deleteTest(id));
  return ids.length;
}
