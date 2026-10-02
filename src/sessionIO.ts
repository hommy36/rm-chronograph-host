/** 会话读写: 自动保存到应用数据目录 + 项目文件导入/导出 */
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  isTauri,
  readTextFile,
  sessionFileExists,
  sessionFilePath,
  writeTextFile,
} from "./api";
import {
  deserializeSession,
  PROJECT_EXT,
  serializeSession,
  type SessionFile,
} from "./persist";
import type { Group, TestSession, WaveConfig } from "./types";

interface Snapshot {
  tests: TestSession[];
  groups: Group[];
  nextTestId: number;
  nextGroupId: number;
  targetShots: number;
  waveConfig: WaveConfig;
}

/** 内存缓存会话路径，避免每次自动保存都 invoke */
let cachedPath: string | null = null;

async function getSessionPath(): Promise<string | null> {
  if (!isTauri()) return null;
  if (cachedPath) return cachedPath;
  try {
    cachedPath = await sessionFilePath();
    return cachedPath;
  } catch {
    return null;
  }
}

/** 写入会话文件（静默失败，不打断测试流程） */
export async function saveSession(snap: Snapshot): Promise<boolean> {
  const path = await getSessionPath();
  if (!path) return false;
  try {
    await writeTextFile(path, JSON.stringify(serializeSession(snap)));
    return true;
  } catch {
    return false;
  }
}

/** 启动时载入会话；无文件或解析失败返回 null */
export async function loadSession(): Promise<
  (Snapshot & { savedAt: number }) | null
> {
  const path = await getSessionPath();
  if (!path) return null;
  try {
    if (!(await sessionFileExists(path))) return null;
    const text = await readTextFile(path);
    if (!text.trim()) return null;
    return deserializeSession(text);
  } catch {
    return null;
  }
}

/** 导出项目文件（.rmtest）；可只导出某个测试 */
export async function exportProject(
  snap: Snapshot,
  defaultName: string,
  onlyTestId?: number
): Promise<boolean> {
  const data: SessionFile = serializeSession(
    onlyTestId === undefined
      ? snap
      : {
          ...snap,
          tests: snap.tests.filter((t) => t.id === onlyTestId),
          groups: snap.groups.filter((g) => g.testId === onlyTestId),
        }
  );
  const json = JSON.stringify(data);
  if (isTauri()) {
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "RM 测试项目", extensions: [PROJECT_EXT] }],
    });
    if (!path) return false;
    await writeTextFile(path, json);
    return true;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** 选择并读取项目文件；取消返回 null */
export async function importProject(): Promise<
  (Snapshot & { savedAt: number }) | null
> {
  if (!isTauri()) return null;
  const picked = await open({
    multiple: false,
    filters: [{ name: "RM 测试项目", extensions: [PROJECT_EXT, "json"] }],
  });
  if (!picked || typeof picked !== "string") return null;
  const text = await readTextFile(picked);
  return deserializeSession(text);
}
