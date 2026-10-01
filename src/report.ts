/**
 * 测试总结报告：把已有数据汇总成可直接贴进文档的 Markdown / CSV。
 * 纯函数（除取当前时间），vitest 覆盖。
 */
import {
  alignedProfile,
  bootstrapDiff,
  correlate,
  crossGroupStats,
  driftTrend,
  oneSampleT,
  dispersionGeometry,
  hotGunDelta,
  intervalStats,
  lowRuns,
  outliers,
  parseParam,
  trendSlope,
  welchTTest,
  type GroupSummaryRow,
} from "./analysis";
import { compareStatsRows } from "./compare";
import { groupDispersion } from "./compare";
import { computeStats } from "./stats";
import type { Group, GroupParams, WaveConfig } from "./types";

const f = (v: number | null, digits = 3, suffix = "") =>
  v === null || !Number.isFinite(v) ? "-" : `${v.toFixed(digits)}${suffix}`;

/** 参数定义（数值化后用于关联分析） */
export const PARAM_DEFS: { key: keyof GroupParams; label: string }[] = [
  { key: "stage1_rpm", label: "一级转速" },
  { key: "stage2_rpm", label: "二级转速" },
  { key: "pid", label: "PID(取第一个数)" },
  { key: "compression", label: "压缩量" },
  { key: "hardness", label: "硬度" },
];

/** 可参与关联分析的结果指标 */
export const METRIC_DEFS: {
  key: keyof GroupSummaryRow;
  label: string;
}[] = [
  { key: "mean", label: "均值(m/s)" },
  { key: "range", label: "极差(m/s)" },
  { key: "std", label: "标准差" },
  { key: "cv", label: "变异系数%" },
  { key: "r50", label: "散布半径R50(mm)" },
  { key: "wheelDropPct", label: "平均掉速%" },
];

export interface CorrRow {
  param: string;
  metric: string;
  r: number | null;
  n: number;
}

/** 参数 × 指标 的相关系数表（只用参数能解析成数值的组） */
export function correlationTable(rows: GroupSummaryRow[]): CorrRow[] {
  const out: CorrRow[] = [];
  for (const p of PARAM_DEFS) {
    for (const m of METRIC_DEFS) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of rows) {
        const x = parseParam(row.params[p.key]);
        const y = row[m.key] as number | null;
        if (x === null || y === null) continue;
        xs.push(x);
        ys.push(y);
      }
      const c = correlate(xs, ys);
      out.push({ param: p.label, metric: m.label, r: c ? c.r : null, n: c ? c.n : xs.length });
    }
  }
  return out;
}

