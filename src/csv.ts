import { save } from "@tauri-apps/plugin-dialog";
import { isTauri, writeTextFile } from "./api";
import type { Group, WaveConfig } from "./types";
import { computeStats } from "./stats";
import { reportShotWave } from "./wave";

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

function channelLabel(cfg: WaveConfig, ch: number): string {
  return cfg.channelLabels[ch]?.trim() || `通道${ch}`;
}

/** 导出用的摩擦轮指标列头（单组明细用） */
function waveDetailHeader(cfg: WaveConfig, maxCh: number): string[] {
  const cols: string[] = [];
  for (let ch = 0; ch < maxCh; ch++) {
    const label = channelLabel(cfg, ch);
    cols.push(`${label}基线`, `${label}掉速`, `${label}掉速%`, `${label}恢复ms`);
  }
  for (const g of cfg.groups) cols.push(`${g.name}轮间差`);
  return cols;
}

/** 单组明细 CSV：文件头为分组参数（对标 TJSP 表 4~7 记录字段），随后逐发明细。
 *  传入 waveCfg 时追加每发摩擦轮掉速指标列（无快照的发留空）。 */
export function buildGroupCsv(group: Group, waveCfg?: WaveConfig | null): string {
  const p = group.params;
  const withWave =
    waveCfg != null && group.shots.some((s) => s.wave != null);
  const maxCh = withWave
    ? Math.max(...group.shots.map((s) => s.wave?.channels.length ?? 0))
    : 0;
  const waveCols = withWave ? waveDetailHeader(waveCfg, maxCh) : [];
  const lines = [
    `# 组名,${csvCell(group.name)}`,
    `# 一级转速,${csvCell(p.stage1_rpm)}`,
    `# 二级转速,${csvCell(p.stage2_rpm)}`,
    `# PID,${csvCell(p.pid)}`,
    `# 压缩量(mm),${csvCell(p.compression)}`,
    `# 摩擦轮硬度,${csvCell(p.hardness)}`,
    `# 备注,${csvCell(p.note)}`,
    `# 开始时间,${fmtTime(group.startedAt)}`,
    ["序号", "弹速(m/s)", "dt(us)", "接收时间", ...waveCols].join(","),
  ];
  for (const s of group.shots) {
    const cells = [
      String(s.idx),
      s.speed_mps.toFixed(3),
      String(s.dt_us),
      fmtTime(s.at_ms),
    ];
    if (withWave) {
      if (s.wave) {
        const rep = reportShotWave(s.wave, waveCfg);
        for (let ch = 0; ch < maxCh; ch++) {
          const m = rep.channelMetrics[ch];
          cells.push(
            m ? m.baseline.toFixed(1) : "",
            m ? m.drop.toFixed(1) : "",
            m ? m.dropPct.toFixed(2) : "",
            m ? (m.recoverMs === null ? "未恢复" : m.recoverMs.toFixed(0)) : ""
          );
        }
        for (const gs of rep.groupSpreads) {
          cells.push(gs.spread === null ? "" : gs.spread.toFixed(1));
        }
      } else {
        cells.push(...Array(waveCols.length).fill(""));
      }
    }
    lines.push(cells.join(","));
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** 全部组汇总 CSV：每组一行统计结果，对应 TJSP 逐组对比表。
 *  传入 waveCfg 时追加各轮组的平均掉速%与平均轮间差。 */
export function buildAllGroupsCsv(
  groups: Group[],
  waveCfg?: WaveConfig | null
): string {
  const waveCols =
    waveCfg != null
      ? waveCfg.groups.flatMap((g) => [`${g.name}平均掉速%`, `${g.name}平均轮间差`])
      : [];
  const lines = [
    [
      "组名",
      "一级转速",
      "二级转速",
      "PID",
      "压缩量(mm)",
      "摩擦轮硬度",
      "备注",
      "样本数",
      "均值(m/s)",
      "最大值",
      "最小值",
      "极差",
      "方差",
      "标准差",
      ...waveCols,
    ].join(","),
  ];
  for (const g of groups) {
    const st = computeStats(g.shots.map((s) => s.speed_mps));
    const p = g.params;
    const cells = [
      csvCell(g.name),
      csvCell(p.stage1_rpm),
      csvCell(p.stage2_rpm),
      csvCell(p.pid),
      csvCell(p.compression),
      csvCell(p.hardness),
      csvCell(p.note),
      st ? String(st.n) : "0",
      st ? st.mean.toFixed(4) : "",
      st ? st.max.toFixed(3) : "",
      st ? st.min.toFixed(3) : "",
      st ? st.range.toFixed(3) : "",
      st ? st.variance.toFixed(6) : "",
      st ? st.std.toFixed(4) : "",
    ];
    if (waveCfg != null) {
      const reps = g.shots
        .filter((s) => s.wave)
        .map((s) => reportShotWave(s.wave!, waveCfg));
      for (let gi = 0; gi < waveCfg.groups.length; gi++) {
        const drops: number[] = [];
        const spreads: number[] = [];
        for (const rep of reps) {
          for (const ch of waveCfg.groups[gi].channels) {
            const m = rep.channelMetrics[ch];
            if (m) drops.push(m.dropPct);
          }
          const sp = rep.groupSpreads[gi]?.spread;
          if (sp != null) spreads.push(sp);
        }
        const mean = (arr: number[]) =>
          arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const md = mean(drops);
        const ms = mean(spreads);
        cells.push(md === null ? "" : md.toFixed(2), ms === null ? "" : ms.toFixed(1));
      }
    }
    lines.push(cells.join(","));
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
