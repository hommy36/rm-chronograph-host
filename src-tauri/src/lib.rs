mod protocol;

use protocol::{Parser, ParserEvent};
use serde::Serialize;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const BAUD_RATE: u32 = 115200;
const READ_TIMEOUT_MS: u64 = 100;

const EVT_HEARTBEAT: &str = "proto://heartbeat";
const EVT_FRAME: &str = "proto://frame";
const EVT_CRC_ERROR: &str = "proto://crc_error";
const EVT_DISCONNECTED: &str = "proto://disconnected";
/// 波形口（VOFA+ JustFloat）：原始字节透传，前端统一解析
const EVT_WAVE_BYTES: &str = "wave://bytes";
const EVT_WAVE_DISCONNECTED: &str = "wave://disconnected";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Clone)]
struct HeartbeatPayload {
    at_ms: u64,
}

#[derive(Serialize, Clone)]
struct FramePayload {
    speed_mps: f64,
    speed_milli_mps: u32,
    dt_us: u32,
    at_ms: u64,
}

#[derive(Serialize, Clone)]
struct CrcErrorPayload {
    at_ms: u64,
}

#[derive(Serialize, Clone)]
struct DisconnectedPayload {
    reason: String,
}

#[derive(Serialize)]
struct PortItem {
    name: String,
    description: String,
}

struct SerialSession {
    cancel: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct SerialState {
    session: Mutex<Option<SerialSession>>,
}

/// 波形口（JustFloat 数据源）独立会话
#[derive(Default)]
struct WaveSerialState {
    session: Mutex<Option<SerialSession>>,
}

#[derive(Serialize, Clone)]
struct WaveBytesPayload {
    at_ms: u64,
    /// base64 编码的原始字节
    b64: String,
}

fn stop_session(session_slot: &Mutex<Option<SerialSession>>) {
    let session = session_slot.lock().unwrap().take();
    if let Some(session) = session {
        session.cancel.store(true, Ordering::Relaxed);
        if let Some(handle) = session.handle {
            let _ = handle.join();
        }
    }
}

#[tauri::command]
fn list_ports() -> Result<Vec<PortItem>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| PortItem {
            description: match &p.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    info.product.clone().unwrap_or_else(|| "USB 串口".into())
                }
                serialport::SerialPortType::PciPort => "PCI 串口".into(),
                serialport::SerialPortType::BluetoothPort => "蓝牙串口".into(),
                serialport::SerialPortType::Unknown => "串口".into(),
            },
            name: p.port_name,
        })
        .collect())
}

#[tauri::command]
fn connect_serial(
    app: AppHandle,
    state: State<'_, SerialState>,
    port_name: String,
) -> Result<(), String> {
    stop_session(&state.session);

    let mut port = serialport::new(&port_name, BAUD_RATE)
        .data_bits(serialport::DataBits::Eight)
        .parity(serialport::Parity::None)
        .stop_bits(serialport::StopBits::One)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(READ_TIMEOUT_MS))
        .open()
        .map_err(|e| format!("打开 {port_name} 失败：{e}"))?;

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_thread = cancel.clone();

    let handle = std::thread::spawn(move || {
        let mut parser = Parser::new();
        let mut buf = [0u8; 512];
        loop {
            if cancel_thread.load(Ordering::Relaxed) {
                break;
            }
            match port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    for event in parser.feed_slice(&buf[..n]) {
                        match event {
                            ParserEvent::Heartbeat => {
                                let _ = app.emit(EVT_HEARTBEAT, HeartbeatPayload { at_ms: now_ms() });
                            }
                            ParserEvent::Frame(f) => {
                                let _ = app.emit(
                                    EVT_FRAME,
                                    FramePayload {
                                        speed_mps: f.speed_mps(),
                                        speed_milli_mps: f.speed_milli_mps,
                                        dt_us: f.dt_us,
                                        at_ms: now_ms(),
                                    },
                                );
                            }
                            ParserEvent::CrcError => {
                                let _ = app.emit(EVT_CRC_ERROR, CrcErrorPayload { at_ms: now_ms() });
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => {
                    if !cancel_thread.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            EVT_DISCONNECTED,
                            DisconnectedPayload {
                                reason: e.to_string(),
                            },
                        );
                    }
                    break;
                }
            }
        }
    });

    *state.session.lock().unwrap() = Some(SerialSession {
        cancel,
        handle: Some(handle),
    });
    Ok(())
}

#[tauri::command]
fn disconnect_serial(state: State<'_, SerialState>) {
    stop_session(&state.session);
}

/// 连接波形口：只读字节流并通过 wave://bytes 事件透传（前端解析 JustFloat）
#[tauri::command]
fn connect_wave_serial(
    app: AppHandle,
    state: State<'_, WaveSerialState>,
    port_name: String,
    baud_rate: u32,
) -> Result<(), String> {
    stop_session(&state.session);

    let mut port = serialport::new(&port_name, baud_rate)
        .data_bits(serialport::DataBits::Eight)
        .parity(serialport::Parity::None)
        .stop_bits(serialport::StopBits::One)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(READ_TIMEOUT_MS))
        .open()
        .map_err(|e| format!("打开波形口 {port_name} 失败：{e}"))?;

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_thread = cancel.clone();

    let handle = std::thread::spawn(move || {
        use base64::Engine;
        let mut buf = [0u8; 1024];
        loop {
            if cancel_thread.load(Ordering::Relaxed) {
                break;
            }
            match port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = app.emit(
                        EVT_WAVE_BYTES,
                        WaveBytesPayload {
                            at_ms: now_ms(),
                            b64: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
                        },
                    );
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => {
                    if !cancel_thread.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            EVT_WAVE_DISCONNECTED,
                            DisconnectedPayload {
                                reason: e.to_string(),
                            },
                        );
                    }
                    break;
                }
            }
        }
    });

    *state.session.lock().unwrap() = Some(SerialSession {
        cancel,
        handle: Some(handle),
    });
    Ok(())
}

#[tauri::command]
fn disconnect_wave_serial(state: State<'_, WaveSerialState>) {
    stop_session(&state.session);
}

/// 导出 CSV：前端弹完保存对话框后，把内容交给 Rust 写盘
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("写入 {path} 失败：{e}"))
}

/// 导出二进制文件（如标注图 PNG）：base64 解码后写盘
#[tauri::command]
fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("base64 解码失败：{e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入 {path} 失败：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SerialState::default())
        .manage(WaveSerialState::default())
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect_serial,
            disconnect_serial,
            connect_wave_serial,
            disconnect_wave_serial,
            write_text_file,
            write_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
