import { invoke } from "@tauri-apps/api/core";

export const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface PortItem {
  name: string;
  description: string;
}

export async function listPorts(): Promise<PortItem[]> {
  if (!isTauri()) return [];
  return invoke<PortItem[]>("list_ports");
}

export async function connectSerial(portName: string): Promise<void> {
  return invoke("connect_serial", { portName });
}

export async function disconnectSerial(): Promise<void> {
  if (!isTauri()) return;
  return invoke("disconnect_serial");
}

export async function connectWaveSerial(
  portName: string,
  baudRate: number
): Promise<void> {
  return invoke("connect_wave_serial", { portName, baudRate });
}

export async function disconnectWaveSerial(): Promise<void> {
  if (!isTauri()) return;
  return invoke("disconnect_wave_serial");
}

/** base64 → 字节数组（波形口事件载荷解码） */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function writeTextFile(
  path: string,
  contents: string
): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export async function writeBinaryFile(
  path: string,
  base64Data: string
): Promise<void> {
  return invoke("write_binary_file", { path, base64Data });
}

export async function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

/** 会话文件路径（Rust 侧会确保应用数据目录存在） */
export async function sessionFilePath(): Promise<string> {
  return invoke("session_file_path");
}

export async function sessionFileExists(path: string): Promise<boolean> {
  return invoke("session_file_exists", { path });
}
