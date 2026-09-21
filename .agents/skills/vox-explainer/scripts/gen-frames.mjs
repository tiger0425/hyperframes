/**
 * gen-frames.mjs — 按 `tools/frames-data.mjs` 生成「该项目自己的帧数」份 frame HTML + 等量侧车。
 *
 * 为什么用生成器而不是手抄 N 份：字体块、泄漏守卫、reveal pass、四层时长结构、`position` 补齐
 * 是**契约的一部分**，抄错一处就是静默失败（见 `references/pitfalls.md` §4/§5/§7/§16）。
 * 这里把契约部分写一次，每帧只提供"属于它自己的东西"：CSS、markup、时间轴。
 *
 * 时间轴纪律（要"画面元素跟着旁白出现"就用这条）：
 *   每帧的 tween 位置读 `at('<线索名>')`，而 CUE 表由本文件在**构建时**从
 *   `tools/cue-times.json` 注入 —— 那个文件是 faster-whisper 词级时间戳对齐出来的真值。
 *   **不要在帧里写死秒数**，也不要按固定间隔铺。做法见 `references/voice-sync.md`。
 *
 * ⚠️ 本文件从 `freetoken-v013-vox` 提升而来，含**上一项目的示例值**，新项目要改三处：
 *   1. `MOTION` 映射（逐帧的 rules / entry / exit / notes）—— 每个项目自己的内容；
 *   2. `FONTS` 里的字体文件、`TOKENS` / `KIT` 里的令牌（默认值来自 paper 主题，一般不用改）；
 *   3. 本文件 import 的 `./frames-data.mjs` —— 那是**逐帧 CSS + markup + 时间轴**，
 *      新项目新建一份（可照 `projects/freetoken-v013-vox/tools/frames-data.mjs` 的结构写）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inkCircle, inkUnderline, inkArrow, inkCheck, inkSlash, inkRect } from "./ink.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const OUT = join(ROOT, "compositions", "frames");

export { SLOTS, STARTS, TOTAL } from "./slots.mjs";
import { SLOTS } from "./slots.mjs";

/* ───────────────────────── 共享 CSS 套件 ───────────────────────── */

const FONTS = `
    /* 规范字体块：全项目只有这一套，指向 assets/fonts/ 的真实文件。 */
    @font-face {
      font-family: "Noto Sans SC";
      src: url("assets/fonts/NotoSansSC-VF.ttf") format("truetype-variations");
      font-weight: 100 900; font-style: normal; font-display: block;
    }
    @font-face {
      font-family: "JetBrains Mono";
      src: url("assets/fonts/JetBrainsMono-400.woff2") format("woff2");
      font-weight: 400; font-style: normal; font-display: block;
    }
    @font-face {
      font-family: "JetBrains Mono";
      src: url("assets/fonts/JetBrainsMono-700.woff2") format("woff2");
      font-weight: 700; font-style: normal; font-display: block;
    }
    @font-face {
      font-family: "Caveat";
      src: url("assets/fonts/Caveat-700-latin.woff2") format("woff2");
      font-weight: 700; font-style: normal; font-display: block;
    }
    @font-face {
      font-family: "Microsoft YaHei";
      src: local("Microsoft YaHei"), local("MicrosoftYaHei");
      font-weight: 100 900; font-style: normal; font-display: block;
    }`;

const TOKENS = `
    html, body {
      margin: 0; padding: 0; width: 1920px; height: 1080px;
      overflow: hidden; background: #f1ede4;
    }
    #root {
      position: relative;
      width: 1920px;
      height: 1080px;
      --paper: #f1ede4;
      --paper-deep: #e3dccc;
      --paper-shadow: #ded6c4;
      --ink: #121212;
      --ink-soft: #514c44;
      --rule: #c9c2b4;
      --accent: #1d4ed8;
      --signal: #e23a2e;
      --marker: #ffd400;
      --margin: 96px;
      --gutter: 32px;
    }`;

