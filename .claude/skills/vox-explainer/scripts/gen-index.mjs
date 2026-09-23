/**
 * gen-index.mjs —— 装配主时间轴 index.html + 产出接缝账本 ledger.json。
 *
 * 场景槽位数 = 项目帧数；`data-start` 由 slots.mjs 累加得出（**按槽位**，不含转场）；
 * `data-duration` = 槽位 + 该边界在账本里的**出幕转场时长**（接缝需要出幕纸在 cut 后继续在动）。
 * 旁白轨 track 10：data-start = 槽位起点 + NARRATION_LEAD，data-duration = wav 真实秒数。
 * 音效轨 track 11：稀疏标点，只在"画面发生了一件事"的位置出现，不铺床。
 *
 * 接缝（issues/20）：载体 = 整张纸（index 级 wrapper `#fNN`）。相邻 wrapper 的
 * `data-track-index` **0/1 交替** —— 它们时间上重叠（出幕 pad 出 exitDur），同 track 重叠即非法。
 * `ledger.json` 是**机器产物**（与 tools/assemble-table.json 同约定）：一行一个边界，
 * 默认技术为 `pull-sheet LEFT`；用可选的 `tools/seams.json` 按 `"NN→MM"` 覆盖 technique。
 *
 * ⚠️ 本文件含**上一项目的示例值**，新项目要改：
 *   1. slug 表默认从 `tools/frames-data.mjs` 的 FRAMES 取（取不到才回退内置表）；
 *   2. `SFX` 音效清单从可选的 `tools/sfx.json` 取，取不到则为空。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SLOTS, STARTS, TOTAL, VOICE } from "./slots.mjs";
import { loadTheme } from "./theme.mjs";
import { NARRATION_LEAD, RENDER_FPS } from "./motion-const.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// 画布底色来自项目根的 tools/theme.json（令牌源收敛，issues/13）——不要在生成器里写死。
const { theme: THEME, note: THEME_NOTE } = loadTheme(ROOT);
if (THEME_NOTE) console.log(`[theme] ${THEME_NOTE}`);
const PAPER = String(THEME.colors.paper).toLowerCase();

/** 内置回退 slug 表（freetoken 的历史值）；有 frames-data 就以它为准。 */
const FALLBACK_TITLES = {
  "01": "hook",
  "02": "problem",
  "03": "what-is",
  "04": "mech-image-in",
  "05": "mech-encoder-host",
  "06": "mech-quant-path",
  "07": "mech-kernel-switch",
  "08": "toolbox",
  "09": "pitfall",
  10: "demo-agent-vision",
  11: "demo-repair-ftw",
  12: "limits-and-start",
};

const framesDataPath = join(ROOT, "tools", "frames-data.mjs");
let SLUGS = FALLBACK_TITLES;
let TITLE = "";
if (existsSync(framesDataPath)) {
  try {
    const mod = await import(new URL(`file://${framesDataPath.replace(/\\/g, "/")}`).href);
    TITLE = mod.TITLE || "";
    if (Array.isArray(mod.FRAMES) && mod.FRAMES.length) {
      SLUGS = Object.fromEntries(mod.FRAMES.map((fr) => [fr.nn, fr.slug]));
    }
  } catch {
    /* 用回退表 */
  }
}

/** 音效清单：可选 tools/sfx.json（`[[name, at, why], …]`）；没有就空。 */
const sfxPath = join(ROOT, "tools", "sfx.json");
const SFX = existsSync(sfxPath) ? JSON.parse(readFileSync(sfxPath, "utf8")) : [];

/**
 * 纸 ASMR 清单：可选 tools/asmr.json（`[[slug, at, volume?], …]`）—— `slug` 对应
 * `.media/audio/asmr/asmr-<slug>.wav`。轨道 **12**（独立于音效轨 11，issues/19 §4）。
 * **落点纪律**：入点只落槽位余量（≈2.7s 静默），禁落进旁白窗口；3–8 处/片（违规只告警，不阻断生成）。
 */
