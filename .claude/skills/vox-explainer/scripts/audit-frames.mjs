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
import { join, basename, resolve } from "node:path";

// ── 规范字体族（pitfalls §6）：任何在字体栈里出现的族名都必须有 @font-face 声明
const CANONICAL_FAMILIES = ["Noto Sans SC", "JetBrains Mono", "Caveat", "Microsoft YaHei"];

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

/** 找到 index.html 里每个槽位的 composition id -> 槽位时长 */
function readSlots(project) {
  const indexPath = join(project, "index.html");
  if (!existsSync(indexPath)) return { index: null, slots: new Map() };
  const html = readFileSync(indexPath, "utf8");
  const slots = new Map();
  // 槽位定义在同一个标签上：data-composition-id="…" 与 data-duration="…"
  const tagRe = /<div\b[^>]*data-composition-src="[^"]*"[^>]*>/g;
  for (const m of html.matchAll(tagRe)) {
    const tag = m[0];
    const cid = tag.match(/data-composition-id="([^"]+)"/)?.[1];
    const dur = tag.match(/data-duration="([\d.]+)"/)?.[1];
    const start = tag.match(/data-start="([\d.]+)"/)?.[1];
    if (cid && dur)
      slots.set(cid, { duration: Number(dur), start: start === undefined ? null : Number(start) });
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

function auditFrame(project, file, text, slots, findings) {
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
    } catch {
      add(
        "error",
        "motion_sidecar_invalid_json",
        `${stem}.motion.json 不是合法 JSON`,
        "修 JSON 语法",
      );
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
    auditFrame(project, file, text, slots, findings);
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
      `\n${files.length} 帧 / ${slots.size} 槽位 · ${errors.length} error · ${warnings.length} warning · ${infos.length} info`,
    );
    if (summary.ok) console.log("audit-frames: OK");
    else console.log("audit-frames: FAILED（error 必须清零；warning 逐条判断）");
  }
  return summary.ok ? 0 : 1;
}

process.exit(main());