const KIT = `
    [data-composition-id="{{ID}}"] {
      background: var(--paper);
      color: var(--ink);
      font-family: "Noto Sans SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
      font-weight: 400;
      line-height: 1.5;
    }
    /* 禁止项：不用渐变、阴影、圆角、玻璃拟态、emoji、纯白帧底 */
    [data-composition-id="{{ID}}"] * { box-sizing: border-box; border-radius: 0; }

    .channel-tag, .frame-index {
      position: absolute; top: var(--margin);
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-weight: 500; font-size: 22px; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--ink-soft);
    }
    .channel-tag { left: var(--margin); }
    .frame-index { right: var(--margin); font-variant-numeric: tabular-nums; }

    .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
    .hl { position: absolute; left: var(--margin); font-weight: 900; letter-spacing: -0.02em; line-height: 1.08; }
    .note { font-family: "Caveat", "Noto Sans SC", cursive; font-weight: 700; color: var(--signal); }

    .card { position: absolute; background: var(--paper-deep); border: 3px solid var(--ink); }
    .chip {
      position: absolute; border: 3px solid var(--ink); background: var(--paper);
      font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums;
      display: flex; align-items: center; justify-content: center; text-align: center;
    }
    .kwd { font-family: "JetBrains Mono", ui-monospace, monospace; background: var(--marker); padding: 0 8px; }
    .kw  { font-family: "JetBrains Mono", ui-monospace, monospace; }
    .accent { color: var(--accent); }
    .soft { color: var(--ink-soft); }
    .sig { color: var(--signal); }
    .rule-b { border-bottom: 1px solid var(--rule); }
    .rule-t { border-top: 3px solid var(--ink); }
    .plate { position: absolute; background: var(--ink); color: var(--paper); }
    .badge {
      position: absolute; border: 2px solid var(--signal); color: var(--signal);
      font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase; padding: 2px 10px;
    }

    /* 材料：错位垫纸做"纸做的阴影"（零 box-shadow），手绘 SVG 覆盖层与 img 同盒 */
    .mat { position: absolute; isolation: isolate; }
    .mat-paper {
      position: absolute; inset: -14px -14px -18px -14px; z-index: 0;
      background: var(--paper-shadow); transform: rotate(0.7deg);
    }
    .mat img { display: block; width: 100%; height: auto; position: relative; z-index: 1; }
    .mat svg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; pointer-events: none; }
    .mat-frame { position: absolute; inset: 0; border: 3px solid var(--ink); z-index: 3; pointer-events: none; }
    .sc { fill: none; stroke: var(--signal); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
    .sc-thin { fill: none; stroke: var(--signal); stroke-width: 3; stroke-linecap: round; }
    .sc-light { fill: none; stroke: var(--paper); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }

    /* 入场隐藏：**visibility，不是 opacity**（pitfalls §5）。动画的位移/淡入交给 opacity。*/
    #root .js-hide { visibility: hidden; }`;

/* ───────────────────────── 组装 ───────────────────────── */

/**
 * 版心制的兜底：本管线只用绝对定位排版（VOX 版心），凡是写了 left/top 却没有
 * position 的规则，一律补上 position: absolute —— 漏写会让元素落回普通流，
 * 静默地堆在帧顶（这正是一次实测事故：12 帧里有几十个元素堆叠）。
 */
export function autoPosition(css) {
  const touched = [];
  const out = css.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, sel, decls) => {
    if (/position\s*:/.test(decls)) return whole;
    if (!/(^|[;{\s])(left|top|right|bottom|inset)\s*:/.test(decls)) return whole;
    touched.push(sel.trim());
    return `${sel}{ position: absolute;${decls} }`;
  });
  if (touched.length) {
    console.log(`      [autoPosition] 补 position:absolute -> ${touched.join(" | ")}`);
  }
  return out;
}

export function material({ id, src, left, top, width, vb, paths = [], cls = "" }) {
  const svg = paths.length
    ? `\n        <svg viewBox="${vb}" preserveAspectRatio="none">${paths
        .map((p) => `\n          <path class="${p.cls || "sc"}" id="${id}-${p.id}" d="${p.d}"/>`)
        .join("")}\n        </svg>`
    : "";
  return `      <div class="mat ${cls}" id="${id}" style="left:${left}px;top:${top}px;width:${width}px" data-layout-allow-overflow>
        <div class="mat-paper"></div>
        <img src="${src}" alt="">
        <div class="mat-frame"></div>${svg}
      </div>`;
}

