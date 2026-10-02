#!/usr/bin/env node
/**
 * 生成内置示例数据：从真实会话文件里抽出「10-1」那四次测试的组，
 * 瘦身后写成 public/demo/demo-10-1.json（格式与 .rmtest 项目文件一致）。
 *
 * 只读源文件，不做任何写入；示例数据里的组名/参数/备注会被统一改写，
 * 原始数据保持不变。
 *
 * 用法: node scripts/make-demo-data.mjs [session.json 路径]
 *   （默认读 %APPDATA%\com.rm-chronograph.host\session.json）
 *
 * 瘦身规则：去掉全程恒零的波形通道、时间轴只抽稀尾段（发射段保 1kHz 原分辨率，
 * 否则详情弹窗的 9 点平滑窗口会被一起拉长、掉速量被削平）。
 * 靶纸图与弹着点原样保留——图的像素尺寸是标点坐标的基准，动了图就必须同步
 * 变换点坐标，不值得冒这个险。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC =
  process.argv[2] ??
  path.join(
    process.env.APPDATA ?? "",
    "com.rm-chronograph.host",
    "session.json"
  );
const OUT = path.join(ROOT, "public", "demo", "demo-10-1.json");

/** 参与示例数据的组名前缀 */
const GROUP_PREFIX = "10-1第";
/** 内置示例测试名（应用侧按此前缀识别「示例数据」） */
const DEMO_TEST_NAME = "示例数据：10-1 四次测试";
const DEMO_TEST_NOTE =
  "内置示例数据，可随时右键删除，不影响你自己的记录。";

/** 组名 / 备注统一后的写法（示例数据专用，不改原始数据） */
const GROUP_META = [
  { name: "10-1 第1组 · 老弹丸", note: "老弹丸 · 第 1 组" },
  { name: "10-1 第2组 · 老弹丸", note: "老弹丸 · 第 2 组" },
  { name: "10-1 第3组 · 老弹丸", note: "老弹丸 · 第 3 组" },
  { name: "10-1 第4组 · 新弹丸", note: "新弹丸 · 第 4 组" },
];

/** 统一后的组参数（原数据里压缩量是空的，示例数据补一个说得通的值） */
const GROUP_PARAMS = {
  stage1_rpm: "5200",
  stage2_rpm: "5000",
  pid: "0.024",
  compression: "1.5",
  hardness: "50a",
};

/** 发射段的精细区间：t <= 该值 的采样点全部保留 */
const FINE_UNTIL_MS = 200;
/** 精细区间之后（波谷已恢复、基本都是平线）的抽稀步长 */
const COARSE_STRIDE = 4;

/* ------------------------------ 基础工具 ------------------------------ */

function decodeF32(b64) {
  const buf = Buffer.from(b64, "base64");
  if (buf.byteLength % 4 !== 0) throw new Error("波形数据长度非法");
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

function encodeF32(values) {
  const f = new Float32Array(values);
  return Buffer.from(f.buffer, 0, f.byteLength).toString("base64");
}

/**
 * 重采样：发射段（t <= FINE_UNTIL_MS）原样保留 1kHz 分辨率，
 * 之后只留每 COARSE_STRIDE 个点。
 *
 * 不能在发射段等距抽稀——详情弹窗里 9 点平滑窗口是按点数算的，
 * 采样变粗会把平滑窗口一起拉长，掉速量被系统性削平（实测偏低 12%）。
 */
function resample(times, channels, fineUntilMs, stride) {
  const idx = [];
  let sinceLast = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= fineUntilMs) {
      idx.push(i);
      sinceLast = 0;
    } else if (sinceLast === 0) {
      idx.push(i);
      sinceLast = stride - 1;
    } else {
      sinceLast -= 1;
    }
  }
  return {
    times: idx.map((i) => times[i]),
    channels: channels.map((ch) => idx.map((i) => ch[i])),
  };
}

/* ------------------------------ 主流程 ------------------------------ */

const session = JSON.parse(fs.readFileSync(SRC, "utf8"));
const source = session.groups
  .filter((g) => typeof g.name === "string" && g.name.startsWith(GROUP_PREFIX))
  .sort((a, b) => a.startedAt - b.startedAt);
if (source.length === 0) {
  throw new Error(`源文件里没有以「${GROUP_PREFIX}」开头的组：${SRC}`);
}

// 通道→轮组 的分配：四个组是同一套轮子测的，优先用源数据里第一个组自己的配置，
// 不能用全局配置兜底——那份是旧的对不上的（组1=[0,1] / 组2=[2,3,4]）。
const sharedCfg = source.find((g) => g.waveConfig)?.waveConfig ?? session.waveConfig;

const groups = [];
let imageBytes = 0;

