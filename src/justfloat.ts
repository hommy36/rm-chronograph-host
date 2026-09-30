/**
 * VOFA+ JustFloat 协议流式解析。
 * 帧格式: N 个 float32 小端通道 + 4 字节尾帧 0x00 0x00 0x80 0x7F。
 * 通道数自适应: 通道数 = (帧长 - 4) / 4, 运行中通道数变化时按最新帧为准。
 */

export const JUSTFLOAT_TAIL = [0x00, 0x00, 0x80, 0x7f] as const;

export interface JustFloatFrame {
  /** 各通道值, 长度即通道数 */
  channels: number[];
}

/** 把一串通道值打包成一帧 JustFloat 字节(测试/模拟器用) */
export function buildJustFloatFrame(channels: number[]): number[] {
  const buf = new ArrayBuffer(channels.length * 4 + 4);
  const dv = new DataView(buf);
  channels.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  dv.setUint8(channels.length * 4, JUSTFLOAT_TAIL[0]);
  dv.setUint8(channels.length * 4 + 1, JUSTFLOAT_TAIL[1]);
  dv.setUint8(channels.length * 4 + 2, JUSTFLOAT_TAIL[2]);
  dv.setUint8(channels.length * 4 + 3, JUSTFLOAT_TAIL[3]);
  return Array.from(new Uint8Array(buf));
}

/**
 * 增量解析器: 字节可任意分包喂入。
 * 策略: 扫描尾帧; 尾帧前的负载长度必须是 4 的倍数且 > 0, 否则视为噪声段,
 * 整段丢弃后从尾帧之后继续(下一帧即可恢复同步)。
 * 长时间见不到尾帧时限制缓冲上限, 防止垃圾流撑爆内存。
 */
export class JustFloatParser {
  private buf: number[] = [];
  /** 无尾帧时的缓冲上限: 超过后只保留末尾 3 字节(可能是尾帧前缀) */
  private static readonly MAX_PENDING = 4096;

  feed(bytes: ArrayLike<number>): JustFloatFrame[] {
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    const out: JustFloatFrame[] = [];
    for (;;) {
      const idx = this.findTail();
      if (idx < 0) {
        if (this.buf.length > JustFloatParser.MAX_PENDING) {
          this.buf = this.buf.slice(-3);
        }
        break;
      }
      const payloadLen = idx;
      if (payloadLen > 0 && payloadLen % 4 === 0) {
        const channels: number[] = [];
        const ab = new ArrayBuffer(payloadLen);
        const u8 = new Uint8Array(ab);
        for (let i = 0; i < payloadLen; i++) u8[i] = this.buf[i];
        const dv = new DataView(ab);
        for (let off = 0; off < payloadLen; off += 4) {
          channels.push(dv.getFloat32(off, true));
        }
        out.push({ channels });
      }
      // 负载不合法(长度不是 4 的倍数)则整段丢弃, 从尾帧之后继续
      this.buf = this.buf.slice(idx + 4);
    }
    return out;
  }

  private findTail(): number {
    const b = this.buf;
    for (let i = 0; i + 3 < b.length; i++) {
      if (
        b[i] === JUSTFLOAT_TAIL[0] &&
        b[i + 1] === JUSTFLOAT_TAIL[1] &&
        b[i + 2] === JUSTFLOAT_TAIL[2] &&
        b[i + 3] === JUSTFLOAT_TAIL[3]
      ) {
        return i;
      }
    }
    return -1;
  }
}
