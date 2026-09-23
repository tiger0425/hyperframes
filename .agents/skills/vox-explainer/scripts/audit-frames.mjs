#!/usr/bin/env node
/**
 * audit-frames.mjs — 静态扫出 vox-explainer 已知的静默失败。
 *
 * 为什么需要它：这条管线的坑有一个共同特征 —— **静默失败**。命令报 ok、渲染出成片、
 * 看起来没坏，但内容错了或根本没出现。日志里看不出来，只能靠静态扫描。
 *
 * 覆盖（编号对应 references/pitfalls.md）：
 *   §3  相机推轨选择器写错（裸 #root / #root[data-composition-id=…] 会静默失效）
 *   §4  .js-hide 元素没有任何 tween 触及（内容整块消失）
 *   §5  用 visibility 隐藏（场景泄漏）/ 缺 leak guard
 *   §6  字体策略漂移（base64 内嵌 / 族名不在规范集）
 *   §7  帧内多于或少于 4 处 data-duration（四处时长契约）
 *   §8  可见文本里出现 /*（触发 visible_markup_comment error）
 *   —   composition id 与文件名不符 / 与 index.html 槽位对不上（静默不同步）
 *   —   .clip 层缺稳定 id（Studio studio_missing_editable_id）
 *   —   缺 motion.json 侧车（集成时无法判断 entry/exit 矢量）
 *
 * 用法：
 *   node audit-frames.mjs [--project .] [--json]
 * 退出码：0 = 无 finding，1 = 有 finding，2 = 用法/环境错误
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCTS, tierFor, resolveLevel } from "./gate-tier.mjs";

/** 本脚本所在目录（门禁脚本一律在 `tools/vox/`）—— 用于回指同项目的作者侧生成器。 */
const HERE = dirname(fileURLToPath(import.meta.url));

// ── 规范字体族（pitfalls §6）：任何在字体栈里出现的族名都必须有 @font-face 声明
const CANONICAL_FAMILIES = ["Noto Sans SC", "JetBrains Mono", "Caveat", "Microsoft YaHei"];

/**
 * `focus()` 契约常量（issues/10 Q7–Q10 · issues/22 §4）。
 * **单一来源是作者侧的 `scripts/motion-const.mjs`（`MOTION_CONST`）**；但门禁住在 `tools/vox/`、
 * 作者模块住在 `tools/` —— 目录边界禁止门禁 import 作者模块（gate 与 authoring 分工见 _contract.md §5），
 * 所以这里复写同一组值。**改值必须两处同改。**
 */
const FOCUS_MODE = ["push", "window"];
const FOCUS_TRIGGER = { fontSizePxLt: 24 };
const LAYER_ORDER = ["ground", "fact", "trim"];

/** 「墨色」判定（issues/19 `ink_full_rim`）：`var(--ink)` 或一个足够暗的十六进制色。 */
function isInkColor(value) {
  if (/var\(\s*--ink\s*\)/.test(value)) return true;
  for (const m of value.matchAll(/#([0-9A-Fa-f]{3,8})\b/g)) {
    const h = m[1];
    const norm =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h.slice(0, 6);
    if (!/^[0-9A-Fa-f]{6}$/.test(norm)) continue;
    const r = parseInt(norm.slice(0, 2), 16);
    const g = parseInt(norm.slice(2, 4), 16);
    const b = parseInt(norm.slice(4, 6), 16);
    if ((r + g + b) / 3 / 255 < 0.22) return true;
  }
  return false;
}

const FRAME_ID_RE = /^frame-(\d{2})-([a-z0-9-]+)$/;

function parseArgs(argv) {
  const out = { project: process.cwd(), frame: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--frame") out.frame = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) out.project = a;
    else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

/** 找到 index.html 里每个槽位：composition id -> { 槽位时长, wrapper 时长, start }。
 *  槽位 = 下一段 `data-start` − 本段 `data-start`（**不含出幕转场 pad**，issues/20 §5.1）；末段用 wrapper 时长。 */
function readSlots(project) {
  const indexPath = join(project, "index.html");
  if (!existsSync(indexPath)) return { index: null, slots: new Map() };
  const html = readFileSync(indexPath, "utf8");
  const rows = [];
  const tagRe = /<div\b[^>]*data-composition-src="[^"]*"[^>]*>/g;
  for (const m of html.matchAll(tagRe)) {
    const tag = m[0];
    const cid = tag.match(/data-composition-id="([^"]+)"/)?.[1];
    const dur = tag.match(/data-duration="([\d.]+)"/)?.[1];
    const start = tag.match(/data-start="([\d.]+)"/)?.[1];
    if (cid && dur) {
      rows.push({
        cid,
        wrapperDuration: Number(dur),
        start: start === undefined ? null : Number(start),
      });
    }
  }
  // 文档顺序**未必**按 start 排（实测 freetoken 不是）——先按 start 排序再差分。
  rows.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  const slots = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const next = rows[i + 1];
    const duration =
      next && r.start !== null && next.start !== null
        ? Number((next.start - r.start).toFixed(3))
        : r.wrapperDuration;
    slots.set(r.cid, { duration, wrapperDuration: r.wrapperDuration, start: r.start });
  }
  return { index: html, slots };
}

