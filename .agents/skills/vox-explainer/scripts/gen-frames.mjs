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
import { loadTheme, renderTokenBlock } from "./theme.mjs";
import { MOTION_CONST, NARRATION_LEAD, DEFAULT_LEAD, RENDER_FPS } from "./motion-const.mjs";

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

/* 令牌来自项目根的 `tools/theme.json`（`init` 从 themes/<name>.json 复制）。
 **本文件不再另立写死的令牌值** —— 见 scripts/theme.mjs（issues/13 令牌源收敛）。 */
const { theme: THEME, note: THEME_NOTE } = loadTheme(ROOT);
if (THEME_NOTE) console.log(`[theme] ${THEME_NOTE}`);

const TOKENS = `
    html, body {
      margin: 0; padding: 0; width: 1920px; height: 1080px;
      overflow: hidden; background: ${String(THEME.colors.paper).toLowerCase()};
    }
    #root {
      position: relative;
      width: 1920px;
      height: 1080px;
${renderTokenBlock(THEME)}
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

/** KIT 组装：替 ID；**主题没有 accent 时移除 `.accent` 工具类**（否则引用不存在的令牌，
 *  会撞 `theme_token_drift` 方向 B —— issues/13 Q5）。 */
function applyKit(id, theme) {
  let kit = KIT.replace(/\{\{ID\}\}/g, id);
  if (!theme.colors.accent) kit = kit.replace(/\n\s*\.accent\s*\{[^}]*\}/, "");
  return kit;
}

/* ───────────────────── 拼贴纸面背景（A 组 + B2） ─────────────────────
 * 来源：`../vox-collage/issues/15` 第四~七轮（A1a 泛黄 / A1b 污渍 / A2 折痕 / A3 各向异性
 * 纤维 / B2 分层纸面），`gen-frames` 落地 —— 此前在 `issues/19` 记为"已知欠账"。
 *
 * 纪律：
 *   · **确定性**：只用 `hash1(n, seed)` 伪随机，**种子 = 帧号**；禁 `Math.random()`
 *     （同一时间点 seek 逐像素可复现 = 立场 #1）。
 *   · **主题驱动**：只有主题在 `layout` 里开了 `paper-layers` / `*-opacity` / `fiber` 才产出。
 *     `collage` 开；`paper` / `minimal-swiss` / `terminal-dark` 不开 ⇒ 4 部旧片与 paper 主题不受影响。
 *   · **不占行数预算**：样式进 `<style>`（`countStructuralLines` 会剥掉），标记按组压成极少数行。
 *   · **有意出血**：分层底纸铺满画幅、部分出框 ⇒ 容器标 `data-layout-allow-overflow`（门禁认的豁免）。
 */
function hash1(n, s) {
  const x = Math.sin(n * 127.1 + (s || 1) * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const COLLAGE_BG_CSS = `
    /* 拼贴纸面背景（种子 = 帧号）—— B2 分层底纸 / A1a 边缘泛黄 / A1b 污渍 / A2 折痕。
       整块 .bg 自成层叠上下文（z-index:0），永远在内容之后，不抢读、不动对比度。 */
    .bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
    .bg-paper { position: absolute; }
    .bg-paper-plate { position: absolute; inset: -6px -8px -11px -6px; background: var(--paper-shadow); opacity: 0.55; transform: rotate(0.5deg); }
    .bg-paper-face { position: absolute; inset: 0; }
    .bg-edge { position: absolute; }
    .bg-edge.t { left: 0; right: 0; top: 0; height: 86px; background: linear-gradient(to bottom, var(--paper-shadow), transparent); }
    .bg-edge.b { left: 0; right: 0; bottom: 0; height: 74px; background: linear-gradient(to top, var(--paper-shadow), transparent); }
    .bg-edge.l { top: 0; bottom: 0; left: 0; width: 92px; background: linear-gradient(to right, var(--paper-shadow), transparent); }
    .bg-edge.r { top: 0; bottom: 0; right: 0; width: 70px; background: linear-gradient(to left, var(--paper-shadow), transparent); }
    .bg-stain { position: absolute; transform: translate(-50%, -50%); background: radial-gradient(circle, var(--aging), transparent 72%); }
    .bg-crease { position: absolute; }
    .bg-crease.v { width: 7px; background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--ink) 8%, transparent) 42%, color-mix(in srgb, var(--paper) 30%, transparent) 52%, transparent 100%); }
    .bg-crease.h { height: 7px; background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--ink) 8%, transparent) 42%, color-mix(in srgb, var(--paper) 30%, transparent) 52%, transparent 100%); }`;

/** 主题是否启用拼贴纸面背景（`collage` 开；其余主题不开 —— 向后兼容，铁律 issues/01）。 */
function collageBgEnabled(theme) {
  const L = theme.layout || {};
  return (
    Number(L["paper-layers"] || 0) > 0 ||
    Number(L["aging-opacity"] || 0) > 0 ||
    Number(L["stain-opacity"] || 0) > 0 ||
    Number(L["crease-opacity"] || 0) > 0
  );
}

/** 纸纹层：各向异性「纤维」（collage）或各向同性「噪点」（默认）。 */
const GRAIN_ISOTROPIC = `%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E`;
const GRAIN_FIBER = `%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='180'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='420' height='180' filter='url(%23f)'/%3E%3C/svg%3E`;

/** 产出纸面背景标记（空串 = 主题未启用）。种子 = 帧号。 */
export function collageBackground(nn, theme) {
  if (!collageBgEnabled(theme)) return "";
  const L = theme.layout || {};
  const layers = Number(L["paper-layers"] || 0);
  const aging = Number(L["aging-opacity"] || 0);
  const stain = Number(L["stain-opacity"] || 0);
  const crease = Number(L["crease-opacity"] || 0);
  const seed = Number(nn) || 1;
  const groups = [];

  // B2 分层底纸：两张错位叠压（各带错位垫纸、不同纸色）
  if (layers > 0) {
    const specs = [
      { w: 1180, h: 1180, x: -130, y: -72, rot: -1.2, face: "var(--card)" },
      { w: 980, h: 1160, x: 1190, y: 46, rot: 1, face: "var(--paper-deep)" },
    ].slice(0, layers);
    groups.push(
      specs
        .map(
          (s) =>
            `<div class="bg-paper" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;transform:rotate(${s.rot}deg)"><div class="bg-paper-plate"></div><div class="bg-paper-face" style="background:${s.face}"></div></div>`,
        )
        .join(""),
    );
  }

  // A1a 边缘泛黄：四条边各一道线性渐变，强弱按帧号播种
  if (aging > 0) {
    groups.push(
      [
        ["t", 0, 0.055],
        ["b", 1, 0.042],
        ["l", 2, 0.048],
        ["r", 3, 0.034],
      ]
        .map(([cls, i0, base]) => {
          const o = base * (0.7 + Math.abs(hash1(i0 * 3 + 1, seed + 3)) * 0.6);
          return `<div class="bg-edge ${cls}" style="opacity:${o.toFixed(4)}"></div>`;
        })
        .join(""),
    );
  }

  // A1b 污渍：数量 3–5 / 位置 / 大小 / 不规则边界全部按帧号播种
  if (stain > 0) {
    const n = 3 + Math.round(Math.abs(hash1(1, seed + 11)) * 2);
    const blobs = [];
    for (let i = 0; i < n; i += 1) {
      let x = 8 + Math.abs(hash1(i * 13 + 1, seed)) * 80;
      let y = 10 + Math.abs(hash1(i * 13 + 2, seed)) * 74;
      let r = 130 + Math.abs(hash1(i * 13 + 3, seed)) * 170;
      if (i === 0) {
        // 至少一处靠近视觉重心（issues/15 第五轮 缺陷 3）
        x = 34 + Math.abs(hash1(2, seed + 5)) * 34;
        y = 30 + Math.abs(hash1(3, seed + 5)) * 26;
        r = 280;
      }
      const pts = [];
      for (let q = 0; q < 14; q += 1) {
        const a = (q / 14) * Math.PI * 2;
        const rr = 0.74 + Math.abs(hash1(i * 37 + q, seed + 23)) * 0.34;
        pts.push(
          `${(50 + Math.cos(a) * rr * 50).toFixed(1)}% ${(50 + Math.sin(a) * rr * 50).toFixed(1)}%`,
        );
      }
      blobs.push(
        `<div class="bg-stain" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${r.toFixed(0)}px;height:${(r * 0.72).toFixed(0)}px;opacity:${stain};clip-path:polygon(${pts.join(",")})"></div>`,
      );
    }
    groups.push(blobs.join(""));
  }

  // A2 折痕：2–4 道、横/纵、不贯穿全幅、带偏斜，全部按帧号播种
  if (crease > 0) {
    const n = 2 + Math.round(Math.abs(hash1(1, seed + 7)) * 2);
    const lines = [];
    for (let k = 0; k < n; k += 1) {
      const vert = hash1(k * 7 + 1, seed + 7) > 0;
      const cross = 6 + Math.abs(hash1(k * 7 + 2, seed + 7)) * 72;
      const sp = 4 + Math.abs(hash1(k * 7 + 3, seed + 7)) * 40;
      const ep = Math.min(94, sp + 26 + Math.abs(hash1(k * 7 + 4, seed + 7)) * 44);
      const rot = (hash1(k * 7 + 5, seed + 7) * 1.2).toFixed(1);
      const box = vert
        ? `left:${cross.toFixed(1)}%;top:${sp.toFixed(1)}%;height:${(ep - sp).toFixed(1)}%;transform:rotate(${rot}deg)`
        : `top:${cross.toFixed(1)}%;left:${sp.toFixed(1)}%;width:${(ep - sp).toFixed(1)}%;transform:rotate(${rot}deg)`;
      lines.push(
        `<div class="bg-crease ${vert ? "v" : "h"}" style="${box};opacity:${crease}"></div>`,
      );
    }
    groups.push(lines.join(""));
  }

  return `      <!-- 拼贴纸面背景（种子 = 帧号 ${seed}）：B2 分层底纸 + A1a 泛黄 + A1b 污渍 + A2 折痕 —— 有意出血，门禁豁免 -->
      <div class="bg" data-layout-allow-overflow aria-hidden="true">${groups.join("")}</div>`;
}

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

