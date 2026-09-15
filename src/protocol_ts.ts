/**
 * 测速模块 USART1 协议解析（TS 版，与 src-tauri/src/protocol.rs 镜像）
 * 仅用于"模拟数据"链路：模拟器合成字节流后走同一解析状态机。
 */

export const HEARTBEAT_BYTE = 0x48;
export const FRAME_HEADER = 0x36;
export const FRAME_SIZE = 10;

/**
 * DJI/RoboMaster CRC8（与固件 CRC.c 查表法等价的位运算实现，LSB-first）：
 * 多项式 x8+x5+x4+1（0x31，反射形式 0x8C）、初值 0xFF、异或 0x00
 */
export function crc8Dji(data: ArrayLike<number>): number {
  let crc = 0xff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x01 ? ((crc >> 1) ^ 0x8c) & 0xff : (crc >> 1) & 0xff;
    }
  }
  return crc;
}

export interface SpeedFrame {
  /** 0.001 m/s */
  speedMilliMps: number;
  /** us */
  dtUs: number;
}

export type ParserEvent =
  | { kind: "heartbeat" }
  | { kind: "frame"; frame: SpeedFrame }
  | { kind: "crcError" };

/**
 * 字节流解析状态机（协议 §7）：
 * 空闲时逐字节扫描 0x48 / 0x36；识别到 0x36 后固定收满 10 字节，
 * 期间载荷中的 0x36 / 0x48 一律按普通载荷字节处理；收齐后校验 CRC8，
 * 不一致则整帧丢弃并重新搜索。
 */
export class ProtocolParser {
  private buf = new Uint8Array(FRAME_SIZE);
  private len = 0;

  feed(byte: number): ParserEvent | null {
    byte &= 0xff;
    if (this.len === 0) {
      if (byte === HEARTBEAT_BYTE) return { kind: "heartbeat" };
      if (byte === FRAME_HEADER) {
        this.buf[0] = byte;
        this.len = 1;
      }
      return null;
    }

    this.buf[this.len] = byte;
    this.len += 1;
    if (this.len < FRAME_SIZE) return null;

    this.len = 0;
    const crc = crc8Dji(this.buf.subarray(0, FRAME_SIZE - 1));
    if (crc !== this.buf[FRAME_SIZE - 1]) return { kind: "crcError" };

    const view = new DataView(this.buf.buffer);
    return {
      kind: "frame",
      frame: {
        speedMilliMps: view.getUint32(1, true),
        dtUs: view.getUint32(5, true),
      },
    };
  }

  feedSlice(data: ArrayLike<number>): ParserEvent[] {
    const events: ParserEvent[] = [];
    for (let i = 0; i < data.length; i++) {
      const ev = this.feed(data[i]);
      if (ev) events.push(ev);
    }
    return events;
  }
}

/** 构造数据帧（模拟数据源与测试用） */
export function buildFrame(speedMilliMps: number, dtUs: number): number[] {
  const frame = new Uint8Array(FRAME_SIZE);
  const view = new DataView(frame.buffer);
  frame[0] = FRAME_HEADER;
  view.setUint32(1, speedMilliMps >>> 0, true);
  view.setUint32(5, dtUs >>> 0, true);
  frame[9] = crc8Dji(frame.subarray(0, 9));
  return Array.from(frame);
}