const asmrPath = join(ROOT, "tools", "asmr.json");
const ASMR = existsSync(asmrPath) ? JSON.parse(readFileSync(asmrPath, "utf8")) : [];
const ASMR_VOLUME = 0.3; // 素材已归一到 −16dBFS；再压一档防爆音（规格 0.15–0.4）

/** 读 PCM wav 头拿真实秒数（ASMR 的 data-duration 用真值，不学音效轨写死 0.5）。 */
function wavDuration(path) {
  try {
    const b = readFileSync(path);
    if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return null;
    let i = 12;
    let rate = 0;
    let ch = 0;
    let bits = 0;
    let dataLen = null;
    while (i + 8 <= b.length) {
      const id = b.toString("ascii", i, i + 4);
      const size = b.readUInt32LE(i + 4);
      if (id === "fmt ") {
        ch = b.readUInt16LE(i + 10);
        rate = b.readUInt32LE(i + 12);
        bits = b.readUInt16LE(i + 22);
      } else if (id === "data") {
        dataLen = size;
        break;
      }
      i += 8 + size + (size % 2);
    }
    if (!rate || !ch || !bits || dataLen === null) return null;
    return dataLen / (rate * ch * (bits / 8));
  } catch {
    return null;
  }
}

// 3 位小数：足够接缝 pad（0.34/0.4），又不会写出 61.400000000000006（issues/20 §5.1）。
const f = (x) => String(Math.round(x * 1000) / 1000);

// ── 接缝账本（issues/20 §3/§4）：默认抽纸；可选 tools/seams.json 按 "NN→MM" 覆盖。
const TECHNIQUE_AXIS = {
  "pull-sheet": ["x", -1],
  "lift-sheet": ["y", -1],
  "drop-sheet": ["z", -1],
};
const EXIT_DUR = 0.34;
const ENTRY_DUR = 0.4;
const TRAVEL = 12; // ~12% 画幅
const seamsOverridePath = join(ROOT, "tools", "seams.json");
const seamsOverride = existsSync(seamsOverridePath)
  ? JSON.parse(readFileSync(seamsOverridePath, "utf8"))
  : {};
const NNS = Object.keys(SLOTS);
const seams = [];
for (let i = 0; i < NNS.length - 1; i += 1) {
  const a = NNS[i];
  const b = NNS[i + 1];
  const id = `${a}→${b}`;
  const ov = seamsOverride[id] || {};
  const technique = ov.technique || "pull-sheet LEFT";
  const key = Object.keys(TECHNIQUE_AXIS).find((k) => technique.startsWith(k)) || "pull-sheet";
  const [axis, dir] = TECHNIQUE_AXIS[key];
  seams.push({
    id,
    // 必须是 number（issues/14）：seam-gate 用 `cut + dt` 采样，字符串会拼成 `10.80.033…` 让注入表达式语法错。
    cut: Number(f(STARTS[b])),
    technique,
    exit: { selector: `#f${a}`, axis, dir, dur: ov.exitDur ?? EXIT_DUR, travel: TRAVEL },
    entry: { selector: `#f${b}`, axis, dir, dur: ov.entryDur ?? ENTRY_DUR, travel: TRAVEL },
  });
}
writeFileSync(
  join(ROOT, "ledger.json"),
  JSON.stringify({ fps: RENDER_FPS, seams }, null, 2) + "\n",
  "utf8",
);

/** 该 wrapper 的出幕转场时长（末帧无出幕 → 0）。 */
const exitDurOf = (nn) => {
  const seam = seams.find((s) => s.exit.selector === `#f${nn}`);
  return seam ? Number(seam.exit.dur) : 0;
};

const scenes = NNS.map((nn, i) => {
  const slug = SLUGS[nn];
  const dur = Number(SLOTS[nn]) + exitDurOf(nn); // 出幕纸继续在动（issues/20 §5.1）
  return `      <div id="f${nn}" class="clip"
           data-composition-id="frame-${nn}-${slug}"
           data-composition-src="compositions/frames/${nn}-${slug}.html"
           data-start="${f(STARTS[nn])}" data-duration="${f(dur)}"
           data-track-index="${i % 2}" data-width="1920" data-height="1080"></div>`;
}).join("\n");