/* 动效契约 v2 的运行时库（issues/10 · 11 · 22）。
   注入每帧脚本；作者不 import。四个函数 `(sel, t, opts)`，与旧 7 助手同位置约定。 */
const MOTION_LIB = `
      // ── 动效契约 v2（issues/10 · 11 · 22）──────────────────────────────
      // 单一 onUpdate 分发器：一个 timeline 只有一个 onUpdate。若帧内已装 hw-boil，复用它。
      function hfOnUpdate(fn) {
        if (typeof window.hwOnUpdate === "function") { window.hwOnUpdate(tl, fn); return; }
        if (!tl.__hfRenders) {
          tl.__hfRenders = [];
          tl.eventCallback("onUpdate", function () {
            for (var i = 0; i < tl.__hfRenders.length; i += 1) tl.__hfRenders[i]();
          });
        }
        tl.__hfRenders.push(fn);
        fn();
      }
      // 只对 from/to 出现过的属性做数值插值；opacity 不参与停格。
      function hfLerp(els, from, to, p) {
        var keys = Object.keys(from).concat(Object.keys(to));
        for (var i = 0; i < keys.length; i += 1) {
          var k = keys[i];
          if (k === "opacity") continue;
          var d = k === "scale" ? 1 : 0;
          var a = from[k] === undefined ? d : from[k];
          var b = to[k] === undefined ? d : to[k];
          var o = {};
          o[k] = a + (b - a) * p;
          gsap.set(els, o);
        }
      }
      // assemble：停格装配（12fps 量化，只作用 QUANTIZE_PROPS），落定 = SETTLE_FRAMES 保持 + BOUNCE_PEAK 回弹。
      // 落定后 x/y/rotation/scale 永不再动 —— 别再对同一元素动这四个属性。
      function assemble(sel, t, opts) {
        opts = opts || {};
        var L = MC.LAYERS[opts.layer || "fact"] || MC.LAYERS.fact;
        var from = Object.assign({}, L.from, opts.from || {});
        var to = opts.to || {};
        var dur = opts.dur === undefined ? L.dur : opts.dur;
        var els = gsap.utils.toArray(sel);
        gsap.set(els, from);
        tl.set(els, { visibility: "visible" }, t);
        hfOnUpdate(function () {
          var now = tl.time();
          if (now < t) { hfLerp(els, from, to, 0); return; }
          var end = t + dur;
          if (now < end) {
            var q = Math.floor((now - t) * MC.FPS_QUANT + 1e-6) / MC.FPS_QUANT;
            hfLerp(els, from, to, Math.min(1, q / dur));
            return;
          }
          hfLerp(els, from, to, 1);
          var b1 = end + MC.SETTLE_FRAMES / MC.FPS_QUANT;
          if (now < b1) {
            var bp = (now - end) / (b1 - end);
            gsap.set(els, {
              scale: (to.scale === undefined ? 1 : to.scale) * (1 + (MC.BOUNCE_PEAK - 1) * (1 - bp)),
            });
          }
        });
      }
      // reveal：平滑揭示，逐条跟旁白。**内部强制打开 visibility**（issues/15 第一坑：只动 opacity 会永远不可见）。
      function reveal(sel, t, opts) {
        opts = opts || {};
        var from = Object.assign({ opacity: 0, y: 18 }, opts.from || {});
        var to = Object.assign({ opacity: 1, y: 0 }, opts.to || {});
        var dur = opts.dur === undefined ? 0.5 : opts.dur;
        var els = gsap.utils.toArray(sel);
        tl.set(els, { visibility: "visible" }, t);
        tl.fromTo(els, from, Object.assign({}, to, { duration: dur, ease: opts.ease || "power3.out" }), t);
      }
      // focus：信息聚焦，只作用容器，必须回位（out>0 由函数保证）。与停格分层：停格动元素，聚焦动容器。
      function focus(sel, t, opts) {
        opts = opts || {};
        var to = opts.to === undefined ? 1.16 : opts.to;
        var tin = opts.in === undefined ? MC.FOCUS_TIMING.in : opts.in;
        var hold = opts.hold === undefined ? MC.FOCUS_TIMING.hold : opts.hold;
        var tout = opts.out === undefined ? MC.FOCUS_TIMING.out : opts.out;
        if (!(tout > 0)) tout = MC.FOCUS_TIMING.out;
        var els = gsap.utils.toArray(sel);
        tl.fromTo(els, { scale: 1 }, { scale: to, duration: tin, ease: "power2.inOut" }, t);
        tl.to(els, { scale: 1, duration: tout, ease: "power2.inOut" }, t + tin + hold);
      }
      // closer：幕末收尾动作（stamp | taut-string | pull-mat）。pull-mat 同时就是接缝载体（issues/20）。
      function closer(sel, t, opts) {
        opts = opts || {};
        var g = opts.gesture || "stamp";
        var els = gsap.utils.toArray(sel);
        tl.set(els, { visibility: "visible" }, t);
        if (g === "stamp") {
          tl.fromTo(els, { opacity: 0, scale: 0.9, rotation: -4 },
            { opacity: 1, scale: 1, rotation: 0, duration: 0.32, ease: "power4.out" }, t);
        } else if (g === "taut-string") {
          tl.fromTo(els, { scaleX: 0.2 }, { scaleX: 1, duration: 0.4, ease: "power2.out" }, t);
        } else {
          tl.to(els, { x: -120, rotation: -6, duration: 0.5, ease: "power2.in" }, t);
        }
      }
`;

