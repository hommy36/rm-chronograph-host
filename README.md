# rm-chronograph-host

RoboMaster 摩擦轮测速模块的桌面可视化上位机。Tauri v2 + React + TypeScript，Windows 安装包见 [Releases](../../releases)。

## 功能

- **实时弹速**：串口接入双光电门测速模块（115200 8N1，自定义 CRC8 帧协议），大数字实时显示、dt / 距上一发间隔
- **分组测试**：按组记录一级/二级转速、PID、压缩量、摩擦轮硬度等参数，目标发数进度提醒
- **统计分析**：样本数 / 均值 / 最值 / 极差 / 方差 / 标准差，时间序列、直方图、偏差趋势、移动平均 ±1σ 带四图联动
- **掉速分析（VOFA+ JustFloat）**：第二个串口读摩擦轮转速波形，每发自动截取发射前 200ms ~ 后 1000ms 快照，点击明细行查看掉速/恢复曲线、掉速量、恢复时间、组内轮间差（支持 3+3 六摩擦轮等任意分组配置）
- **散布分析**：靶纸照片上传、A4/A5 等尺寸裁剪标定、点击标点、环数/散布距离/装甲命中率（小装甲、大装甲、飞镖）/最小包围圆
- **CSV 导出**：单组明细（可选含每发摩擦轮掉速指标）与全部组汇总

## 开发与构建

```bash
npm install        # 或 pnpm install
npm run tauri dev  # 开发调试（顶栏"模拟数据"开关可无硬件演示）

npm run test       # 前端单元测试（vitest）
cd src-tauri && cargo test   # Rust 协议解析测试

npm run tauri build  # 打包 NSIS / MSI 安装包，产物在 src-tauri/target/release/bundle/
```

## 串口协议

- **测速口**：心跳单字节 `0x48`（约 100ms）；数据帧 10 字节 `0x36 | speed_milli_mps(u32 LE) | dt_us(u32 LE) | CRC8`（多项式 0x31 反射、初值 0xFF 的 DJI/RM 查表 CRC8）
- **波形口**：VOFA+ JustFloat，N 个 float32 LE 通道 + 尾帧 `00 00 80 7F`，通道数自适应

## License

MIT
