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

/** 组内一发记录 */
export interface Shot {
  /** 组内序号，从 1 开始 */
  idx: number;
  speed_mps: number;
  dt_us: number;
  at_ms: number;
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