const REVEAL_PASS = `      /* hf-js-hide-reveal-pass — 集成块，原样保留（pitfalls §4）。
         为每个 .js-hide 元素在其自身动画首次触及的时刻注册零时长揭示；
         从未被任何 tween 触及的元素在 0 处揭示（宁可早出现，也不能静默丢弃内容）。
         揭示的属性必须与 CSS 的隐藏属性配对：CSS 用 visibility: hidden，这里写 visibility: "visible"。 */
      (function () {
        var scoped = document.querySelectorAll("#root .js-hide");
        if (!scoped.length) return;
        var firstTouch = new Map();
        tl.getChildren(false, true, true).forEach(function (child) {
          var targets = typeof child.targets === "function" ? child.targets() : [];
          for (var i = 0; i < targets.length; i += 1) {
            var node = targets[i];
            if (!node || node.nodeType !== 1 || !node.classList || !node.classList.contains("js-hide")) continue;
            var start = child.startTime();
            var known = firstTouch.get(node);
            if (known === undefined || start < known) firstTouch.set(node, start);
          }
        });
        for (var j = 0; j < scoped.length; j += 1) {
          var el = scoped[j];
          var at = firstTouch.get(el);
          tl.set(el, { visibility: "visible" }, at === undefined ? 0 : at);
        }
      })();
      /* end hf-js-hide-reveal-pass */`;

export function buildFrame({ nn, slug, slot, css, body, script, dolly = true, paper = true, cues = {} }) {
  const id = `frame-${nn}-${slug}`;
  const dur = String(slot);
  const paperLayer = paper
    ? `      <div id="${id}-paper" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
           style="background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Ccircle cx='2.2' cy='2.2' r='1.15' fill='%23121212' fill-opacity='0.12'/%3E%3C/svg%3E&quot;)"></div>`
    : `      <div id="${id}-paper" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"></div>`;

  const dollyJs = dolly
    ? `      // ── 连续推轨：本帧根。选择器必须是 [data-composition-id="…"] 限定形（pitfalls §3）。
      tl.fromTo('[data-composition-id="${id}"]',
        { scale: 1, x: 0, y: 0 },
        { scale: 1.05, x: -16, y: -10, duration: SLOT - 0.8, ease: "none" }, 0.2);`
    : "";

  return `<template>
  <style>
    /* hf-scene-visibility-leak-guard — 集成块，原样保留，别删（pitfalls §5） */
    [data-composition-id="${id}"][style*="visibility: hidden"] * ,
    [data-composition-id="${id}"][style*="visibility: hidden"] {
      visibility: hidden !important;
    }
${FONTS}
${TOKENS}
${KIT.replace(/\{\{ID\}\}/g, id)}
${autoPosition(css)}
  </style>

  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${dur}">
${paperLayer}

    <div id="${id}-content" class="clip" data-start="0" data-duration="${dur}" data-track-index="1">
      <div class="channel-tag">FREETOKEN · V0.1.3</div>
      <div class="frame-index">${nn} / 12</div>
${body}
    </div>

    <div id="${id}-grain" class="clip" data-start="0" data-duration="${dur}" data-track-index="2"
      style="opacity:0.13;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E&quot;)"></div>
  </div>

  <script>
    (function () {
      const tl = gsap.timeline();
      const SLOT = ${dur};
      // 线索时间来自 tools/cue-times.json（faster-whisper 词级对齐真值），构建时注入。
      const CUE = ${JSON.stringify(cues)};
      const at = (k, lead = 0) => Math.max(0, (CUE[k] === undefined ? 0 : CUE[k]) - lead);

      // 手绘逐笔画出：getTotalLength() 的 dash。必须在 seek(0) 之前注册。
      // 路径带 .js-hide（CSS visibility:hidden），这里用 tl.set 在 t 处揭示 —— 不能提前可见。
      function ink(sel, t, dur = 0.7) {
        document.querySelectorAll("#root " + sel).forEach(function (p) {
          const len = p.getTotalLength();
          gsap.set(p, { strokeDasharray: len + " " + len * 1.06, strokeDashoffset: len });
          tl.set(p, { visibility: "visible" }, t);
          tl.to(p, { strokeDashoffset: 0, duration: dur, ease: "power2.out" }, t);
        });
      }

      // 入场四式：全部是 fromTo（自建基线，不依赖 .js-hide 的揭示约定），
      // 元素在 t 之前保持 CSS 的 visibility:hidden —— 这就是"与旁白同步"的机制。
      function rise(sel, t, dy, dur) {
        tl.fromTo(sel, { opacity: 0, y: dy || 34 }, { opacity: 1, y: 0, duration: dur || 0.5, ease: "power3.out" }, t);
      }
      function slide(sel, t, dx, dur) {
        tl.fromTo(sel, { opacity: 0, x: dx || 60 }, { opacity: 1, x: 0, duration: dur || 0.55, ease: "power4.out" }, t);
      }
      function drop(sel, t, dy) {
        tl.fromTo(sel, { opacity: 0, y: dy === undefined ? -46 : dy, scale: 1.05 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power4.out" }, t);
      }
      function stamp(sel, t, dur) {
        tl.fromTo(sel, { opacity: 0, scale: 0.62 }, { opacity: 1, scale: 1, duration: dur || 0.48, ease: "back.out(2.4)" }, t);
      }
      function fade(sel, t, dur) {
        tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: dur || 0.45, ease: "power2.out" }, t);
      }
      function draw(sel, t, dur) {
        gsap.set(sel, { transformOrigin: "0% 50%" });
        tl.fromTo(sel, { scaleX: 0 }, { scaleX: 1, duration: dur || 0.5, ease: "power2.out" }, t);
      }
      // 只做位移、不做透明度：用于"深底上的文字"，避免对比度审计在淡入中途采样到低对比。
      function show(sel, t, dy) {
        tl.set(sel, { visibility: "visible" }, t);
        tl.fromTo(sel, { y: dy === undefined ? 20 : dy }, { y: 0, duration: 0.45, ease: "power3.out" }, t);
      }

${dollyJs}
${script}
      tl.seek(0);

${REVEAL_PASS}

      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
`;
}