source.forEach((g, gi) => {
  const meta = GROUP_META[gi] ?? {
    name: `10-1 第${gi + 1}组`,
    note: `第 ${gi + 1} 组`,
  };

  // 1) 找出该组真正用到的通道：任一发里有变化、或恒定非零的通道都保留；
  //    全程恒零的通道（未接线的槽位）丢掉，纯粹为了压体积。
  const decoded = g.shots.map((sh) =>
    sh.wave ? sh.wave.channels.map(decodeF32) : null
  );
  const channelCount =
    g.waveConfig?.channelCount ?? decoded.find(Boolean)?.length ?? 0;
  const keep = [];
  for (let c = 0; c < channelCount; c++) {
    let used = false;
    for (const chans of decoded) {
      if (!chans || !chans[c]) continue;
      const v = chans[c];
      let lo = Infinity;
      let hi = -Infinity;
      let nonZero = false;
      for (const x of v) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
        if (x !== 0) nonZero = true;
      }
      if (hi - lo > 1e-6 || nonZero) {
        used = true;
        break;
      }
    }
    if (used) keep.push(c);
  }
  const remap = new Map(keep.map((oldCh, newCh) => [oldCh, newCh]));

  // 2) 通道分配与显示名统一重排：一级/二级各占连续的三个通道
  const cfg = g.waveConfig ?? sharedCfg;
  const groupLabels = ["一级", "二级"];
  const groupPrefixes = ["一", "二"];
  const newGroups = [];
  const channelLabels = {};
  let cursor = 0;
  cfg.groups.forEach((grp, idx) => {
    const chans = grp.channels
      .map((c) => remap.get(c))
      .filter((c) => c !== undefined);
    if (chans.length === 0) return;
    const name = groupLabels[idx] ?? grp.name;
    const prefix = groupPrefixes[idx] ?? `${name[0]}`;
    newGroups.push({ id: idx + 1, name, channels: chans });
    chans.forEach((c, i) => {
      channelLabels[c] = `${prefix}${i + 1}`;
    });
    cursor = Math.max(cursor, ...chans.map((c) => c + 1));
  });
  for (let c = cursor; c < keep.length; c++) channelLabels[c] = `通道${c + 1}`;
  const waveConfig = {
    groups: newGroups,
    channelLabels,
    channelCount: keep.length,
  };

  // 3) 每发：保留全部弹速，波形去掉恒零通道 + 时间轴尾段抽稀
  const shots = g.shots.map((sh, si) => {
    const out = {
      idx: sh.idx,
      speed_mps: sh.speed_mps,
      dt_us: sh.dt_us,
      at_ms: sh.at_ms,
    };
    const chans = decoded[si];
    if (sh.wave && chans) {
      const picked = keep.map((c) => chans[c]);
      const dec = resample(sh.wave.times, picked, FINE_UNTIL_MS, COARSE_STRIDE);
      out.wave = {
        t0: sh.wave.t0,
        times: dec.times,
        channels: dec.channels.map(encodeF32),
      };
    }
    return out;
  });

  // 4) 靶纸散布：图、标定点、纸面尺寸全部原样搬过来
  let dispersion;
  if (g.dispersion) {
    dispersion = {
      ...g.dispersion,
      points: g.dispersion.points,
      texts: g.dispersion.texts,
    };
    imageBytes += g.dispersion.imageDataUrl?.length ?? 0;
  }

  groups.push({
    id: gi + 1,
    testId: 1,
    name: meta.name,
    params: { ...GROUP_PARAMS, note: meta.note },
    startedAt: g.startedAt,
    shots,
    waveConfig,
    ...(dispersion ? { dispersion } : {}),
  });
});

const startedAt = Math.min(...groups.map((g) => g.startedAt));
const demo = {
  version: 2,
  savedAt: Date.now(),
  tests: [
    {
      id: 1,
      name: DEMO_TEST_NAME,
      note: DEMO_TEST_NOTE,
      createdAt: startedAt,
      startedAt,
    },
  ],
  nextTestId: 2,
  nextGroupId: groups.length + 1,
  targetShots: session.targetShots ?? 100,
  // 组内自带配置，这里给一份同样的兜底
  waveConfig: groups[0].waveConfig,
  groups,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(demo));

const size = fs.statSync(OUT).size;
console.log(`源文件   : ${SRC}`);
console.log(`写出     : ${OUT}`);
console.log(
  `文件大小 : ${(size / 1024 / 1024).toFixed(2)} MB（靶纸图占 ${(imageBytes / 1024).toFixed(0)} KB）`
);
for (const g of groups) {
  const waveBytes = g.shots.reduce(
    (a, sh) =>
      a + (sh.wave ? sh.wave.channels.reduce((x, c) => x + c.length, 0) : 0),
    0
  );
  const chans = g.shots.find((s) => s.wave)?.wave.channels.length ?? 0;
  const pts = g.shots.find((s) => s.wave)?.wave.times.length ?? 0;
  const disp = g.dispersion
    ? ` | 靶纸 ${g.dispersion.imgW}×${g.dispersion.imgH} · ${g.dispersion.points.length} 点`
    : "";
  console.log(
    `  ${g.name} | ${g.shots.length} 发 | ${g.shots.filter((s) => s.wave).length} 发有波形 | ${chans} 通道 × ${pts} 点 | 波形 ${(waveBytes / 1024).toFixed(0)} KB${disp}`
  );
}
