//! 测速模块 USART1 协议解析（与 USART1_PROTOCOL.md 及固件 main.c 对应）
//!
//! - 心跳：单字节 0x48，约 100 ms 一次
//! - 数据帧：固定 10 字节
//!   `0x36 | speed_milli_mps(u32 LE) | dt_us(u32 LE) | CRC8`
//! - CRC8：RoboMaster/DJI 查表算法（固件 Core/Src/CRC.c）
//!   多项式 x8+x5+x4+1（0x31，反射形式 0x8C）、初值 0xFF、异或 0x00，覆盖前 9 字节

pub const HEARTBEAT_BYTE: u8 = 0x48;
pub const FRAME_HEADER: u8 = 0x36;
pub const FRAME_SIZE: usize = 10;

/// DJI CRC8（与固件 CRC8_TAB 查表法等价的位运算实现，LSB-first）
pub fn crc8_dji(data: &[u8]) -> u8 {
    let mut crc: u8 = 0xff;
    for &byte in data {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x01 != 0 {
                (crc >> 1) ^ 0x8C
            } else {
                crc >> 1
            };
        }
    }
    crc
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpeedFrame {
    /// 速度，单位 0.001 m/s
    pub speed_milli_mps: u32,
    /// 两个光电门的时间差，单位 us
    pub dt_us: u32,
}

impl SpeedFrame {
    pub fn speed_mps(&self) -> f64 {
        self.speed_milli_mps as f64 / 1000.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParserEvent {
    Heartbeat,
    Frame(SpeedFrame),
    CrcError,
}

/// 字节流解析状态机（协议 §7）：
/// 空闲时逐字节扫描 0x48 / 0x36；识别到 0x36 后固定收满 10 字节，
/// 期间载荷中的 0x36 / 0x48 一律按普通载荷字节处理；收齐后校验 CRC8，
/// 不一致则整帧丢弃并重新搜索。
#[derive(Default)]
pub struct Parser {
    buf: [u8; FRAME_SIZE],
    len: usize,
}

impl Parser {
    pub fn new() -> Self {
        Self::default()
    }

    /// 喂入一个字节，最多产生一个事件
    pub fn feed(&mut self, byte: u8) -> Option<ParserEvent> {
        if self.len == 0 {
            match byte {
                HEARTBEAT_BYTE => return Some(ParserEvent::Heartbeat),
                FRAME_HEADER => {
                    self.buf[0] = byte;
                    self.len = 1;
                }
                _ => {} // 未识别字节直接丢弃
            }
            return None;
        }

        self.buf[self.len] = byte;
        self.len += 1;
        if self.len < FRAME_SIZE {
            return None;
        }

        self.len = 0;
        let crc = crc8_dji(&self.buf[..FRAME_SIZE - 1]);
        if crc != self.buf[FRAME_SIZE - 1] {
            return Some(ParserEvent::CrcError);
        }
        let speed_milli_mps = u32::from_le_bytes([
            self.buf[1], self.buf[2], self.buf[3], self.buf[4],
        ]);
        let dt_us = u32::from_le_bytes([
            self.buf[5], self.buf[6], self.buf[7], self.buf[8],
        ]);
        Some(ParserEvent::Frame(SpeedFrame {
            speed_milli_mps,
            dt_us,
        }))
    }

    pub fn feed_slice(&mut self, data: &[u8]) -> Vec<ParserEvent> {
        data.iter().filter_map(|&b| self.feed(b)).collect()
    }
}

/// 构造数据帧（模拟数据源与测试用）
#[cfg_attr(not(test), allow(dead_code))]
pub fn build_frame(speed_milli_mps: u32, dt_us: u32) -> [u8; FRAME_SIZE] {
    let mut frame = [0u8; FRAME_SIZE];
    frame[0] = FRAME_HEADER;
    frame[1..5].copy_from_slice(&speed_milli_mps.to_le_bytes());
    frame[5..9].copy_from_slice(&dt_us.to_le_bytes());
    frame[9] = crc8_dji(&frame[..9]);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc8_matches_protocol_examples() {
        // 协议 §6.1：25.000 m/s，CRC = 0xF0
        assert_eq!(
            crc8_dji(&[0x36, 0xA8, 0x61, 0x00, 0x00, 0xD0, 0x07, 0x00, 0x00]),
            0xF0
        );
        // 协议 §6.2：5.000 m/s，CRC = 0x5C
        assert_eq!(
            crc8_dji(&[0x36, 0x88, 0x13, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00]),
            0x5C
        );
    }

    #[test]
    fn parses_protocol_example_25_mps() {
        let mut p = Parser::new();
        let events = p.feed_slice(&[
            0x36, 0xA8, 0x61, 0x00, 0x00, 0xD0, 0x07, 0x00, 0x00, 0xF0,
        ]);
        assert_eq!(
            events,
            vec![ParserEvent::Frame(SpeedFrame {
                speed_milli_mps: 25000,
                dt_us: 2000,
            })]
        );
        if let ParserEvent::Frame(f) = events[0] {
            assert!((f.speed_mps() - 25.0).abs() < 1e-9);
        }
    }

    #[test]
    fn parses_protocol_example_5_mps() {
        let mut p = Parser::new();
        let events = p.feed_slice(&[
            0x36, 0x88, 0x13, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00, 0x5C,
        ]);
        assert_eq!(
            events,
            vec![ParserEvent::Frame(SpeedFrame {
                speed_milli_mps: 5000,
                dt_us: 10000,
            })]
        );
        if let ParserEvent::Frame(f) = events[0] {
            assert!((f.speed_mps() - 5.0).abs() < 1e-9);
        }
    }

    #[test]
    fn heartbeat_is_single_byte() {
        let mut p = Parser::new();
        assert_eq!(p.feed(0x48), Some(ParserEvent::Heartbeat));
        assert_eq!(p.feed(0x48), Some(ParserEvent::Heartbeat));
    }

    #[test]
    fn unknown_bytes_are_discarded() {
        let mut p = Parser::new();
        assert_eq!(p.feed_slice(&[0x00, 0x11, 0x22, 0x99, 0xFF]), vec![]);
    }

    #[test]
    fn payload_may_contain_0x36_and_0x48() {
        // speed 和 dt 的字节里嵌入 0x36 / 0x48，必须按普通载荷处理
        let frame = build_frame(0x00003648, 0x00004836);
        let mut p = Parser::new();
        let events = p.feed_slice(&frame);
        assert_eq!(
            events,
            vec![ParserEvent::Frame(SpeedFrame {
                speed_milli_mps: 0x00003648,
                dt_us: 0x00004836,
            })]
        );
    }

    #[test]
    fn garbage_before_frame_is_skipped() {
        let frame = build_frame(25000, 2000);
        let mut stream = vec![0x00u8, 0x11, 0x22];
        stream.extend_from_slice(&frame);
        let mut p = Parser::new();
        let events = p.feed_slice(&stream);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ParserEvent::Frame(_)));
    }