/* ───────────────────────── 12 帧 ───────────────────────── */

const FRAMES = (await import("./frames-data.mjs")).FRAMES;
const CUE_TIMES = JSON.parse(
  (await import("node:fs")).readFileSync(join(ROOT, "tools", "cue-times.json"), "utf8"),
);

/* ───────────────────────── 运动侧车（每帧必产） ───────────────────────── */

const MOTION = {
  "01": { rules: ["kinetic-beat-slam", "spring-pop-entrance"],
    entry: { vector: "up +0px/s at first frame (大字从上方 70px 砸入，帧根尚未推轨)", from_rest: true },
    exit: { vector: "down +0px/s at last frame (红圈收笔后画面静止，帧根仍在极缓推轨)", still_moving: false },
    notes: "红圈路径的 dash 在 skeleton 线索处画出；帧根推轨 1.0→1.05 由 index.html 的 crossfade 覆盖。" },
  "02": { rules: ["waterfall-entry", "vox-annotate"],
    entry: { vector: "right +0px/s at first frame (三张卡依次从左侧弹入)", from_rest: true },
    exit: { vector: "up +0px/s at last frame (第三张卡的红圈收笔，画面静止)", still_moving: false },
    notes: "卡三的正文较长，字号压到 29px 以保证不溢出卡内容盒。" },
  "03": { rules: ["depth-scatter-assemble", "center-outward-expansion"],
    entry: { vector: "up +0px/s at first frame (品牌大字从上砸入)", from_rest: true },
    exit: { vector: "down +0px/s at last frame (右分支红框收笔后静止)", still_moving: false },
    notes: "8 枚 expert 方块用 backgroundColor tween 点亮（不是换 class），以便 seek 可复现；材料为 README About 段的 2× 实拍裁切。" },
  "04": { rules: ["depth-scatter-assemble", "spring-pop-entrance"],
    entry: { vector: "right +0px/s at first frame (三枚协议芯片依次弹入)", from_rest: true },
    exit: { vector: "right +0px/s at last frame (右下角红勾收笔，画面静止)", still_moving: false },
    notes: "材料用的是 cli.md 的 Image input 段落裁切（2490×430），viewBox = 该文件自身像素空间，手绘坐标按图内像素写。" },
  "05": { rules: ["waterfall-entry", "vox-annotate"],
    entry: { vector: "up +0px/s at first frame (标题落下，HOST 条随后出现)", from_rest: true },
    exit: { vector: "down +0px/s at last frame (encoder cache 标注落下后静止)", still_moving: false },
    notes: "两块权重的搬迁用 fromTo 的 x/y 位移实现（不是改 left/top），搬迁结束后把这两块设为 opacity:0，再由 GPU 框内的两个 slot 承接——避免同一时刻出现两份方块。" },
  "06": { rules: ["anchored-layout-expand", "svg-path-draw"],
    entry: { vector: "up +0px/s at first frame (标题落下，BEFORE 框随后出现)", from_rest: true },
    exit: { vector: "up +0px/s at last frame (结论行落下后静止)", still_moving: false },
    notes: "BEFORE 侧的 per-family 分支只画了 4 个家族（与 models.md 的家族数一致），不暗示只有这四个。" },
  "07": { rules: ["center-outward-expansion", "spring-pop-entrance"],
    entry: { vector: "up +0px/s at first frame (标题落下，旋钮随后弹入)", from_rest: true },
    exit: { vector: "down +0px/s at last frame (第二张改名卡划掉后静止)", still_moving: false },
    notes: "黄笔高亮用两枚绝对定位的色块（不是 CSS background），以便按线索时间单独入场。" },
  "08": { rules: ["waterfall-entry", "spring-pop-entrance"],
    entry: { vector: "right +0px/s at first frame (材料从右侧甩入)", from_rest: true },
    exit: { vector: "up +0px/s at last frame (右下注释落下后静止)", still_moving: false },
    notes: "材料是 cli.md 的 Image input flags 表裁切（2490×1210）；三条红笔分别落在 --image-min/max-tokens、--mm-encoder-weights、--allowed-media-domains 三行。" },
  "09": { rules: ["css-marker-patterns", "spring-pop-entrance"],
    entry: { vector: "right +0px/s at first frame (红色警告条从左侧滑入)", from_rest: true },
    exit: { vector: "left +0px/s at last frame (页脚引文落下后静止)", still_moving: false },
    notes: "--text-model-only 的高亮用 background-color tween；材料是 ftw-hotfix.md 的 What breaks 表裁切，红圈落在最后一行 holds no vision encoder tensors。" },
  "10": { rules: ["discrete-text-sequence", "cursor-click-ripple"],
    entry: { vector: "right +0px/s at first frame (终端块从左侧甩入)", from_rest: true },
    exit: { vector: "up +0px/s at last frame (右下红字落下后静止)", still_moving: false },
    notes: "命令的'逐字打出'用光标位移表达（不真做逐字打字机），落地时间严格对齐 cmd-enter 线索；涟漪用 border-radius:50% 的几何圆（唯一允许的圆）。" },
  "11": { rules: ["discrete-text-sequence", "svg-path-draw"],
    entry: { vector: "right +0px/s at first frame (终端块与标题同时落位)", from_rest: true },
    exit: { vector: "up +0px/s at last frame (材料上 --out 行划过之后静止)", still_moving: false },
    notes: "分片追加与索引原子替换是两个独立节拍，分别对齐 shard-append 与 index-swap。" },
  "12": { rules: ["waterfall-entry", "svg-path-draw"],
    entry: { vector: "up +0px/s at first frame (标题落下，五条限制逐条落下)", from_rest: true },
    exit: { vector: "down +0px/s at last frame (红勾落在结论卡上，尾部定格 1.6s)", still_moving: false },
    notes: "本帧不用材料（结论帧以排版 + 命令块为主）；47.7 GiB 的蓝底衬是全帧唯一的 accent 蓝。" },
};

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of FRAMES) {
  const slot = SLOTS[f.nn];
  if (!slot) throw new Error(`no slot for frame ${f.nn}`);
  const key = Object.keys(CUE_TIMES).find((k) => k.startsWith(f.nn + "-"));
  if (!key) throw new Error(`no cue-times entry for frame ${f.nn}`);
  const cues = {};
  for (const c of CUE_TIMES[key].cues) cues[c.id] = c.t;
  const id = `frame-${f.nn}-${f.slug}`;
  const html = buildFrame({ ...f, slot, cues });
  writeFileSync(join(OUT, `${f.nn}-${f.slug}.html`), html, "utf8");
  const m = MOTION[f.nn];
  if (!m) throw new Error(`no motion sidecar spec for frame ${f.nn}`);
  writeFileSync(
    join(OUT, `${f.nn}-${f.slug}.motion.json`),
    JSON.stringify({ scene: id, duration_s: slot, rules: m.rules, exit: m.exit, entry: m.entry, notes: m.notes }, null, 2) + "\n",
    "utf8",
  );
  console.log(`  ${f.nn}-${f.slug}  slot=${slot}s  线索 ${Object.keys(cues).length} 条  + motion.json`);
  n += 1;
}
console.log(`wrote ${n} frames (+ motion sidecars) -> compositions/frames/`);
