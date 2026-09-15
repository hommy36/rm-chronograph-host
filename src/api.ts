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