/** 逐组总览 CSV（与界面表格同列） */
export function buildOverviewCsv(
  rows: GroupSummaryRow[],
  target: number | null,
  tolPct: number
): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = [
    "组名",
    "一级转速",
    "二级转速",
    "PID",
    "压缩量(mm)",
    "摩擦轮硬度",
    "发数",
    "均值(m/s)",
    "最大值",
    "最小值",
    "极差",
    "标准差",
    "变异系数%",
    `达标率(±${tolPct}%)`,
    "离群发数",
    "趋势(m/s/发)",
    "热枪效应(m/s)",
    "发间隔中位(s)",
    "发间隔最长(s)",
    "平均掉速%",
    "散布半径R50(mm)",
    "平均环数",
  ];
  const lines = [
    `# 目标弹速,${target === null ? "各组均值" : target.toFixed(3)}`,
    head.join(","),
  ];
  for (const r of rows) {
    const pass =
      tolPct === 0.5 ? r.pass05 : tolPct === 2 ? r.pass2 : r.pass1;
    lines.push(
      [
        cell(r.name),
        cell(r.params.stage1_rpm),
        cell(r.params.stage2_rpm),
        cell(r.params.pid),
        cell(r.params.compression),
        cell(r.params.hardness),
        String(r.n),
        f(r.mean, 4),
        f(r.max, 3),
        f(r.min, 3),
        f(r.range, 3),
        f(r.std, 4),
        f(r.cv, 2),
        pass === null ? "-" : `${(pass * 100).toFixed(1)}%`,
        String(r.outlierCount),
        f(r.trend, 4),
        f(r.hotGun, 4),
        f(r.intervalMedian, 2),
        f(r.intervalMax, 2),
        f(r.wheelDropPct, 2),
        f(r.r50, 2),
        f(r.meanRing, 2),
      ].join(",")
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

export interface ReportInput {
  rows: GroupSummaryRow[];
  groups: Group[];
  cfgOf: (g: Group) => WaveConfig;
  target: number | null;
  tolPct: number;
  compare?: [Group, Group] | null;
  /** 便于测试固定时间 */
  generatedAt?: Date;
}

/** 生成 Markdown 测试总结 */
export function buildOverviewMarkdown(input: ReportInput): string {
  const { rows, groups, target, tolPct } = input;
  const now = input.generatedAt ?? new Date();
  const totalShots = groups.reduce((a, g) => a + g.shots.length, 0);
  const L: string[] = [];

  L.push("# 测速测试总结");
  L.push("");
  L.push(`- 生成时间：${now.toLocaleString()}`);
  L.push(
    `- 数据规模：${groups.length} 组 / ${totalShots} 发；达标率目标：${
      target === null ? "各组均值" : `${target.toFixed(3)} m/s`
    }（±${tolPct}%）`
  );
  L.push("");

  // 1. 逐组总览
  L.push("## 一、逐组总览");
  L.push("");
  L.push(
    [
      "组名",
      "一级转速",
      "二级转速",
      "PID",
      "压缩量",
      "硬度",
      "发数",
      "均值(m/s)",
      "极差",
      "标准差",
      "CV%",
      `达标率±${tolPct}%`,
      "离群",
      "趋势/发",
      "R50(mm)",
      "平均环数",
    ].join(" | ")
  );
  L.push(
    [
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
      "---",
    ].join(" | ")
  );
  for (const r of rows) {
    const pass =
      tolPct === 0.5 ? r.pass05 : tolPct === 2 ? r.pass2 : r.pass1;
    L.push(
      [
        r.name,
        r.params.stage1_rpm || "-",
        r.params.stage2_rpm || "-",
        r.params.pid || "-",
        r.params.compression || "-",
        r.params.hardness || "-",
        String(r.n),
        f(r.mean, 4),
        f(r.range, 3),
        f(r.std, 4),
        f(r.cv, 2),
        pass === null ? "-" : `${(pass * 100).toFixed(1)}%`,
        String(r.outlierCount),
        f(r.trend, 4),
        f(r.r50, 2),
        f(r.meanRing, 2),
      ].join(" | ")
    );
  }
  L.push("");

  // 2. 稳定性与异常
  L.push("## 二、稳定性与异常");
  L.push("");
  for (const g of groups) {
    const values = g.shots.map((s) => s.speed_mps);
    const st = computeStats(values);
    if (!st) continue;
    const o = outliers(values);
    const runs = lowRuns(values);
    const iv = intervalStats(g.shots.map((s) => s.at_ms));
    const slope = trendSlope(values);
    const hot = hotGunDelta(values);
    L.push(`### ${g.name}（${values.length} 发）`);
    L.push(
      `- 均值 ${st.mean.toFixed(4)} m/s，标准差 ${st.std.toFixed(4)}（CV ${
        st.mean !== 0 ? ((st.std / Math.abs(st.mean)) * 100).toFixed(2) : "-"
      }%），极差 ${st.range.toFixed(3)}`
    );
    L.push(
      o.length === 0
        ? "- 离群发：无（|z| ≥ 2.5）"
        : `- 离群发：${o
            .map((x) => `第 ${x.idx} 发 ${x.value.toFixed(3)}(z=${x.z.toFixed(1)})`)
            .join("、")}`
    );
    if (runs.length > 0) {
      L.push(
        `- 连续偏低段（< mean−1.2σ 且连续 ≥2 发）：${runs
          .map((r2) => `第 ${r2.from}–${r2.to} 发（均值 ${r2.mean.toFixed(3)}）`)
          .join("、")}`
      );
    }
    L.push(
      `- 趋势：${f(slope, 4)} m/s/发（正=越打越快）；热枪效应（后3发−前3发）：${f(
        hot,
        4
      )} m/s`
    );
    if (iv) {
      L.push(
        `- 发弹节奏：中位 ${iv.median.toFixed(2)} s（最快 ${iv.min.toFixed(
          2
        )} / 最慢 ${iv.max.toFixed(2)}）`
      );
    }
    L.push("");
  }

  // 3. 散布分析
  const withDisp = groups.filter((g) => (g.dispersion?.points.length ?? 0) > 0);
  if (withDisp.length > 0) {
    L.push("## 三、散布分析");
    L.push("");
    L.push(
      "组名 | 标点数 | 弹着中心偏移(mm) | 方向 | Cx(mm) | Cy(mm) | R50(mm) | 平均环数 | 小装甲命中率"
    );
    L.push("--- | --- | --- | --- | --- | --- | --- | --- | ---");
    for (const g of withDisp) {
      const side = groupDispersion(g);
      const geo = dispersionGeometry(side.pointsMm);
      const dir =
        geo === null
          ? "-"
          : `${geo.dx >= 0 ? "右" : "左"}${Math.abs(geo.dx).toFixed(1)} / ${
              geo.dy >= 0 ? "下" : "上"
            }${Math.abs(geo.dy).toFixed(1)}`;
      L.push(
        [
          g.name,
          String(side.n),
          geo ? geo.dist.toFixed(2) : "-",
          dir,
          geo ? geo.cx.toFixed(2) : "-",
          geo ? geo.cy.toFixed(2) : "-",
          geo ? geo.r50.toFixed(2) : "-",
          side.meanRing === null ? "-" : side.meanRing.toFixed(3),
          side.hitSmall === null ? "-" : `${(side.hitSmall * 100).toFixed(1)}%`,
        ].join(" | ")
      );
    }
    L.push("");
    L.push(
      "- 弹着中心偏移：以纸面中心为原点；Cx/Cy 为水平/垂直方向标准差；R50 为半数落点半径"
    );
    L.push("");
  }

  // 4. 参数与结果的相关性
  L.push("## 四、参数与结果的相关性");
  L.push("");
  const corrs = correlationTable(rows).filter((c) => c.r !== null);
  if (corrs.length === 0) {
    L.push(
      "（暂无可分析的参数差异：需要各组在该参数上取值不同、且能解析出数值，并至少 3 组有该结果指标）"
    );
    L.push("");
  } else {
    L.push("参数 | 结果指标 | 相关系数 r | 样本数");
    L.push("--- | --- | --- | ---");
    for (const c of corrs) {
      L.push(`${c.param} | ${c.metric} | ${c.r!.toFixed(3)} | ${c.n}`);
    }
    L.push("");
    L.push("- r 越接近 ±1 相关性越强；正相关=参数越大指标越大");
    L.push("");
  }

  // 5. 多组（当日）汇总与热枪效应
  const cg = crossGroupStats(groups, 3);
  if (cg.length >= 2) {
    L.push("## 五、多组汇总与热枪效应");
    L.push("");
    const cold = oneSampleT(cg.filter((s) => s.n > 3).map((s) => s.coldDelta));
    const hot = oneSampleT(
      cg.map((s) => s.hotDelta).filter((v): v is number => v !== null)
    );
    const drift = driftTrend(cg);
    const prof = alignedProfile(groups, 6);
    const desc = (t: ReturnType<typeof oneSampleT>) =>
      t === null
        ? "样本不足"
        : `${t.mean >= 0 ? "+" : ""}${t.mean.toFixed(4)} m/s（95% CI ${t.ciLow.toFixed(
            4
          )} ~ ${t.ciHigh.toFixed(4)}，p=${t.p < 0.001 ? "<0.001" : t.p.toFixed(3)}，n=${t.n}）${
            t.p < 0.05 ? " → 系统性偏差显著" : " → 不显著"
          }`;
    L.push(`- 冷枪效应（每组前 3 发 − 该组其余发）：${desc(cold)}`);
    L.push(`- 组内热枪（每组后 3 发 − 前 3 发）：${desc(hot)}`);
    if (drift) {
      L.push(
        `- 组间漂移：按测试顺序，组均值每前进一组变化 ${drift.slope >= 0 ? "+" : ""}${drift.slope.toFixed(
          4
        )} m/s（r=${drift.r.toFixed(2)}，n=${drift.n} 组）`
      );
    }
    L.push("");
    L.push("组名 | 发数 | 均值 | 前3发 | 其余发 | 冷枪差 | 组内热枪差 | CV%");
    L.push("--- | --- | --- | --- | --- | --- | --- | ---");
    for (const s of cg) {
      L.push(
        [
          s.name,
          String(s.n),
          s.mean.toFixed(4),
          s.firstK.toFixed(4),
          s.restMean.toFixed(4),
          `${s.coldDelta >= 0 ? "+" : ""}${s.coldDelta.toFixed(4)}`,
          f(s.hotDelta, 4),
          f(s.cv, 2),
        ].join(" | ")
      );
    }
    if (prof.length > 0) {
      L.push("");
      L.push("按组内发序号对齐的平均偏差（以各组自身均值为基准）：");
      L.push("");
      L.push(prof.map((p) => `第${p.shotIdx}发 ${p.meanDev >= 0 ? "+" : ""}${p.meanDev.toFixed(4)}`).join(" | "));
      L.push("");
      L.push("（各发偏差越大说明该位置系统性偏高/偏低，可用于判断热枪建立需要几发）");
    }
    L.push("");
  }

  // 6. 两组对比
  if (input.compare) {
    const [a, b] = input.compare;
    L.push(`## 六、两组对比（${a.name} vs ${b.name}）`);
    L.push("");
    L.push("指标 | " + a.name + " | " + b.name + " | 差值(B-A) | 95% CI | p");
    L.push("--- | --- | --- | --- | --- | ---");
    const va = a.shots.map((s) => s.speed_mps);
    const vb = b.shots.map((s) => s.speed_mps);
    for (const row of compareStatsRows(a, b)) {
      let extra: [string, string] = ["-", "-"];
      if (row.label.startsWith("均值") && va.length >= 2 && vb.length >= 2) {
        const t = welchTTest(va, vb);
        if (t) {
          extra = [
            `${t.ciLow.toFixed(4)} ~ ${t.ciHigh.toFixed(4)}`,
            t.p < 0.001 ? "<0.001" : t.p.toFixed(3),
          ];
        }
      } else if (row.label.startsWith("极差") || row.label.startsWith("标准差")) {
        // 极差/标准差这类指标的抽样分布未知，用 bootstrap 重采样该统计量
        const stat = row.label.startsWith("极差")
          ? (v: number[]) => Math.max(...v) - Math.min(...v)
          : (v: number[]) => {
              const m = v.reduce((p, q) => p + q, 0) / v.length;
              return Math.sqrt(
                v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1)
              );
            };
        const t = bootstrapDiff(va, vb, 1000, 20261002, stat);
        if (t) {
          extra = [
            `${t.ciLow.toFixed(4)} ~ ${t.ciHigh.toFixed(4)}`,
            t.p < 0.001 ? "<0.001" : t.p.toFixed(3),
          ];
        }
      }
      L.push(
        [
          row.label,
          f(row.a, row.digits),
          f(row.b, row.digits),
          f(row.diff, row.digits),
          extra[0],
          extra[1],
        ].join(" | ")
      );
    }
    L.push("");
    L.push("- 均值差用 Welch t 检验（含 95% 置信区间）；极差/标准差用 bootstrap 重采样");
    L.push("");
  }

  // 6. 说明
  L.push("## 说明");
  L.push("");
  L.push(
    "- 组参数的数值化：取字符串中第一个数字（如 `50a` → 50；PID 形如 `0.0002, 0.0, 0.0000003` 时取第一个数）"
  );
  L.push(
    "- 离群发判据 |z| ≥ 2.5；连续偏低段判据 < mean−1.2σ 且连续 ≥2 发（疑似供弹/摩擦轮异常）"
  );
  L.push(
    "- 热枪效应 = 后 3 发均值 − 前 3 发均值（正值表示越打越快）；趋势为逐发最小二乘斜率"
  );
  L.push(
    "- 样本量普遍较小（每组 9~28 发），p 值与相关系数仅供参考，不建议据此下强结论"
  );
  L.push("");
  return L.join("\n");
}
