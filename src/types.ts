/** 串口数据帧事件载荷（与 Rust 端 FramePayload 对应） */
export interface SpeedFrameMsg {
  /** m/s */
  speed_mps: number;
  /** 0.001 m/s */
  speed_milli_mps: number;
  /** 两光电门时间差 us */
  dt_us: number;
  /** 接收时间，Unix ms */
  at_ms: number;
}

import type { WaveSnapshot } from "./wave";
import type { Pt } from "./dispersion/math";

/** 组内一发记录 */
export interface Shot {
  /** 组内序号，从 1 开始 */
  idx: number;
  speed_mps: number;
  dt_us: number;
  at_ms: number;
  /** 发射瞬间摩擦轮波形快照（连接波形口且数据充足时才有） */
  wave?: WaveSnapshot;
}

/** 裁剪/标定后的有效靶纸尺寸（mm） */
export interface PaperSpecLike {
  name: string;
  w: number;
  h: number;
}

/** 散布分析（靶纸）数据，挂在组上 */
export interface DispersionData {
  /** 压缩后的靶纸图片 dataURL（最长边 1920，JPEG） */
  imageDataUrl?: string;
  /** 标定用的有效纸面尺寸 */
  effSpec: PaperSpecLike;
  /** 标定点（统一到 mm 坐标） */
  points: Pt[];
  /** 文字标注 */
  texts: { x: number; y: number; text: string; size: number; color: string }[];
  /** 更新时间 */
  updatedAt: number;
}

/** 测试分组参数（对标 TJSP 文档表 4~7 的记录字段） */
export interface GroupParams {
  stage1_rpm: string;
  stage2_rpm: string;
  pid: string;
  /** 压缩量 mm */
  compression: string;
  /** 摩擦轮硬度 */
  hardness: string;
  note: string;
}

export interface Group {
  id: number;
  name: string;
  params: GroupParams;
  startedAt: number;
  shots: Shot[];
  /** 该组的散布分析（靶纸）数据 */
  dispersion?: DispersionData;
}

export const EMPTY_PARAMS: GroupParams = {
  stage1_rpm: "",
  stage2_rpm: "",
  pid: "",
  compression: "",
  hardness: "",
  note: "",
};

/** 主区视图：图表 / 弹速明细 / 散布分析 */
export type MainView = "charts" | "details" | "dispersion";

/** 摩擦轮分组配置：一个通道组对应一组同工况摩擦轮（如 3+3 六摩擦轮） */
export interface WheelGroupCfg {
  id: number;
  name: string;
  /** JustFloat 通道下标（从 0 开始） */
  channels: number[];
}

/** 波形口配置：通道→摩擦轮映射 */
export interface WaveConfig {
  groups: WheelGroupCfg[];
  /** 每个通道的显示名，缺省为 "通道N" */
  channelLabels: Record<number, string>;
}

export const EMPTY_WAVE_CONFIG: WaveConfig = { groups: [], channelLabels: {} };