    #[test]
    fn crc_error_drops_frame_and_resyncs() {
        let mut bad = build_frame(25000, 2000);
        bad[9] ^= 0xFF; // 破坏 CRC
        let good = build_frame(5000, 10000);
        let mut stream = Vec::new();
        stream.extend_from_slice(&bad);
        stream.extend_from_slice(&good);
        let mut p = Parser::new();
        let events = p.feed_slice(&stream);
        assert_eq!(
            events,
            vec![
                ParserEvent::CrcError,
                ParserEvent::Frame(SpeedFrame {
                    speed_milli_mps: 5000,
                    dt_us: 10000,
                }),
            ]
        );
    }

    #[test]
    fn heartbeats_between_frames() {
        let frame = build_frame(25000, 2000);
        let mut stream = vec![HEARTBEAT_BYTE];
        stream.extend_from_slice(&frame);
        stream.extend_from_slice(&[HEARTBEAT_BYTE, HEARTBEAT_BYTE]);
        let mut p = Parser::new();
        let events = p.feed_slice(&stream);
        assert_eq!(
            events,
            vec![
                ParserEvent::Heartbeat,
                ParserEvent::Frame(SpeedFrame {
                    speed_milli_mps: 25000,
                    dt_us: 2000,
                }),
                ParserEvent::Heartbeat,
                ParserEvent::Heartbeat,
            ]
        );
    }

    #[test]
    fn frame_split_across_feeds() {
        let frame = build_frame(25000, 2000);
        let mut p = Parser::new();
        let mut events = Vec::new();
        for &b in &frame {
            if let Some(e) = p.feed(b) {
                events.push(e);
            }
        }
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ParserEvent::Frame(_)));
    }

    #[test]
    fn build_frame_roundtrip_and_doc_examples() {
        // build_frame 必须复现协议文档示例字节
        assert_eq!(
            build_frame(25000, 2000),
            [0x36, 0xA8, 0x61, 0x00, 0x00, 0xD0, 0x07, 0x00, 0x00, 0xF0]
        );
        assert_eq!(
            build_frame(5000, 10000),
            [0x36, 0x88, 0x13, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00, 0x5C]
        );
    }
}
