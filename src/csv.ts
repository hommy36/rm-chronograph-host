import { save } from "@tauri-apps/plugin-dialog";
import { isTauri, writeTextFile } from "./api";
import type { Group } from "./types";
import { computeStats } from "./stats";

const BOM = "﻿";

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 单组明细 CSV：文件头为分组参数（对标 TJSP 表 4~7 记录字段），随后逐发明细 */
export function buildGroupCsv(group: Group): string {
  const p = group.params;
  const lines = [
    `# 组名,${csvCell(group.name)}`,
    `# 一级转速,${csvCell(p.stage1_rpm)}`,
    `# 二级转速,${csvCell(p.stage2_rpm)}`,
    `# PID,${csvCell(p.pid)}`,
    `# 压缩量(mm),${csvCell(p.compression)}`,
    `# 摩擦轮硬度,${csvCell(p.hardness)}`,
    `# 备注,${csvCell(p.note)}`,
    `# 开始时间,${fmtTime(group.startedAt)}`,
    "序号,弹速(m/s),dt(us),接收时间",
  ];
  for (const s of group.shots) {
    lines.push(
      `${s.idx},${s.speed_mps.toFixed(3)},${s.dt_us},${fmtTime(s.at_ms)}`
    );
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** 全部组汇总 CSV：每组一行统计结果，对应 TJSP 逐组对比表 */
export function buildAllGroupsCsv(groups: Group[]): string {
  const lines = [
    "组名,一级转速,二级转速,PID,压缩量(mm),摩擦轮硬度,备注,样本数,均值(m/s),最大值,最小值,极差,方差,标准差",
  ];
  for (const g of groups) {
    const st = computeStats(g.shots.map((s) => s.speed_mps));
    const p = g.params;
    lines.push(
      [
        csvCell(g.name),
        csvCell(p.stage1_rpm),
        csvCell(p.stage2_rpm),
        csvCell(p.pid),
        csvCell(p.compression),
        csvCell(p.hardness),
        csvCell(p.note),
        st ? st.n : 0,
        st ? st.mean.toFixed(4) : "",
        st ? st.max.toFixed(3) : "",
        st ? st.min.toFixed(3) : "",
        st ? st.range.toFixed(3) : "",
        st ? st.variance.toFixed(6) : "",
        st ? st.std.toFixed(4) : "",
      ].join(",")
    );
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** 保存 CSV：Tauri 环境走保存对话框 + Rust 写盘；纯浏览器环境退回下载 */
export async function saveCsv(
  defaultName: string,
  contents: string
): Promise<boolean> {
  if (isTauri()) {
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return false; // 用户取消
    await writeTextFile(path, contents);
    return true;
  }
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