/** 剥掉 <style> 与 <script>，只看可见标记 */
function visibleMarkup(html) {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

/** 剥掉脚本里的注释（行注释 + 块注释），避免把"解释这条坑的注释"当成违规 */
function stripJsComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function auditFrame(project, file, text, slots, findings, ctx = {}) {
  const rel = `compositions/frames/${file}`;
  const add = (level, rule, message, hint) =>
    findings.push({ level, rule, file: rel, message, hint });

  const stem = basename(file, ".html");
  const nameMatch = stem.match(/^(\d{2})-([a-z0-9-]+)$/);
  if (!nameMatch) {
    add(
      "error",
      "frame_filename_shape",
      `文件名不符合 NN-slug.html 契约`,
      "重命名为 01-hook.html 形态",
    );
  }

  // ── composition id：必须是 frame-NN-slug，与文件名一致
  const rootCid =
    text.match(/id="root"\s+data-composition-id="([^"]+)"/)?.[1] ??
    text.match(/data-composition-id="(frame-[^"]+)"/)?.[1];
  if (!rootCid) {
    add(
      "error",
      "missing_composition_id",
      "帧内找不到 data-composition-id",
      '根节点需带 data-composition-id="frame-NN-slug"',
    );
  } else {
    if (!FRAME_ID_RE.test(rootCid)) {
      add(
        "error",
        "composition_id_shape",
        `composition id "${rootCid}" 不符合 frame-NN-slug`,
        "见 references/_contract.md §1",
      );
    }
    if (rootCid !== `frame-${stem}`) {
      add(
        "error",
        "composition_id_filename_mismatch",
        `composition id "${rootCid}" 与文件名 frame-${stem} 不符`,
        "sync/audit 都靠这个正则对齐，写错会静默不同步",
      );
    }
  }

  const slot = rootCid ? slots.get(rootCid) : undefined;
  if (slots.size > 0 && rootCid && !slot) {
    add(
      "error",
      "frame_not_in_index",
      `index.html 里没有 ${rootCid} 的槽位`,
      "index.html 的 data-composition-id 必须等于帧的 composition id",
    );
  }

  // ── §7 时长：**每一处**都必须等于槽位。
  //    层数不是判据 —— 没有 grain 层的帧只有 3 处是合法的（实测 12 帧里 4 处/3 处都有）。
  //    真正的不变量只有一个：所有 data-duration 都等于槽位。
  const durations = [...text.matchAll(/data-duration="([\d.]+)"/g)].map((m) => Number(m[1]));
  if (slot) {
    const stale = [...new Set(durations.filter((d) => Math.abs(d - slot.duration) > 1e-6))];
    if (stale.length > 0) {
      add(
        "error",
        "duration_stale",
        `帧内时长 ${stale.join(", ")} 与槽位 ${slot.duration} 不符`,
        "跑 scripts/sync-frame-durations.mjs（不带 --check）",
      );
    }
  }
  if (durations.length < 2) {
    add(
      "warning",
      "duration_layer_count",
      `只找到 ${durations.length} 处 data-duration`,
      "至少应有帧根 + 内容层；见 references/pitfalls.md §7",
    );
  }

  // ── §3 相机推轨选择器
  //    只在**脚本的 tween / querySelector 调用**里查，且先剥注释——
  //    否则帧里解释这条坑的注释本身会被误报。
  const scriptAt = text.indexOf("<script>");
  const script = stripJsComments(scriptAt === -1 ? "" : text.slice(scriptAt));

  // (a) 带帧 id 但前面多写了 #root —— 编译器改写后匹配不到，静默失效
  for (const m of script.matchAll(/(["'`])(#root\s*\[data-composition-id=[^"'`]*?)\1/g)) {
    add(
      "error",
      "dolly_selector_root_prefixed",
      `选择器 "${m[2]}" 以 #root 开头会静默失效`,
      "改用 '[data-composition-id=\"…\"]'（不加 #root 前缀）— pitfalls §3",
    );
  }
  // (b) 裸 #root 作为动画目标或 query 目标 —— 会命中 index.html 主根，把整片一起缩放
  const DANGEROUS_CALL =
    /\b(?:gsap\s*\.\s*(?:fromTo|to|from|set|timeline)|querySelector(?:All)?|getElementById)\s*\(\s*(["'`])#root\1/g;
  for (const _m of script.matchAll(DANGEROUS_CALL)) {
    add(
      "error",
      "bare_root_selector",
      `动画/查询目标写成了裸 #root`,
      "裸 #root 会命中 index.html 的主根，把整片一起缩放 — pitfalls §3",
    );
  }
  // (c) 注意：CSS 里的 `#root .foo { … }` 是合法的（限定在自己帧内），不报。

  // ── §5 隐藏/揭示的属性必须配对
  const styleAt = text.indexOf("<style>");
  const styleEnd = text.indexOf("</style>");
  const style = styleAt === -1 ? "" : text.slice(styleAt, styleEnd === -1 ? undefined : styleEnd);
  const markup = visibleMarkup(text);

  /** 从 <style> 里剥掉 leak guard 整块（按花括号配平，不用会误判的正则） */
  function stripLeakGuard(css) {
    const marker = css.indexOf("hf-scene-visibility-leak-guard");
    if (marker === -1) return css;
    // 从 marker 往后找到第一个 '{'，然后按深度配平到它的 '}'
    const open = css.indexOf("{", marker);
    if (open === -1) return css;
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return css.slice(0, marker) + " " + css.slice(i + 1);
      }
    }
    return css.slice(0, marker);
  }
  const styleNoGuard = stripLeakGuard(style);

  // 帧内自定义规则里出现 visibility: visible 会逃出隐藏祖先（宿主是 visibility: hidden）→ 泄漏
  if (/visibility\s*:\s*visible/.test(styleNoGuard)) {
    add(
      "error",
      "visibility_visible_escape",
      "样式表里出现 visibility: visible",
      "帧级隐藏与揭示一律走 .js-hide + reveal pass；自定义 visibility:visible 会逃出隐藏宿主造成泄漏 — pitfalls §5",
    );
  }

  const jsHideCss = style.match(/\.js-hide\s*\{([^}]*)\}/)?.[1] ?? null;
  const usesVisibilityHide = jsHideCss !== null && /visibility\s*:\s*hidden/.test(jsHideCss);
  const hasRevealPass = /hf-js-hide-reveal-pass/.test(text);

  if (usesVisibilityHide && !hasRevealPass) {
    add(
      "error",
      "missing_js_hide_reveal_pass",
      ".js-hide 用 visibility 隐藏，但没有 reveal pass",
      "补 hf-js-hide-reveal-pass（见 templates/frame-skeleton.html）— pitfalls §4",
    );
  }
  if (hasRevealPass && jsHideCss !== null && !usesVisibilityHide) {
    if (/opacity\s*:\s*0/.test(jsHideCss)) {
      add(
        "error",
        "js_hide_opacity_hide",
        ".js-hide 用 opacity:0 隐藏",
        "opacity:0 的元素在冷渲染/布局审计里仍占位可见 = 泄漏本身。改用 visibility: hidden — pitfalls §5",
      );
    } else {
      add(
        "warning",
        "js_hide_hide_property_unknown",
        ".js-hide 的隐藏属性既不是 visibility 也不是 opacity",
        "确认 reveal pass 揭示的属性与这里配对 — pitfalls §5",
      );
    }
  }
  if (/visibility\s*:\s*hidden/.test(style) && !/hf-scene-visibility-leak-guard/.test(text)) {
    add(
      "error",
      "missing_leak_guard",
      "用了 visibility: hidden 但没有 leak guard 集成块",
      "补 hf-scene-visibility-leak-guard（见 templates/frame-skeleton.html）— pitfalls §5",
    );
  }
  // 守卫的前提是帧内确实用 visibility 隐藏；若守卫在而隐藏被换成 opacity，守卫变成空操作
  if (/hf-scene-visibility-leak-guard/.test(text) && jsHideCss !== null && !usesVisibilityHide) {
    add(
      "warning",
      "leak_guard_noop",
      "leak guard 在，但 .js-hide 已不是 visibility 隐藏",
      "守卫会变成空操作，泄漏会悄悄回来 — pitfalls §5",
    );
  }

  // ── 悬空 id 引用：JS 拿 id 去找元素，但标记里没有那个 id ──
  //
  // 这是本项目实际踩到的一个渲染期崩溃：
  //   TypeError: Cannot read properties of null (reading 'getTotalLength')
  // 作者把标注从三个圈改成两个，但没同步动画配置里的选择器，于是
  // `document.querySelector(s.el)` 返回 null，下一行 `.getTotalLength()`
  // 直接抛错 —— 整帧脚本中止，**那一帧的所有动效都不再注册**。
  //
  // lint 与原规则都看不见它：标记与元数据完全合法，错在 JS 与标记脱节。
  // 只有真实浏览器渲染才暴露，而本沙箱跑不了浏览器，所以静态查这一条价值很高。
  //
  // 三种写法都要覆盖 —— 只查直接传给 querySelector 的字符串是不够的，
  // 本项目就是用配置数组的 `el:` 属性间接传的：
  //   1. getElementById("x")
  //   2. querySelector("#x")
  //   3. { el: "#x", … } 配置数组，再由 querySelector(s.el) 消费
  const idRefs = [];
  for (const m of script.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]/g)) idRefs.push(m[1]);
  for (const m of script.matchAll(/querySelector(?:All)?\(\s*["'`]#([A-Za-z0-9_-]+)["'`]/g))
    idRefs.push(m[1]);
  for (const m of script.matchAll(/\bel\s*:\s*["'`]#([A-Za-z0-9_-]+)["'`]/g)) idRefs.push(m[1]);
  for (const id of [...new Set(idRefs)]) {
    const has = new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(markup);
    if (!has) {
      add(
        "error",
        "dangling_id_reference",
        `JS 引用了 #${id}，但标记里没有这个 id`,
        "重命名元素后必须同步更新动画里的选择器；否则 querySelector 返回 null、脚本抛错、整帧动效不注册（只在渲染期暴露）",
      );
    }
  }

  // ── 复合选择器「类名存在，但组合不命中」
  //
  // 【为什么必须查这一条】实测的静默失败：
  //   作者把 choice 卡的三行写成 `#frame-05-mech-primitives-c1 .orow`，
  //   而 `.orow` 只存在于 c2 卡里。类名 `.orow` 在文件里**确实存在**，
  //   所以"类名是否存在"这种粗查一路放行；GSAP 拿到空目标集合后**不报错、不抛异常**，
  //   只是那一组动画永远不发生 —— 与 pitfalls §3（推轨选择器写错会静默失效）同一家族，
  //   只是从"漏了限定前缀"变成"指错了父节点"。
  //   运行期唯一的痕迹是一条 console 警告（GSAP target not found），它不会让 check 失败。
  //
  // 判据：把 `#id` 限定的朴素后代选择器拆开，取 `#id` 那个元素的**整棵子树**，
  //   要求后代部分（.cls / tag）真的出现在这棵子树里。
  //   子树用标签深度扫描取得 —— 契约已禁止"注释里放真实元素"（_contract.md §4），扫描是安全的。
  const VOID_TAGS = new Set([
    "img",
    "br",
    "hr",
    "meta",
    "link",
    "input",
    "source",
    "area",
    "base",
    "col",
    "embed",
    "track",
    "wbr",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "use",
    "stop",
  ]);
  const elementBlock = (html, idName) => {
    const at = html.search(new RegExp(`id="${idName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    if (at < 0) return null;
    const start = html.lastIndexOf("<", at);
    if (start < 0) return null;
    const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|[^>"])*)>/g;
    tagRe.lastIndex = start;
    let depth = 0;
    let t = tagRe.exec(html);
    while (t) {
      const closing = t[1] === "/";
      const selfClosing = /\/\s*$/.test(t[3]) || VOID_TAGS.has(t[2].toLowerCase());
      if (closing) depth -= 1;
      else if (!selfClosing) depth += 1;
      if (depth <= 0) return html.slice(start, tagRe.lastIndex);
      t = tagRe.exec(html);
    }
    return html.slice(start);
  };
  const scopedSelectors = new Set();
  for (const m of script.matchAll(/["'`](#[A-Za-z0-9_-]+(?:\s+[^"'`,)]+)?)["'`]/g)) {
    const sel = m[1];
    if (!/\s/.test(sel)) continue; // 裸 #id：上面那条已查
    if (/[[\]:*$^>~+]/.test(sel)) continue; // 只处理朴素后代形
    scopedSelectors.add(sel);
  }
  for (const sel of scopedSelectors) {
    const [idPart, ...rest] = sel.trim().split(/\s+/);
    const block = elementBlock(text, idPart.slice(1));
    if (!block) continue; // 缺 id 已由 dangling_id_reference 报过
    for (const part of rest) {
      const hit = part.startsWith(".")
        ? new RegExp(`class="[^"]*\\b${part.slice(1)}\\b`).test(block)
        : new RegExp(`<${part}\\b`).test(block);
      if (!hit) {
        add(
          "error",
          "selector_miss_within_scope",
          `选择器 "${sel}" 的后代部分 "${part}" 不在 #${idPart.slice(1)} 的子树里`,
          "GSAP 拿到空目标集合会静默跳过（不报错、不抛异常），那组动效永远不发生 — pitfalls §3",
        );
      }
    }
  }

  // 注：旧的「motion_frontload 扫 tl.to() 字面量」已删除 —— 新语的 `assemble()` 让第三参不再是
  // 字面量，那条规则必然静默熄灭。改读 `tools/assemble-table.json`，落在 `main()` 的项目级块里
  // （issues/11 Q7 · issues/22 §6 规则 7/8/21）。

  // ── §4 .js-hide 元素必须被某个 tween 触及（否则只在 reveal pass 的 0 处揭示）
  const jsHideEls = [...markup.matchAll(/class="[^"]*\bjs-hide\b[^"]*"[^>]*id="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const jsHideById = [...markup.matchAll(/id="([^"]+)"[^>]*class="[^"]*\bjs-hide\b[^"]*"/g)].map(
    (m) => m[1],
  );
  const jsHideIds = [...new Set([...jsHideEls, ...jsHideById])];

  // ── §4a js-hide 与 tween 的关系
  //
  // 【为什么这里不做"漏了揭示"的判定】
  // 曾经写过一个规则去推断"元素被 tween 触及但没有 visibility:visible 语句"。
  // 用真实项目回归后**误报 38 处** —— 作者用变量间接引用（`var mark = getElementById(...)`
  // 然后 `tl.set(mark, {visibility:"visible"})`）、条件分支、循环批量揭示，
  // 静态正则根本跟不住。而在这个沙箱里又跑不了浏览器门禁（禁命名管道）来自证。
  //
  // 一个误报会让人开始忽略整个检查器 —— 那比不检查更糟。所以这条**改为只报告事实**，
  // 判定交给两条可靠的手段：`check` 的布局审计，以及**亲眼看快照**（verification.md §7）。
  if (jsHideIds.length > 0 && hasRevealPass) {
    const tweened = jsHideIds.filter(
      (id) => script.includes(`#${id}`) || script.includes(`"${id}"`),
    );
    add(
      "info",
      "js_hide_reveal_ownership",
      `.js-hide 元素 ${jsHideIds.length} 个：约 ${tweened.length} 个自有 tween（作者自行揭示），${jsHideIds.length - tweened.length} 个靠 reveal pass 在首次触及处揭示`,
      "本条不做判定（静态分析易误报）。请用快照肉眼确认这些元素确实出现过 — pitfalls §4 / verification.md §7",
    );
  }

  // ── §8 可见文本里出现 /*
  if (/\/\*/.test(markup)) {
    add(
      "error",
      "visible_markup_comment",
      "可见标记里出现 /*",
      '用 CSS 生成内容表达，如 .globstars::after{content:"**"}；不要用 &#42; 实体 — pitfalls §8',
    );
  }

  // ── §6 字体策略
  const faces = [...style.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  if (faces.length === 0) {
    add(
      "warning",
      "missing_font_faces",
      "帧内没有 @font-face 声明",
      "lint 要求任何在字体栈里出现的族名都有声明 — pitfalls §6",
    );
  }
  for (const face of faces) {
    if (/base64/i.test(face)) {
      add(
        "error",
        "font_face_base64",
        "@font-face 用了 base64 内嵌",
        "全项目统一为 assets/fonts/ 文件引用 — pitfalls §6",
      );
    }
    const fam = face.match(/font-family\s*:\s*["']?([^;"']+)/)?.[1]?.trim();
    if (fam && !CANONICAL_FAMILIES.includes(fam)) {
      add(
        "error",
        "font_face_drift",
        `@font-face 声明了非规范族名 "${fam}"`,
        `规范集：${CANONICAL_FAMILIES.join(" / ")} — pitfalls §6`,
      );
    }
  }

  // ── .clip 层缺稳定 id
  const clipTags = [...markup.matchAll(/<div\b[^>]*class="[^"]*\bclip\b[^"]*"[^>]*>/g)].map(
    (m) => m[0],
  );
  for (const tag of clipTags) {
    if (!/\bid="[^"]+"/.test(tag)) {
      add(
        "info",
        "clip_missing_id",
        "一条 .clip 层没有稳定 id",
        '加 id="<composition-id>-<layer>"（Studio 需要，否则报 studio_missing_editable_id）',
      );
    }
  }

  // ── 帧数一致性由 index 侧统计，这里只看侧车
  // ── motion.json 侧车
  const motionPath = join(project, "compositions", "frames", `${stem}.motion.json`);
  if (!existsSync(motionPath)) {
    add(
      "warning",
      "missing_motion_sidecar",
      `缺 ${stem}.motion.json 侧车`,
      "侧车承载 entry/exit 矢量，是多帧连成一次连续镜头的依据 — templates/frame.motion.json",
    );
  } else {
    const raw = readFileSync(motionPath, "utf8");
    for (const key of ["scene", "duration_s", "rules", "exit", "entry"]) {
      if (!raw.includes(`"${key}"`)) {
        add(
          "warning",
          "motion_sidecar_incomplete",
          `${stem}.motion.json 缺字段 "${key}"`,
          "见 templates/frame.motion.json",
        );
      }
    }
    try {
      const parsed = JSON.parse(raw);
      if (slot && Math.abs(Number(parsed.duration_s) - slot.duration) > 1e-6) {
        add(
          "error",
          "motion_sidecar_duration_drift",
          `${stem}.motion.json duration_s=${parsed.duration_s} 与槽位 ${slot.duration} 不符`,
          "侧车的 duration_s 需随槽位对齐 —— 运行 node tools/vox/sync-frame-durations.mjs 即可自动同步",
        );
      }
      // ── 侧车断言（issues/10 Q12 · issues/22 §5 · 规则 23）：v2 项目（有 ledger.json）里
      //    `from_rest` / `still_moving` 不是描述而是**断言** —— entry 必须中途入场、幕末必须仍在动
      //    （幕末落在 closer 动作中，载体才能过 seam-gate 的 cut±0.1s 采样）。缺 ledger → 只 info（分档）。
      const dec = resolveLevel(ctx.tier, ["ledger"], "error");
      if (dec.applicable) {
        if (parsed.entry?.from_rest !== false) {
          add(
            "error",
            "motion_sidecar_assertion",
            `${stem}.motion.json entry.from_rest=${JSON.stringify(parsed.entry?.from_rest ?? null)}（须为 false：中途入场）`,
            "侧车字段是断言不是描述 —— entry 必须中途入场、幕末必须在 closer 动作中（issues/10 Q12 · issues/22 §5）",
          );
        }
        if (parsed.exit?.still_moving !== true) {
          add(
            "error",
            "motion_sidecar_assertion",
            `${stem}.motion.json exit.still_moving=${JSON.stringify(parsed.exit?.still_moving ?? null)}（须为 true：幕末仍在动）`,
            "幕末载体必须还动着，否则接缝闸会在 cut±0.1s 量到 0 速度（issues/20 §5.3 · issues/22 §5）",
          );
        }
      }
    } catch {
      add(
        "error",
        "motion_sidecar_invalid_json",
        `${stem}.motion.json 不是合法 JSON`,
        "修 JSON 语法",
      );
    }
  }

  // ── 生成图只做氛围（issues/12 · issues/23 §3）：`gen-` 资产不得落事实容器。
  //    静态判定 = class 白名单 + `data-material` 兜底；"最近定位祖先"取 img 自身与最近的块级开标签。
  {
    const MOOD = ["mood", "mat-bg", "torn-layer", "plate-bg", "bg-layer"];
    const FACT = ["mat", "card", "startblk", "chip"];
    for (const m of markup.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)) {
      const src = m[1];
      if (!/(^|\/)gen-/.test(src)) continue;
      const before = markup.slice(0, m.index);
      const tags = [...before.matchAll(/<(?:div|figure|section|article)\b[^>]*>/g)];
      const probe = `${m[0]} ${tags.length ? tags[tags.length - 1][0] : ""}`;
      const hasMood =
        /data-material="mood"/.test(probe) ||
        MOOD.some((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(probe));
      const hasFact =
        /data-material="fact"/.test(probe) ||
        FACT.some((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(probe));
      if (hasFact && !hasMood) {
        add(
          "error",
          "gen_asset_in_fact_container",
          `生成图 ${src} 落在事实容器里（.mat/.card 等）`,
          "生成图只做氛围/材质/转场，永不做事实（issues/12 · issues/23 §3）",
        );
      }
    }
  }

  // ── 焦点声明（issues/13 Q6 + issues/24）：**仅 v2 项目**（有 tools/theme.json）。
  //    40% 阈值必须由**帧自身** data-width×data-height 推导，禁写死 1920×1080（issues/24）。
  if (ctx.hasTheme) {
    const fw = Number(text.match(/data-width="(\d+)"/)?.[1] ?? 0);
    const fh = Number(text.match(/data-height="(\d+)"/)?.[1] ?? 0);
    const focusEls = [...markup.matchAll(/<[^>]*\bdata-focus\b[^>]*>/g)].map((m) => m[0]);
    if (focusEls.length !== 1) {
      add(
        "error",
        "focus_declaration",
        `带 data-focus 的元素有 ${focusEls.length} 个（应恰好 1 个）`,
        "每帧恰一个焦点元素；见 references/visual-grammar.md",
      );
    } else {
      const el = focusEls[0];
      if (!/\bid="[^"]+"/.test(el)) {
        add(
          "error",
          "focus_declaration",
          "data-focus 元素没有 id（无法被 selector 指到）",
          "给焦点元素一个稳定 id",
        );
      }
      const w = Number(el.match(/\bwidth\s*:\s*(\d+)px/)?.[1] ?? 0);
      const h = Number(el.match(/\bheight\s*:\s*(\d+)px/)?.[1] ?? 0);
      if (fw > 0 && fh > 0 && w > 0 && h > 0) {
        const ratio = (w * h) / (fw * fh);
        if (ratio < 0.4) {
          add(
            "error",
            "focus_declaration",
            `焦点元素占帧 ${(ratio * 100).toFixed(0)}%（应 ≥40%；帧 ${fw}×${fh} 自身推导）`,
            "放大焦点元素或换焦点（issues/13 Q6 · issues/24）",
          );
        }
      } else {
        add(
          "info",
          "focus_declaration_ratio_unknown",
          "焦点元素尺寸无法静态量（无内联 width/height）",
          "本规则只到 info；用 check 的布局审计或快照确认尺寸（verification.md §7）",
        );
      }
      add(
        "info",
        "focus_contrast_block",
        "「唯一最大对比块」不做静态判定（check 只在固定秒点采样，硬判必误报）",
        "交人眼/快照（issues/13 Q6 · verification.md §7）",
      );
    }
  }

  // ── focus() 契约（issues/10 Q7–Q10 · issues/22 §4·§6 规则 25）：**只看时间维度与调用形状**，
  //    与 focus_declaration（静态声明存在性）不重复判。仅对 v2 生成器项目（有装配表）成立。
  //    已知边界：FOCUS_TRIGGER 的 ②（旁白 ≥2 次）③（在场 ≥3s）是运行期事实，静态判不了 ——
  //    只硬判 ① 字号（且仅在静态可解时），②③ 交对拍快照（hf.mjs snapshot --pair，verification.md §9）。
  {
    const dec = resolveLevel(ctx.tier, ["assembleTable"], "error");
    if (dec.applicable) {
      const calls = [
        ...script.matchAll(
          /\bfocus\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(?:at\s*\(\s*["'`][^"'`]*["'`]\s*\)|[\w.$]+)\s*,\s*\{([^}]*)\}/g,
        ),
      ];
      for (const m of calls) {
        const sel = m[2];
        const opts = m[3];
        const mode = opts.match(/\bmode\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
        if (mode && !FOCUS_MODE.includes(mode)) {
          add(
            "error",
            "focus_contract",
            `focus("${sel}") 的 mode="${mode}" 不在 [${FOCUS_MODE.join(" | ")}]`,
            "镜头词汇只有 push（推近）与 window（区域放大）— issues/10 Q8",
          );
        }
        const outRaw = opts.match(/\bout\s*:\s*(-?[\d.]+)/)?.[1];
        if (outRaw !== undefined && !(Number(outRaw) > 0)) {
          add(
            "error",
            "focus_contract",
            `focus("${sel}") 的 out=${outRaw}（必须 > 0：出镜必须回位）`,
            "不回位会丢掉下一屏的空间参照 — issues/10 Q9 · issues/22 §4",
          );
        }
        const id = sel.match(/^#([A-Za-z0-9_-]+)$/)?.[1];
        const block = id ? elementBlock(text, id) : null;
        if (block) {
          const inner = block.slice(block.indexOf(">") + 1);
          if (!/<(?!\/)[a-zA-Z]/.test(inner)) {
            add(
              "error",
              "focus_contract",
              `focus("#${id}") 指向叶子元素（没有子元素）`,
              "聚焦只作用于容器（帧组 / 材料组），不得指向信息元素自身 — issues/10 Q10",
            );
          }
          const sizes = [];
          for (const mm of block.matchAll(/\bfont-size\s*:\s*([\d.]+)px/g))
            sizes.push(Number(mm[1]));
          const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          for (const rule of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            if (!new RegExp(`#${idEsc}(?![A-Za-z0-9_-])`).test(rule[1])) continue;
            const fs = rule[2].match(/\bfont-size\s*:\s*([\d.]+)px/);
            if (fs) sizes.push(Number(fs[1]));
          }
          if (sizes.length > 0 && Math.min(...sizes) >= FOCUS_TRIGGER.fontSizePxLt) {
            add(
              "error",
              "focus_contract",
              `focus("#${id}") 的区域最小字号 ${Math.min(...sizes)}px ≥ ${FOCUS_TRIGGER.fontSizePxLt}px（触发项 ① 不成立）`,
              "聚焦触发三项之一：该区域最终渲染字号 < 24px；大字无需放大 — issues/10 Q7",
            );
          }
        }
      }
    }
  }

  // ── 性能结构计数（issues/16 §5）：v2 项目 → warning；旧片 → info（绝不判红）。
  {
    const lvl = ctx.hasTheme ? "warning" : "info";
    const canvases = (markup.match(/<canvas\b/g) || []).length;
    if (canvases > 0) {
      add(
        lvl,
        "perf_runtime_canvas",
        `帧内有 ${canvases} 个 <canvas>`,
        "运行时 canvas 违例（issues/16）；改用静态/程序化 DOM",
      );
    }
    // 全屏纹理层：class="clip" 且带内联 background-image；标准 paper/grain（track 0/2）不计。
    const bgLayers = [
      ...markup.matchAll(/<div\b[^>]*class="[^"]*\bclip\b[^"]*"[^>]*background-image[^>]*>/g),
    ].map((m) => m[0]);
    const custom = bgLayers.filter((t) => {
      const track = t.match(/data-track-index="(\d+)"/)?.[1];
      const suffix = t.match(/id="[^"]*-([A-Za-z0-9_-]+)"/)?.[1];
      return !(track === "0" || track === "2" || suffix === "paper" || suffix === "grain");
    });
    if (custom.length > 1) {
      add(
        lvl,
        "perf_fullscreen_texture_layers",
        `自定义全屏纹理层 ${custom.length} 个（应 ≤1）`,
        "每帧只留一层全屏 filter/纹理（issues/16）；标准 paper/grain 已排除",
      );
    }
    // alpha 材料：事实材料 <img> 的 PNG 含 alpha 通道（IHDR color type 4/6）。
    for (const m of markup.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)) {
      const src = m[1];
      if (!/\.png($|\?)/i.test(src) || /^(https?:|data:)/i.test(src)) continue;
      const p = join(project, src);
      if (!existsSync(p)) continue;
      try {
        const buf = readFileSync(p);
        if (buf.length > 25 && buf.toString("ascii", 12, 16) === "IHDR") {
          const colorType = buf[25];
          if (colorType === 4 || colorType === 6) {
            add(
              lvl,
              "perf_alpha_material",
              `「${src}」的 PNG 含 alpha 通道（color type ${colorType}）`,
              "撕边真透明 → 填纸色压平（issues/16）；alpha 材料值 +59ms/帧",
            );
          }
        }
      } catch {
        /* 读不到就跳过（产物缺失不是本规则的活） */
      }
    }
  }

  // ── 笔触物理性（issues/09，三条）：v2 项目才判；旧片跳过。
  //    高光记号 = `<g data-ink="highlight">`（issues/09 Q6：多段 path 必须共用一个 <g>）。
  {
    const ink = markup.replace(/<!--[\s\S]*?-->/g, ""); // 注释里的示例不算真元素（§4 硬教训）
    const groups = [...ink.matchAll(/<g\b[^>]*\bdata-ink="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)].map(
      (m) => ({ kind: m[1], inner: m[2] }),
    );
    const hl = groups.filter((g) => g.kind === "highlight").length;
    if (ctx.hasTheme) {
      if (hl > 3) {
        add(
          "error",
          "highlight_per_screen",
          `高光记号 ${hl} 处（应 ≤3/屏）`,
          "高光笔 ~31 元素/条，全片只留 2–3 处（issues/09 Q2）",
        );
      }
      const widths = [];
      let anyDash = false;
      for (const g of groups) {
        for (const p of g.inner.matchAll(/<path\b[^>]*>/g)) {
          const w = p[0].match(/stroke-width="([\d.]+)"/)?.[1];
          if (w) widths.push(Number(w));
          if (/stroke-dasharray=/.test(p[0])) anyDash = true;
        }
      }
      const legacy = [...ink.matchAll(/<path\b[^>]*class="[^"]*\bscribble\b[^"]*"/g)].length;
      const uniq = new Set(widths);
      if (widths.length >= 2 && uniq.size === 1 && !anyDash) {
        add(
          "error",
          "ink_width_constant",
          `ink path 全帧同一线宽 ${[...uniq][0]} 且无 stroke-dasharray`,
          "笔触未升级：默认笔应走两档 inkStroke（多描 / 收锋），见 issues/09",
        );
      } else if (groups.length === 0 && legacy > 0) {
        add(
          "error",
          "ink_width_constant",
          `帧内有 ${legacy} 条 scribble 笔触但无 data-ink 两档标记`,
          "旧式单描 → 改用 inkStroke / inkMarkup 产出 <g data-ink=…>（issues/09）",
        );
      }
    }
    if (ctx.hasTheme && hl > 0 && !ctx.hasMeasure) {
      add(
        "info",
        "ink_coords_measured",
        "本帧有高光笔触，但项目内找不到量测记录（*.measure.json）",
        "手绘坐标须量测、不许估（material-sourcing §四）；量测文件放项目根或 tools/",
      );
    }
  }

  // ── 撕边（issues/15 二轮 / 本轮，两条）：v2 项目才判。
  //    约定：撕边元素带 `data-torn="soft|mat|wide"` + 内联 `clip-path: polygon(…%…)`。
  if (ctx.hasTheme) {
    const TORN_MIN = 3;
    const TORN_MAX = 4;
    const WIDE_PX = 1000;
    const tornTags = [...markup.matchAll(/<[a-z][^>]*\bdata-torn="([^"]+)"[^>]*>/gi)].map(
      (m) => m[0],
    );
    for (const tag of tornTags) {
      const tier = tag.match(/\bdata-torn="([^"]+)"/)?.[1];
      const style = tag.match(/\bstyle="([^"]*)"/)?.[1] ?? "";
      const wpx = Number(style.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
      const poly = style.match(/clip-path\s*:\s*polygon\(([^)]*)\)/i)?.[1];
      if (!poly) {
        add(
          "error",
          "torn_spatial_frequency",
          "data-torn 元素缺少内联 clip-path: polygon(…)",
          "撕边必须用 torn() 产出的 polygon（issues/15）",
        );
        continue;
      }
      const pts = [...poly.matchAll(/([\d.]+)%\s+([\d.]+)%/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]);
      const T = 8; // 贴边判定窗（%）
      const per = [0, 0, 0, 0]; // top / right / bottom / left
      const depths = [];
      for (const [x, y] of pts) {
        if (y <= T) {
          per[0] += 1;
          depths.push(y);
        } else if (x >= 100 - T) {
          per[1] += 1;
          depths.push(100 - x);
        } else if (y >= 100 - T) {
          per[2] += 1;
          depths.push(100 - y);
        } else if (x <= T) {
          per[3] += 1;
          depths.push(x);
        }
      }
      const bad = per.some((c) => c < TORN_MIN || c > TORN_MAX);
      const maxD = Math.max(...depths, 0);
      const uniqD = new Set(depths.map((d) => d.toFixed(1)));
      if (bad || maxD > 6 || uniqD.size < 2) {
        add(
          "error",
          "torn_spatial_frequency",
          `撕边不合规：每边 [${per.join(",")}]（应 ${TORN_MIN}–${TORN_MAX}）· 最深刻幅 ${maxD.toFixed(1)}%（应 ≤6）· 深浅 ${uniqD.size} 种`,
          "低频撕边：每边 3–4 点、切幅 1–6% 深浅不一、含 1–2 处长裂口（issues/15 二轮）",
        );
      }
      if (wpx > WIDE_PX && tier !== "wide") {
        add(
          "error",
          "torn_amplitude_scales_with_size",
          `宽 ${wpx}px（>${WIDE_PX}）应选浅档 data-torn="wide"，实为 torn-${tier}`,
          "相对振幅必须随元素尺寸缩放（issues/15 本轮）",
        );
      }
    }
  }

  // ── 墨边 / 色彩预算 / 纸面退网点（issues/15 二轮·四轮 · issues/22 §6 规则 17/18/19 · 落地 issues/19）。
  //    三条都只在 v2 项目（有 tools/theme.json）判定；旧片跳过（铁律 issues/01）。
  {
    const bare = markup.replace(/<!--[\s\S]*?-->/g, ""); // 注释里的示例不算真元素（pitfalls §4 硬教训）

    // ① paper_halftone_retired（error）：纸面层带半调点阵 → error。网点只留**图像与垫纸**。
    const halftone = resolveLevel(ctx.tier, ["theme"], "error");
    if (halftone.applicable) {
      for (const tag of bare.matchAll(/<[a-z][^>]*>/gi)) {
        const style = tag[0].match(/\bstyle="([^"]*)"/)?.[1] ?? "";
        if (!/background-image/.test(style)) continue;
        if (!/%3Ccircle|<circle/i.test(style)) continue; // 只判半调点阵（circle tile）
        const id = tag[0].match(/\bid="([^"]+)"/)?.[1] ?? "";
        const track = tag[0].match(/data-track-index="(\d+)"/)?.[1] ?? "";
        if (/-paper$/.test(id) || track === "0" || /\bid="root"/.test(tag[0])) {
          add(
            "error",
            "paper_halftone_retired",
            `纸面层「${id || tag[0].slice(0, 32)}」带半调点阵`,
            "真实半调只出现在图像上 —— 纸面靠纸色 + grain 建质感；网点只留图像与垫纸（issues/15 四轮 C2）",
          );
        }
      }
    }

    // ② ink_full_rim（error）：负 inset 的墨色 rim 与撕边 clip-path 同落一个元素 → 边缘成锯齿描边。
    //    参考文档要的是 **offset accent strokes**（偏移强调描边），不是整圈描边。
    const rim = resolveLevel(ctx.tier, ["theme"], "error");
    if (rim.applicable) {
      const rules = [];
      for (const m of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim();
        if (sel.includes("::")) continue; // 伪元素不算同一元素
        rules.push({ sel, decls: m[2] });
      }
      const hitsTag = (sel, tag) => {
        const tagName = tag.match(/^<([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase() ?? "";
        const cls = (tag.match(/\bclass="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
        const id = tag.match(/\bid="([^"]+)"/)?.[1] ?? "";
        return sel.split(",").some((one) => {
          const s = one.trim();
          if (!s || /[\s[\]>+~*$^]/.test(s)) return false; // 只认朴素 .class / #id / tag
          if (s.startsWith(".")) return cls.includes(s.slice(1));
          if (s.startsWith("#")) return id === s.slice(1);
          return /^[a-z][a-z0-9-]*$/i.test(s) && tagName === s.toLowerCase();
        });
      };
      for (const tag of bare.matchAll(/<[a-z][^>]*>/gi)) {
        const decls = [tag[0].match(/\bstyle="([^"]*)"/)?.[1] ?? ""];
        for (const r of rules) if (hitsTag(r.sel, tag[0])) decls.push(r.decls);
        const all = decls.join(";");
        const negInset = /\binset\s*:\s*-/.test(all);
        const inkBg = [...all.matchAll(/\bbackground(?:-color)?\s*:\s*([^;]+)/gi)].some((m) =>
          isInkColor(m[1]),
        );
        const torn = /\bclip-path\s*:\s*polygon\(/i.test(all);
        if (negInset && inkBg && torn) {
          const id = tag[0].match(/\bid="([^"]+)"/)?.[1] ?? tag[0].slice(0, 32);
          add(
            "error",
            "ink_full_rim",
            `「${id}」同时有负 inset 墨色 rim 与撕边 clip-path`,
            "整圈墨边 + 撕边会变成锯齿描边 —— 用偏移强调描边（offset accent strokes）代替（issues/15 二轮）",
          );
        }
      }
    }

    // ③ accent_budget_scaled（info）：荧光笔配额按**信息块数**缩放、按**屏型**给配额。
    //    度量：`<g data-ink="highlight">` + 内联 `background…var(--marker)` 的块。
    const accent = resolveLevel(ctx.tier, ["theme"], "info");
    if (accent.applicable && slot) {
      const blocks = [
        ...bare.matchAll(/<[a-z][^>]*class="[^"]*\b(card|chip|startblk|mat)\b[^"]*"/gi),
      ].length;
      const inkGroups = [...bare.matchAll(/<g\b[^>]*\bdata-ink="highlight"/g)].length;
      const markerBlocks = [
        ...bare.matchAll(
          /<[a-z][^>]*style="[^"]*background(?:-color)?\s*:[^"]*var\(\s*--marker\s*\)[^"]*"/gi,
        ),
      ].length;
      const accents = inkGroups + markerBlocks;
      const infoScreen = slot.duration >= 11;
      const quota = infoScreen ? Math.max(1, Math.ceil(blocks / 3)) : 1;
      if (accents > quota) {
        add(
          "info",
          "accent_budget_scaled",
          `${infoScreen ? "信息屏" : "叙事拍"}荧光笔 ${accents} 处 > 配额 ${quota}（${blocks} 个信息块${
            infoScreen ? " → ceil(N/3)" : "；叙事拍封顶 1"
          }）`,
          "色彩是稀缺资源：配额按信息块数缩放，不再是无条件 ≤2 处/帧（issues/15 二轮）",
        );
      }
    }
  }
}

/** 材料账本的严格校验（仅新式账本：至少一行带 `tier`）—— issues/23 §1·§2·§3。 */
function strictLedgerChecks(project, files, framesDir, index, rows, findings) {
  const byName = new Map(rows.map((r) => [basename(String(r.path || "")), r]));
  const refs = [];
  const collectRefs = (raw, file) => {
    // 先剥 HTML 注释 —— index.html 模板里 `<audio src=".media/…">` 的**示例**全在注释里，
    // 不剥会把示例当真实引用（实测）。
    const text = raw.replace(/<!--[\s\S]*?-->/g, "");
    for (const m of text.matchAll(/\bsrc\s*=\s*["']([^"']*\.media\/[^"']+)["']/g)) {
      refs.push({ file, ref: m[1] });
    }
    for (const m of text.matchAll(/url\(\s*["']?([^"')]*\.media\/[^"')\s]+)["']?\s*\)/g)) {
      refs.push({ file, ref: m[1] });
    }
  };
  for (const file of files) collectRefs(readFileSync(join(framesDir, file), "utf8"), file);
  if (index) collectRefs(index, "index.html");
  const used = new Set();
  for (const { file, ref } of refs) {
    const name = basename(ref);
    used.add(name);
    if (!byName.has(name)) {
      findings.push({
        level: "error",
        rule: "ledger_row_missing",
        file,
        message: `引用 ${ref} 在材料账本里没有对应行`,
        hint: "所有 .media/ 引用都要有账本行（issues/23 §2）",
      });
    }
  }
  for (const [name, r] of byName) {
    if (!r.path || !r.tier || !r.origin) {
      findings.push({
        level: "error",
        rule: "ledger_schema_invalid",
        file: ".media/manifest.jsonl",
        message: `行 ${name || "(无 path)"} 缺 path/tier/origin`,
        hint: "issues/23 §1",
      });
    }
    if (!used.has(name)) {
      findings.push({
        level: "info",
        rule: "ledger_orphan_row",
        file: ".media/manifest.jsonl",
        message: `账本行 ${name} 没有任何帧引用（孤儿行）`,
        hint: "issues/23 §2",
      });
    }
    if (String(name).startsWith("gen-") && (r.tier !== "M5" || !r.model || r.seed === undefined)) {
      findings.push({
        level: "error",
        rule: "gen_asset_missing_tier",
        file: ".media/manifest.jsonl",
        message: `生成资产 ${name} 必须 tier:"M5" 且带 model/seed`,
        hint: "issues/23 §3",
      });
    }
    if (r.tier === "M5") {
      if (!r.license) {
        findings.push({
          level: "error",
          rule: "gen_license_recorded",
          file: ".media/manifest.jsonl",
          message: `M5 行 ${name} 缺 license`,
          hint: "issues/17 · issues/23 §1",
        });
      }
      findings.push({
        level: "info",
        rule: "gen_license_noncommercial",
        file: ".media/manifest.jsonl",
        message: `M5 行 ${name} license=${r.license ?? "（未记）"} —— 非商用资产不得用于商用/变现项目`,
        hint: "Qwen Research License 仅非商用（issues/17）",
      });
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: node audit-frames.mjs [--project <dir>] [--json]");
    return 0;
  }
  const project = resolve(args.project);
  const framesDir = join(project, "compositions", "frames");
  if (!existsSync(framesDir) || !statSync(framesDir).isDirectory()) {
    console.error(`[usage] not a vox-explainer project (missing ${framesDir}). 传 --project <dir>`);
    return 2;
  }

  const { index, slots } = readSlots(project);
  if (index === null) {
    console.error(`[usage] missing index.html in ${project}`);
    return 2;
  }

  // 产物存在性分档：新门禁规则一律经它决定级别（见 issues/01）。
  const tier = tierFor(project);
  const hasMeasure =
    readdirSync(project).some((f) => f.endsWith(".measure.json")) ||
    (existsSync(join(project, "tools")) &&
      readdirSync(join(project, "tools")).some((f) => f.endsWith(".measure.json")));
  const ctx = { hasTheme: tier.products.theme, hasMeasure, tier };

  let files = readdirSync(framesDir)
    .filter((f) => f.endsWith(".html"))
    .sort();
  if (args.frame) {
    const targetNN = String(args.frame).padStart(2, "0");
    const frameRe = new RegExp(`^(?:frame-)?${targetNN}-`);
    files = files.filter((f) => frameRe.test(f));
    if (files.length === 0) {
      console.error(`[audit-frames] 错误: 未在 ${framesDir} 中找到帧号为 ${targetNN} 的帧文件`);
      return 2;
    }
  }
  const findings = [];
  const indexCids = new Set(slots.keys());
  const frameCids = new Set();

  for (const file of files) {
    const text = readFileSync(join(framesDir, file), "utf8");
    auditFrame(project, file, text, slots, findings, ctx);
    const cid = text.match(/data-composition-id="(frame-[^"]+)"/)?.[1];
    if (cid) frameCids.add(cid);
  }

  // 仅在全量审计模式下检查全局 index 槽位完整性与连续性
  if (!args.frame) {
    // index 侧：槽位与帧互相对不上
    for (const cid of indexCids) {
      if (!frameCids.has(cid)) {
        findings.push({
          level: "error",
          rule: "index_slot_without_frame",
          file: "index.html",
          message: `槽位 ${cid} 指向的帧文件不存在`,
          hint: "槽位 data-composition-id 必须等于帧的 composition id",
        });
      }
    }

    // index 侧：槽位连续性
    const ordered = [...slots.entries()]
      .map(([cid, v]) => ({ cid, ...v }))
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (prev.start === null || cur.start === null) continue;
      const expected = Number((prev.start + prev.duration).toFixed(3));
      if (Math.abs(cur.start - expected) > 0.05) {
        findings.push({
          level: "error",
          rule: "index_slot_gap",
          file: "index.html",
          message: `槽位 ${cur.cid} 起点 ${cur.start}，但前序槽位结束于 ${expected}`,
          hint: "data-start 必须累加无空洞/重叠",
        });
      }
    }
  }

  // ── 产物存在性分档（issues/01）
  //    新门禁依赖的新产物（tools/theme.json / tools/assemble-table.json / ledger.json）
  //    在 4 部已交付项目里**不存在** —— 它们只报 info，**绝不判红**。
  //    这里（a）报告分档；（b）对**已存在**的产物做语法校验（缺产物交由 (a) 报告）。
  //    后续票据（05/06/07）的具体规则 import 同一个 gate-tier，用 resolveLevel 取级别。
  findings.push({
    level: "info",
    rule: "v2_product_presence",
    file: "（项目）",
    message: `新产物分档：${tier.tier} · 有 [${tier.present.join(", ") || "无"}] · 缺 [${tier.missing.join(", ") || "无"}]`,
    hint: "新门禁按产物存在性分档：缺新产物只报 info，绝不判红（issues/01）",
  });
  for (const key of tier.present) {
    const decision = resolveLevel(tier, [key], "error");
    if (!decision.applicable) continue;
    const rel = PRODUCTS[key];
    if (rel.endsWith(".jsonl")) continue; // JSONL 不是单个 JSON；其语法由材料账本规则查
    try {
      JSON.parse(readFileSync(join(project, rel), "utf8"));
    } catch (e) {
      findings.push({
        level: decision.level,
        rule: "v2_product_malformed",
        file: rel,
        message: `${rel} 不是合法 JSON：${e.message}`,
        hint: "产物由生成器产出，不要手改；重跑对应生成器",
      });
    }
  }

  // ── 生成器防回归（issues/22 §6 规则 26 · item 5）：`gen-frames.mjs` 不许出现字面品牌串 / 字面分母。
  //    分档：只有 v2 生成器项目（有装配表）才判 —— freetoken 的项目副本是旧版（含 FREETOKEN 与 `/ 12`），
  //    属只读归档，绝不判红（铁律 issues/01）。
  {
    const dec = resolveLevel(tier, ["assembleTable"], "error");
    if (dec.applicable) {
      const candidates = [
        join(project, "tools", "gen-frames.mjs"),
        join(HERE, "..", "gen-frames.mjs"),
        join(HERE, "gen-frames.mjs"),
      ];
      const seen = new Set();
      for (const p of candidates) {
        const abs = resolve(p);
        if (!existsSync(abs) || seen.has(abs)) continue;
        seen.add(abs);
        const src = readFileSync(abs, "utf8");
        const rel = relative(project, abs) || abs;
        if (/\bCHANNEL_TAG\s*=\s*["'`]/.test(src)) {
          findings.push({
            level: dec.level,
            rule: "gen_frames_brand_hardcode",
            file: rel,
            message: "gen-frames.mjs 把频道标签写成了字面量（会泄漏上一个项目的品牌）",
            hint: "频道标签从 frames-data.mjs 取（issues/22 item 5）",
          });
        }
        const denom = src.match(/\$\{\s*nn\s*\}\s*\/\s*\d+/);
        if (denom) {
          findings.push({
            level: dec.level,
            rule: "gen_frames_brand_hardcode",
            file: rel,
            message: `gen-frames.mjs 写了字面分母 ${JSON.stringify(denom[0])}`,
            hint: "帧数是参数 —— 分母从 slots.mjs 取（issues/22 item 5）",
          });
        }
      }
    }
  }

  // ── 令牌漂移（issues/13 Q5，双向）：主题 = tools/theme.json；对照物 = 帧 CSS 的
  //    var(--x) + frame.md frontmatter 的颜色键。无 theme.json（旧项目）→ 只 info。
  if (tier.products.theme) {
    try {
      const theme = JSON.parse(readFileSync(join(project, "tools", "theme.json"), "utf8"));
      const colorKeys = Object.keys(theme.colors || {});
      const defined = new Set([...colorKeys, "margin", "gutter"]);
      const refs = new Set();
      const refRe = /var\(\s*--([A-Za-z0-9_-]+)/g;
      for (const file of files) {
        const t = readFileSync(join(framesDir, file), "utf8");
        for (const m of t.matchAll(refRe)) refs.add(m[1]);
      }
      const frameMdPath = join(project, "frame.md");
      if (existsSync(frameMdPath)) {
        const md = readFileSync(frameMdPath, "utf8");
        for (const m of md.matchAll(/^[ \t]+([A-Za-z0-9_-]+)\s*:\s*"#[0-9A-Fa-f]{3,8}"/gm)) {
          refs.add(m[1]);
        }
      }
      // 方向 B：引用了主题里没有的令牌（空值/继承，静默）。
      const undef = [...refs].filter((n) => !defined.has(n) && !n.startsWith("hf-"));
      if (undef.length) {
        findings.push({
          level: "error",
          rule: "theme_token_drift",
          file: "（项目）",
          message: `帧/frame.md 引用了 tools/theme.json 里没有的令牌：${undef.join(", ")}`,
          hint: "令牌源是 tools/theme.json（issues/13 Q5 方向 B）",
        });
      }
      // 方向 A：主题声明了但没有消费点 —— 「加了但没接线」正是当初的静默空操作。
      const unwired = colorKeys.filter((k) => !refs.has(k));
      if (unwired.length) {
        findings.push({
          level: "error",
          rule: "theme_token_drift",
          file: "（项目）",
          message: `tools/theme.json 声明了但没有消费点的令牌：${unwired.join(", ")}`,
          hint: "加了令牌但没接线（issues/13 Q5 方向 A）",
        });
      }
    } catch (e) {
      findings.push({
        level: "error",
        rule: "theme_token_drift",
        file: "tools/theme.json",
        message: `无法解析：${e.message}`,
        hint: "重跑 init 或修 JSON",
      });
    }
  } else {
    findings.push({
      level: "info",
      rule: "theme_token_drift",
      file: "（项目）",
      message: "无 tools/theme.json（旧式令牌，已固化），跳过令牌漂移校验",
      hint: "要迁移请跑 init --theme 重生成（issues/13 向后兼容）",
    });
  }

  // ── 装配 / 同步 / 密度（issues/11 Q4·Q6·Q7 · issues/21 §4 · issues/22 §6）
  //    数据源 = tools/assemble-table.json（一处产出、多处消费；密度判据不扫帧脚本）。
  {
    const tablePath = join(project, "tools", "assemble-table.json");
    if (!existsSync(tablePath)) {
      findings.push({
        level: "info",
        rule: "motion_frontload",
        file: "tools/assemble-table.json",
        message: "无装配表（本项目未升级到动效契约 v2），跳过装配/同步/密度判据",
        hint: "重跑 gen-frames 产出 tools/assemble-table.json（issues/22 §5）",
      });
    } else {
      let table = null;
      try {
        table = JSON.parse(readFileSync(tablePath, "utf8"));
      } catch (e) {
        findings.push({
          level: "error",
          rule: "motion_frontload",
          file: "tools/assemble-table.json",
          message: `不是合法 JSON：${e.message}`,
          hint: "机器产物，重跑 gen-frames",
        });
      }
      for (const [name, fr] of Object.entries(table?.frames ?? {})) {
        const S = Number(fr.slot) || 0;
        const entries = Array.isArray(fr.entries) ? fr.entries : [];
        const closerAt = fr.closerAt === undefined ? null : fr.closerAt;

        // 规则 7 · motion_frontload —— 无 closer 记录 → error；最晚动作 < 40%S → error。
        if (closerAt === null) {
          findings.push({
            level: "error",
            rule: "motion_frontload",
            file: name,
            message: `${name} 无 closer 记录（幕末必须有收尾动作）`,
            hint: "issues/10 Q11 · issues/22 §5",
          });
        }
        const lastMotion = Math.max(
          closerAt === null ? 0 : Number(closerAt) || 0,
          ...entries.map((e) => Number(e.settleAt) || 0),
          0,
        );
        if (S > 0 && lastMotion / S < 0.4) {
          findings.push({
            level: "error",
            rule: "motion_frontload",
            file: name,
            message: `最晚动作在第 ${lastMotion.toFixed(2)}s，只占槽位 ${S}s 的 ${((lastMotion / S) * 100).toFixed(0)}%（应 ≥40%）`,
            hint: "画面不能开完就静止（issues/11 Q4 · issues/22 §6 规则 7）",
          });
        }

        // 规则 8 · motion_spread_ratio —— closerAt 占槽位比例；理想 ≥0.80。
        if (closerAt !== null && S > 0) {
          const r = Number(closerAt) / S;
          if (r < 0.8) {
            findings.push({
              level: "info",
              rule: "motion_spread_ratio",
              file: name,
              message: `closer 起点占槽位 ${(r * 100).toFixed(0)}%（理想 ≥80%）`,
              hint: "收尾太早、后面又静止（issues/11 Q6）",
            });
          }
        }

        // issues/21 · 密度 —— 只判信息屏（S ≥ 11s）。
        if (S >= 11) {
          const B = entries.length + 1;
          const Bmin = Math.max(5, Math.ceil(S / 3.9));
          const Bmax = Math.min(Math.floor(S / 2.2), 9);
          if (B < Bmin - 1) {
            findings.push({
              level: "error",
              rule: "cue_density",
              file: name,
              message: `线索 ${B} 拍 < 下限 ${Bmin}（画面会变回幻灯片）`,
              hint: "每 2.2–3.9s 一拍（issues/21 §1）",
            });
          } else if (B < Bmin) {
            findings.push({
              level: "info",
              rule: "cue_density",
              file: name,
              message: `线索 ${B} 拍 略低于下限 ${Bmin}（容差带）`,
              hint: "issues/21 §4",
            });
          }
          if (B > Bmax + 1) {
            findings.push({
              level: "error",
              rule: "cue_density",
              file: name,
              message: `线索 ${B} 拍 > 上限 ${Bmax}（超出每屏 80 字的可读上限）`,
              hint: "issues/21 §2",
            });
          } else if (B > Bmax) {
            findings.push({
              level: "info",
              rule: "cue_density",
              file: name,
              message: `线索 ${B} 拍 略高于上限 ${Bmax}（容差带）`,
              hint: "issues/21 §4",
            });
          }
          // reveal 跨距补丁：首条 ≤0.25·S、末条 ≥0.40·S（issues/21 §1）。
          const cueAts = entries.map((e) => Number(e.cueAt) || 0);
          if (cueAts.length) {
            const first = Math.min(...cueAts);
            const last = Math.max(...cueAts);
            if (first > 0.25 * S) {
              findings.push({
                level: "error",
                rule: "cue_head_late",
                file: name,
                message: `首条 cue 在第 ${first.toFixed(2)}s > 0.25·S（${(0.25 * S).toFixed(2)}s）`,
                hint: "reveal 跨距补丁：首条 ≤0.25·S（issues/21 §1）",
              });
            }
            if (last < 0.4 * S) {
              findings.push({
                level: "error",
                rule: "cue_tail_early",
                file: name,
                message: `末条 cue 在第 ${last.toFixed(2)}s < 0.40·S（${(0.4 * S).toFixed(2)}s）`,
                hint: "信息不能一次给完（issues/11 Q4 · issues/21 §1）",
              });
            }
          }
        }

        // 规则 24 · assemble_layer_order（info）—— 三层顺序 ground ≤ fact ≤ trim（issues/10 Q1 · issues/22 §1）。
        // 从装配表读，代替 §1 被去掉的 `layers` 大对象。缺层不判（每帧未必三层齐）。
        {
          const maxSettle = {};
          for (const e of entries) {
            const lv = e.tier;
            if (!LAYER_ORDER.includes(lv)) continue;
            const s = Number(e.settleAt) || 0;
            if (maxSettle[lv] === undefined || s > maxSettle[lv]) maxSettle[lv] = s;
          }
          const present = LAYER_ORDER.filter((l) => maxSettle[l] !== undefined);
          for (let i = 1; i < present.length; i += 1) {
            const a = present[i - 1];
            const b = present[i];
            if (maxSettle[a] > maxSettle[b] + 1e-6) {
              findings.push({
                level: "info",
                rule: "assemble_layer_order",
                file: name,
                message: `层序倒置：${a} settle=${maxSettle[a]}s 晚于 ${b} settle=${maxSettle[b]}s`,
                hint: "装配顺序 ground → fact → trim（issues/10 Q1 · issues/22 §6 规则 24）",
              });
              break;
            }
          }
        }

        // issues/21 §4 · 槽位区间（只到 info —— 拍型判定给作者留口）。
        if (S > 0 && (S < 11 || S > 20)) {
          findings.push({
            level: "info",
            rule: "screen_duration_bounds",
            file: name,
            message: `槽位 ${S}s 在 11–20s 信息屏区间外`,
            hint: "拍型判定给作者留口（STORYBOARD.md 的 type；issues/21 §4）",
          });
        }
      }
    }
  }

  // ── 接缝账本（issues/20 §5.3·§5.5）：有接缝必须有 ledger 行；载体禁停格。
  if (tier.products.ledger) {
    let ledger = null;
    try {
      ledger = JSON.parse(readFileSync(join(project, "ledger.json"), "utf8"));
    } catch (e) {
      findings.push({
        level: "error",
        rule: "ledger_seam_row_missing",
        file: "ledger.json",
        message: `不是合法 JSON：${e.message}`,
        hint: "机器产物，重跑 gen-index",
      });
    }
    if (ledger) {
      const ledgerIds = new Set((ledger.seams ?? []).map((s) => s.id));
      const ordered = [...slots.entries()]
        .map(([cid, v]) => ({ cid, ...v }))
        .filter((s) => s.start !== null)
        .sort((a, b) => a.start - b.start);
      for (let i = 0; i < ordered.length - 1; i += 1) {
        const idA = ordered[i].cid.match(/^frame-(\d+)/)?.[1];
        const idB = ordered[i + 1].cid.match(/^frame-(\d+)/)?.[1];
        const rowId = idA && idB ? `${idA}→${idB}` : null;
        if (rowId && !ledgerIds.has(rowId)) {
          findings.push({
            level: "error",
            rule: "ledger_seam_row_missing",
            file: "ledger.json",
            message: `${rowId} 有接缝但没有账本行`,
            hint: "每个相邻边界都要一行（issues/20 §5.5）",
          });
        }
      }
    }
    // 接缝载体禁停格：12fps 的保持窗（83ms）落在 gate 的 ±0.1s 采样窗里会量到 0 速度。
    if (index && /\b(?:stepped\s*\(|steps\s*\(|SteppedEase)/.test(index)) {
      findings.push({
        level: "error",
        rule: "seam_motion_not_quantized",
        file: "index.html",
        message: "接缝载体出现停格缓动（stepped()/steps()/SteppedEase）",
        hint: "issues/20 §5.3 —— 出/入幕纸必须平滑在动",
      });
    }
  }

  // ── 材料账本（issues/23 §1·§2）：**所有** `.media/` 引用都要有账本行。
  const manifestPath = join(project, ".media", "manifest.jsonl");
  if (!existsSync(manifestPath)) {
    findings.push({
      level: "info",
      rule: "ledger_row_missing",
      file: ".media/manifest.jsonl",
      message: "本项目未接材料账本，跳过账本校验",
      hint: "产物存在性分档（issues/23 §2）",
    });
  } else {
    const rows = [];
    for (const line of readFileSync(manifestPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t));
      } catch {
        findings.push({
          level: "error",
          rule: "ledger_schema_invalid",
          file: ".media/manifest.jsonl",
          message: `不是合法 JSONL 行：${t.slice(0, 60)}`,
          hint: "一行一个 JSON 对象（issues/23 §1）",
        });
      }
    }
    // 旧式账本（无 `tier` 字段：dsh / freetoken 的历史形状，issues/23 §1 明令不统一改写）
    // → 按存在性分档跳过严格校验，绝不判红已交付项目。
    const isLegacy =
      rows.length > 0 && !rows.some((r) => r && typeof r === "object" && "tier" in r);
    if (isLegacy) {
      findings.push({
        level: "info",
        rule: "ledger_row_missing",
        file: ".media/manifest.jsonl",
        message: "材料账本为旧式形状（无 tier 字段），按存在性分档跳过严格校验",
        hint: "issues/23 §1：已有形状不统一改写",
      });
    } else if (rows.length === 0) {
      findings.push({
        level: "info",
        rule: "ledger_row_missing",
        file: ".media/manifest.jsonl",
        message: "材料账本为空，跳过账本校验",
        hint: "issues/23 §2",
      });
    } else {
      strictLedgerChecks(project, files, framesDir, index, rows, findings);
    }
  }

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const infos = findings.filter((f) => f.level === "info");

  const summary = {
    ok: errors.length === 0 && warnings.length === 0,
    frames: files.length,
    indexSlots: slots.size,
    errors: errors.length,
    warnings: warnings.length,
    infos: infos.length,
    tier: tier.tier,
    products: tier.products,
    findings,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const f of findings) {
      const tag = f.level === "error" ? "ERROR" : f.level === "warning" ? "WARN " : "info ";
      console.log(`${tag} [${f.rule}] ${f.file}\n      ${f.message}\n      → ${f.hint}`);
    }
    console.log(
      `\n${files.length} 帧 / ${slots.size} 槽位 · ${errors.length} error · ${warnings.length} warning · ${infos.length} info · 分档 ${tier.tier}`,
    );
    if (summary.ok) console.log("audit-frames: OK");
    else console.log("audit-frames: FAILED（error 必须清零；warning 逐条判断）");
  }
  return summary.ok ? 0 : 1;
}

process.exit(main());