let cursor = 0;
const voices = VOICE.map((l) => {
  const start = cursor + NARRATION_LEAD;
  cursor += SLOTS[l.frame];
  return `      <audio id="vo-${l.frame}" src="${l.wav}"
             data-start="${f(start)}" data-duration="${l.seconds}" data-track-index="10"></audio>`;
}).join("\n");

const sfx = SFX.map(
  ([name, at], i) =>
    `      <audio id="sfx-${String(i + 1).padStart(2, "0")}" src=".media/audio/sfx/${name}.mp3"
             data-start="${f(at)}" data-duration="0.5" data-track-index="11"></audio>`,
).join("\n");

// ── 纸 ASMR（轨道 12）：入点纪律见上。校验只告警（生成器不做门禁，门禁在 audit-frames）。
const asmrWindows = VOICE.map((l) => {
  const vStart = STARTS[l.frame] + NARRATION_LEAD;
  return { frame: l.frame, start: vStart, end: vStart + l.seconds };
});
let asmrViolations = 0;
const asmr = ASMR.map(([slug, at, vol], i) => {
  const src = `.media/audio/asmr/asmr-${slug}.wav`;
  const dur = wavDuration(join(ROOT, src)) ?? 0.5;
  if (!existsSync(join(ROOT, src)))
    console.warn(`[asmr] 缺素材 ${src}（先跑 gen-asmr / 通道 G 入库）`);
  const hit = asmrWindows.find((w) => at >= w.start - 0.001 && at < w.end);
  if (hit) {
    asmrViolations += 1;
    console.warn(
      `[asmr] 违规：${slug} 入点 ${at}s 落进 frame-${hit.frame} 旁白窗口 ${f(hit.start)}~${f(hit.end)}s —— 只许落槽位余量`,
    );
  }
  return `      <audio id="asmr-${String(i + 1).padStart(2, "0")}" src="${src}"
             data-start="${f(at)}" data-duration="${f(dur)}" data-track-index="12" data-volume="${vol ?? ASMR_VOLUME}"></audio>`;
}).join("\n");
if (ASMR.length && (ASMR.length < 3 || ASMR.length > 8)) {
  console.warn(`[asmr] 注意：${ASMR.length} 处（规格 3–8 处/片）`);
}

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-resolution="landscape">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <title>${TITLE}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :root {
        --paper: ${PAPER};
      }
      html,
      body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: ${PAPER}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${PAPER}; }
      .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <!-- 主时间轴。data-duration = 全部槽位之和（由 tools/slots.mjs 算出，不要手算）。 -->
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${f(TOTAL)}">
      <!-- ══ 场景槽位（${NNS.length} 个 = 项目帧数）══
           data-start 按**槽位**累加；data-duration = 槽位 + 出幕转场时长（接缝，见 ledger.json）。 -->
${scenes}

      <!-- ══ 旁白轨（track 10）══
           data-start = 槽位起点 + NARRATION_LEAD，data-duration = wav 真实秒数 -->
${voices}

      <!-- ══ 音效轨（track 11）：稀疏标点，不是垫床 ══ -->
${sfx}

      <!-- ══ 纸 ASMR 轨（track 12）：入点只落槽位余量、3–8 处/片、不 ducking 口播（issues/19 §4）══ -->
${asmr}
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

writeFileSync(join(ROOT, "index.html"), html, "utf8");
console.log(
  `index.html 写好：${NNS.length} 槽位 / 旁白 ${VOICE.length} 条 / 音效 ${SFX.length} 个 / 纸 ASMR ${ASMR.length} 处 · track 0/1 ping-pong`,
);
console.log(
  `ledger.json 写好：${seams.length} 个接缝（默认 pull-sheet LEFT，可用 tools/seams.json 覆盖）`,
);
console.log(`总长 ${TOTAL}s（旁白合计 ${VOICE.reduce((a, b) => a + b.seconds, 0).toFixed(3)}s）`);