export function buildFrame({
  nn,
  slug,
  slot,
  css,
  body,
  script,
  dolly = true,
  // `paper` 参数已退役（issues/19 C2）：纸面层不再画网点，有/无该参数产出一致。
  cues = {},
  channelTag = "",
  frameCount = null,
}) {
  const id = `frame-${nn}-${slug}`;
  const dur = String(slot);
  // ── 纸面层（C2 · issues/15 四轮 → 落地 issues/19）：**纸面不再画均匀网点**。
  //    真实半调只出现在图像上，白纸没有网点；纸面质感靠纸色 + grain 层（+ 将来的污渍 /
  //    边缘泛黄 / 折痕 / 各向异性纤维，见 issues/19 已知欠账）。
  //    网点令牌 `halftone-*` 保留 —— 供**图像与垫纸**的半调用（不再落纸面）。
  //    曾经的 `paper:false` 分支只差这一层网点，现已无差别 ⇒ 参数退役、层始终存在
  //    （它承载 track 0 与时长契约）。
  const paperLayer = `      <div id="${id}-paper" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"></div>`;

  // 拼贴纸面背景（A 组 + B2）—— 主题未启用时是空串（paper 等主题零影响）。
  const bgCss = collageBgEnabled(THEME) ? COLLAGE_BG_CSS : "";
  const bgMarkup = collageBackground(nn, THEME);
  // 纸纹：collage 用各向异性纤维（A3）；其余主题保持各向同性噪点。
  const grainSvg = Number(THEME.layout["fiber"] || 0) > 0 ? GRAIN_FIBER : GRAIN_ISOTROPIC;

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
${applyKit(id, THEME)}
${autoPosition(css)}
${bgCss}
  </style>

  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${dur}">
${paperLayer}

    <div id="${id}-content" class="clip" data-start="0" data-duration="${dur}" data-track-index="1">
${bgMarkup}
      <div class="channel-tag">${channelTag}</div>
      <div class="frame-index">${nn} / ${frameCount === null ? Object.keys(SLOTS).length : frameCount}</div>
${body}
    </div>

    <div id="${id}-grain" class="clip" data-start="0" data-duration="${dur}" data-track-index="2"
      style="opacity:${THEME.layout["grain-opacity"]};background-image:url(&quot;data:image/svg+xml,${grainSvg}&quot;)"></div>
  </div>

  <script>
    (function () {
      const tl = gsap.timeline();
      const SLOT = ${dur};
      // 动效契约常量（issues/22）—— 由生成器注入，作者不 import。
      const MC = ${JSON.stringify(MOTION_CONST)};
      const NARRATION_LEAD = ${NARRATION_LEAD};
      const DEFAULT_LEAD = ${DEFAULT_LEAD};
      // 线索时间来自 tools/cue-times.json（faster-whisper 词级对齐真值），构建时注入。
      const CUE = ${JSON.stringify(cues)};
      // at(k) = 帧内秒点（issues/11 Q1）：wav 相对秒 + 旁白入点 − 提前量。
      const at = (k, lead = DEFAULT_LEAD) =>
        Math.max(0, (CUE[k] === undefined ? 0 : CUE[k]) + NARRATION_LEAD - lead);

      // ── 旧 7 助手（rise/slide/drop/stamp/fade/draw/show）**deprecated**（issues/22 §5）：
      //    保留仅为 4 部已交付项目可复现。新帧请用 assemble() / reveal() / focus() / closer()。

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
${MOTION_LIB}
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

/** 从作者脚本里静态扫出装配表条目（issues/22 §3·Q7：构建期本就全知道每一件的 cue）。 */
function collectAssemble(scriptText, cues) {
  const atOf = (key) =>
    Math.max(0, (cues[key] === undefined ? 0 : cues[key]) + NARRATION_LEAD - DEFAULT_LEAD);
  const r3 = (x) => Number(x.toFixed(3));
  const entries = [];
  let closerAt = null;
  const callRe =
    /\bassemble\(\s*["'`]([^"'`]+)["'`]\s*,\s*at\(\s*["'`]([^"'`]+)["'`]\s*\)\s*,\s*\{([^}]*)\}/g;
  for (const m of scriptText.matchAll(callRe)) {
    const opts = m[3];
    const layer = (opts.match(/layer\s*:\s*["'`]([a-z]+)["'`]/) || [])[1] || "fact";
    const durM = opts.match(/dur\s*:\s*([\d.]+)/);
    const layerDef = MOTION_CONST.LAYERS[layer] || MOTION_CONST.LAYERS.fact;
    const dur = durM ? Number(durM[1]) : layerDef.dur;
    const cueAt = atOf(m[2]);
    entries.push({
      sel: m[1],
      tier: layer,
      cueKey: m[2],
      cueAt: r3(cueAt),
      settleAt: r3(cueAt + dur + MOTION_CONST.SETTLE_FRAMES / MOTION_CONST.FPS_QUANT),
    });
  }
  const closerRe = /\bcloser\(\s*["'`][^"'`]+["'`]\s*,\s*at\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const m of scriptText.matchAll(closerRe)) closerAt = r3(atOf(m[1]));
  return { entries, closerAt };
}

/* ───────────────────────── 12 帧 ───────────────────────── */

const FRAMES_MODULE = await import("./frames-data.mjs");
const FRAMES = FRAMES_MODULE.FRAMES;
// 频道标签来自项目自己的 frames-data（issues/22 rule 26：不再写死品牌与分母）。
const CHANNEL_TAG = FRAMES_MODULE.CHANNEL_TAG || "";
const CUE_TIMES = JSON.parse(
  (await import("node:fs")).readFileSync(join(ROOT, "tools", "cue-times.json"), "utf8"),
);

/* ───────────────────────── 运动侧车（每帧必产） ───────────────────────── */

/* 侧车语义 v2（issues/10 Q12 · issues/22 §5）：`from_rest` / `still_moving` 从"描述"改成"断言"——
   **entry 必须中途入场（`from_rest:false`）、幕末必须落在收尾动作中（`still_moving:true`）**，
   这样出/入幕的载体一直在动、能过 `seam-gate`。值不再逐帧写，由 `sidecarAssertion()` 归一化并自检。 */
const MOTION = {
  "01": {
    rules: ["kinetic-beat-slam", "spring-pop-entrance"],
    entry: { vector: "up (大字从上方 70px 砸入；中途入场，上一幕载体仍在动)" },
    exit: { vector: "down (红圈收笔，帧根仍在极缓推轨 —— 幕末落在 closer 动作中)" },
    notes:
      "红圈路径的 dash 在 skeleton 线索处画出；帧根推轨 1.0→1.05 跨满整幕（**不由 crossfade 覆盖 —— index.html 没有 crossfade**）。",
  },
  "02": {
    rules: ["waterfall-entry", "vox-annotate"],
    entry: { vector: "right (三张卡依次从左侧弹入；中途入场)" },
    exit: { vector: "up (第三张卡的红圈收笔，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes: "卡三的正文较长，字号压到 29px 以保证不溢出卡内容盒。",
  },
  "03": {
    rules: ["depth-scatter-assemble", "center-outward-expansion"],
    entry: { vector: "up (品牌大字从上砸入；中途入场)" },
    exit: { vector: "down (右分支红框收笔，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "8 枚 expert 方块用 backgroundColor tween 点亮（不是换 class），以便 seek 可复现；材料为 README About 段的 2× 实拍裁切。",
  },
  "04": {
    rules: ["depth-scatter-assemble", "spring-pop-entrance"],
    entry: { vector: "right (三枚协议芯片依次弹入；中途入场)" },
    exit: { vector: "right (右下角红勾收笔，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "材料用的是 cli.md 的 Image input 段落裁切（2490×430），viewBox = 该文件自身像素空间，手绘坐标按图内像素写。",
  },
  "05": {
    rules: ["waterfall-entry", "vox-annotate"],
    entry: { vector: "up (标题落下，HOST 条随后出现；中途入场)" },
    exit: { vector: "down (encoder cache 标注落下，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "两块权重的搬迁用 fromTo 的 x/y 位移实现（不是改 left/top），搬迁结束后把这两块设为 opacity:0，再由 GPU 框内的两个 slot 承接——避免同一时刻出现两份方块。",
  },
  "06": {
    rules: ["anchored-layout-expand", "svg-path-draw"],
    entry: { vector: "up (标题落下，BEFORE 框随后出现；中途入场)" },
    exit: { vector: "up (结论行落下，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "BEFORE 侧的 per-family 分支只画了 4 个家族（与 models.md 的家族数一致），不暗示只有这四个。",
  },
  "07": {
    rules: ["center-outward-expansion", "spring-pop-entrance"],
    entry: { vector: "up (标题落下，旋钮随后弹入；中途入场)" },
    exit: { vector: "down (第二张改名卡划掉，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes: "黄笔高亮用两枚绝对定位的色块（不是 CSS background），以便按线索时间单独入场。",
  },
  "08": {
    rules: ["waterfall-entry", "spring-pop-entrance"],
    entry: { vector: "right (材料从右侧甩入；中途入场)" },
    exit: { vector: "up (右下注释落下，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "材料是 cli.md 的 Image input flags 表裁切（2490×1210）；三条红笔分别落在 --image-min/max-tokens、--mm-encoder-weights、--allowed-media-domains 三行。",
  },
  "09": {
    rules: ["css-marker-patterns", "spring-pop-entrance"],
    entry: { vector: "right (红色警告条从左侧滑入；中途入场)" },
    exit: { vector: "left (页脚引文落下，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "--text-model-only 的高亮用 background-color tween；材料是 ftw-hotfix.md 的 What breaks 表裁切，红圈落在最后一行 holds no vision encoder tensors。",
  },
  10: {
    rules: ["discrete-text-sequence", "cursor-click-ripple"],
    entry: { vector: "right (终端块从左侧甩入；中途入场)" },
    exit: { vector: "up (右下红字落下，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes:
      "命令的'逐字打出'用光标位移表达（不真做逐字打字机），落地时间严格对齐 cmd-enter 线索；涟漪用 border-radius:50% 的几何圆（唯一允许的圆）。",
  },
  11: {
    rules: ["discrete-text-sequence", "svg-path-draw"],
    entry: { vector: "right (终端块与标题同时落位；中途入场)" },
    exit: { vector: "up (材料上 --out 行划过，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes: "分片追加与索引原子替换是两个独立节拍，分别对齐 shard-append 与 index-swap。",
  },
  12: {
    rules: ["waterfall-entry", "svg-path-draw"],
    entry: { vector: "up (标题落下，五条限制逐条落下；中途入场)" },
    exit: { vector: "down (红勾落在结论卡上，载体仍在动 —— 幕末落在 closer 动作中)" },
    notes: "本帧不用材料（结论帧以排版 + 命令块为主）；47.7 GiB 的蓝底衬是全帧唯一的 accent 蓝。",
  },
};

/**
 * 侧车断言归一化（issues/10 Q12 · issues/22 §5）：
 * 契约要求每帧 entry 中途入场、幕末仍在动 —— 值不写进 MOTION 表，由这里统一补上并自检，
 * 防止回到 `from_rest:true / still_moving:false` 的旧语义（那会让接缝闸量到 0 速度）。
 */
function sidecarAssertion(nn, motion) {
  const entry = { ...motion.entry, from_rest: false };
  const exit = { ...motion.exit, still_moving: true };
  if (entry.from_rest !== false || exit.still_moving !== true) {
    throw new Error(`frame ${nn} sidecar 断言不合契约（见 issues/22 §5）`);
  }
  return { entry, exit };
}

mkdirSync(OUT, { recursive: true });
// 装配表（issues/22 §3）：机器产物、不许手改，与 tools/cue-times.json 同约定。
const assembleTable = { fps: RENDER_FPS, frames: {} };
let n = 0;
for (const f of FRAMES) {
  const slot = SLOTS[f.nn];
  if (!slot) throw new Error(`no slot for frame ${f.nn}`);
  const key = Object.keys(CUE_TIMES).find((k) => k.startsWith(f.nn + "-"));
  if (!key) throw new Error(`no cue-times entry for frame ${f.nn}`);
  const cues = {};
  for (const c of CUE_TIMES[key].cues) cues[c.id] = c.t;
  const id = `frame-${f.nn}-${f.slug}`;
  const html = buildFrame({ ...f, slot, cues, channelTag: CHANNEL_TAG });
  writeFileSync(join(OUT, `${f.nn}-${f.slug}.html`), html, "utf8");
  const { entries, closerAt } = collectAssemble(f.script || "", cues);
  assembleTable.frames[`${f.nn}-${f.slug}`] = { slot, closerAt, entries };
  const m = MOTION[f.nn];
  if (!m) throw new Error(`no motion sidecar spec for frame ${f.nn}`);
  const { entry, exit } = sidecarAssertion(f.nn, m);
  writeFileSync(
    join(OUT, `${f.nn}-${f.slug}.motion.json`),
    JSON.stringify(
      {
        scene: id,
        duration_s: slot,
        bgSeed: Number(f.nn) || 1,
        rules: m.rules,
        exit,
        entry,
        notes: m.notes,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    `  ${f.nn}-${f.slug}  slot=${slot}s  线索 ${Object.keys(cues).length} 条  + motion.json`,
  );
  n += 1;
}
writeFileSync(
  join(ROOT, "tools", "assemble-table.json"),
  JSON.stringify(assembleTable, null, 2) + "\n",
  "utf8",
);
console.log(`wrote ${n} frames (+ motion sidecars) -> compositions/frames/`);
console.log(`wrote tools/assemble-table.json（${Object.keys(assembleTable.frames).length} 帧）`);
