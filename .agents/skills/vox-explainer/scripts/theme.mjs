#!/usr/bin/env node
/**
 * theme.mjs — 令牌/主题的**单一源**：加载 + 渲染 + 按名替换。
 *
 * 【单一源】theme → `themes/<name>.json`（技能内）→ `init` 复制成项目根的
 * `tools/theme.json` → 生成器只读它。**不要再在脚本或模板里另立一套写死的令牌值。**
 *
 * 被两处共用（issues/13 的"令牌源收敛"）：
 *   · `init-vox-project.mjs` —— 写 `tools/theme.json`，并把令牌按**名**灌进
 *     `frame.md` / `frame-skeleton.html` / `index.html` 骨架。
 *   · `gen-frames.mjs` —— 用 `renderTokenBlock()` 生成每帧 `<style>` 里的令牌块。
 *
 * 【按名替换】旧的 `applyThemeTokens` 按**写死的十六进制值**匹配（如 `paper: "#F1EDE4"`），
 * 加一个新令牌就是静默空操作。现在一律按**令牌名**匹配（如 `--paper:` / `paper:`）。
 *
 * 【向后兼容】项目无 `tools/theme.json`（4 部已交付项目）→ 用内置默认（paper 冻结值）兜底，
 * **绝不判红、绝不破坏可复现**。
 *
 * 自证：`node theme.mjs --self-test`
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 版心与非颜色物理属性的默认值（paper 主题冻结值）。 */
export const DEFAULT_LAYOUT = Object.freeze({
  margin: 96,
  gutter: 32,
  radius: 0,
  "halftone-pitch": 10,
  "halftone-radius": 1.15,
  "halftone-opacity": 0.12,
  "grain-opacity": 0.13,
  "pin-size": 14,
  "cutout-shadow-offset": "3px 4px",
});

/** `paper:` = 纸的物理属性；`layout:` = 版心。二者都从 `theme.layout` 分流。 */
export const PAPER_KEYS = Object.freeze([
  "halftone-pitch",
  "halftone-radius",
  "halftone-opacity",
  "grain-opacity",
  "pin-size",
  "cutout-shadow-offset",
]);
export const SPACING_KEYS = Object.freeze(["margin", "gutter", "radius"]);

/** 内置默认主题（paper 冻结值）—— 仅当项目无 `tools/theme.json` 时兜底。 */
export const DEFAULT_THEME = Object.freeze({
  name: "paper",
  displayName: "经典牛皮纸报刊风（默认）",
  colors: {
    paper: "#F1EDE4",
    "paper-deep": "#E3DCCC",
    "paper-shadow": "#DED6C4",
    ink: "#121212",
    "ink-soft": "#514C44",
    rule: "#C9C2B4",
    accent: "#1D4ED8",
    signal: "#E23A2E",
    marker: "#FFD400",
  },
  layout: DEFAULT_LAYOUT,
  dark: false,
  defaultScribbleColor: "#E23A2E",
});

/** 补全缺省字段。**colors 不做默认合并** —— collage 故意没有 accent。 */
export function normalizeTheme(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_THEME,
    ...r,
    colors: { ...(r.colors && typeof r.colors === "object" ? r.colors : {}) },
    layout: { ...DEFAULT_LAYOUT, ...(r.layout && typeof r.layout === "object" ? r.layout : {}) },
  };
}

/** 从项目根读 `tools/theme.json`；缺失/损坏 → 内置默认 + 说明。 */
export function loadTheme(project) {
  const p = join(resolve(project), "tools", "theme.json");
  if (existsSync(p)) {
    try {
      return { theme: normalizeTheme(JSON.parse(readFileSync(p, "utf8"))), source: p, note: null };
    } catch (e) {
      return {
        theme: DEFAULT_THEME,
        source: "builtin-default",
        note: `tools/theme.json 解析失败（${e.message}），回退内置默认`,
      };
    }
  }
  return {
    theme: DEFAULT_THEME,
    source: "builtin-default",
    note: "无 tools/theme.json（旧项目，向后兼容），使用内置默认 paper",
  };
}

/** 数值/字符串 → CSS 长度（`96` → `"96px"`；`"96px"` 原样）。 */
export function cssLength(v) {
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? `${s}px` : s;
}

/** 令牌声明表（CSS 变量）：颜色 + margin/gutter。**唯一顺序来源。** */
export function tokenDeclarations(theme) {
  const t = normalizeTheme(theme);
  const out = [];
  for (const [k, v] of Object.entries(t.colors)) out.push([`--${k}`, String(v).toLowerCase()]);
  if (t.layout.margin !== undefined) out.push(["--margin", cssLength(t.layout.margin)]);
  if (t.layout.gutter !== undefined) out.push(["--gutter", cssLength(t.layout.gutter)]);
  return out;
}

/** 渲染令牌 CSS 块（只有声明行，选择器由调用方包）—— gen-frames 与 init 共用。 */
export function renderTokenBlock(theme, { indent = "      " } = {}) {
  return tokenDeclarations(theme)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join("\n");
}

function re(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `theme.layout` 的值 → frame.md 里该键的 YAML 标量。 */
function yamlScalar(key, value) {
  if (key === "margin" || key === "gutter") return `"${cssLength(value)}"`;
  if (key === "radius") return `"${value}"`;
  if (typeof value === "number") return String(value);
  return `"${value}"`;
}

/** 删掉 CSS 令牌块里主题未定义的颜色变量行（如 collage 没有 `--accent`）。 */
function pruneCssColorVars(text, colors) {
  const drop = new Set(Object.keys(DEFAULT_THEME.colors).filter((k) => !(k in colors)));
  if (!drop.size) return text;
  return text
    .split("\n")
    .filter((line) => {
      const m = line.match(/^\s*--([A-Za-z0-9_-]+)\s*:/);
      return !(m && drop.has(m[1]));
    })
    .join("\n");
}

/** 删掉 `colors:` 块里主题未定义的键（如 collage 没有 `accent`）。 */
function pruneColorLines(text, colors) {
  const out = [];
  let inColors = false;
  for (const line of text.split("\n")) {
    if (/^\s*colors\s*:\s*$/.test(line)) {
      inColors = true;
      out.push(line);
      continue;
    }
    if (inColors) {
      const km = line.match(/^\s+([A-Za-z0-9_-]+)\s*:/);
      if (km) {
        if (!(km[1] in colors)) continue; // 主题没有这个颜色键 → 删
        out.push(line);
        continue;
      }
      if (/^\S/.test(line)) inColors = false; // 顶格键 = colors 块结束
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * 往 `colors:` 块**补**上主题里、模板里没有的颜色键。
 * 没有这一步，主题新增的令牌（如 collage 的 `card`/`halftone`…）永远进不了 frame.md ——
 * 那正是 issues/13 说的「加了令牌但没接线」的静默空操作。
 */
function ensureColorLines(text, colors) {
  const lines = String(text).split("\n");
  const start = lines.findIndex((l) => /^colors\s*:\s*$/.test(l));
  if (start === -1) return text;
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1; // 缩进行都属于本块
  const existing = new Set();
  let indent = "  ";
  for (const l of lines.slice(start + 1, end)) {
    const m = l.match(/^(\s+)([A-Za-z0-9_-]+)\s*:/);
    if (m) {
      existing.add(m[2]);
      indent = m[1];
    }
  }
  const missing = Object.keys(colors).filter((k) => !existing.has(k));
  if (!missing.length) return text;
  const added = missing.map((k) => `${indent}${k}: "${String(colors[k]).toUpperCase()}"`);
  return [...lines.slice(0, end), ...added, ...lines.slice(end)].join("\n");
}

/**
 * 按**令牌名**把主题灌进文本（CSS 变量 + frame.md 的 YAML）。
 * 只认「缩进 ≥1 空格」的 YAML 键，避免误伤顶格的 `paper:` / `layout:` 块名。
 */
export function applyThemeTokens(text, theme) {
  const t = normalizeTheme(theme);
  let out = pruneColorLines(String(text), t.colors);
  out = pruneCssColorVars(out, t.colors);
  out = ensureColorLines(out, t.colors);
  // 1) CSS 自定义属性
  for (const [name, value] of tokenDeclarations(t)) {
    out = out.replace(new RegExp(`(${re(name)}\\s*:\\s*)[^;\\n]+(;)`, "g"), `$1${value}$2`);
  }
  // 2) YAML 颜色键（缩进形）
  //    YAML 值以行尾结束、**不带 `;`**；CSS 声明以 `;` 收尾。
  //    故先负向预查「本行后面有没有 `;`」——有则说明是 CSS 声明，跳过，
  //    否则 `* { margin: 0; }` 会被当成 YAML 的 `margin:` 撞改（issues/15）。
  const yamlValue = (key) =>
    new RegExp(`(^[ \\t]+${re(key)}\\s*:\\s*)(?![^\\n]*;)(?:"[^"]*"|'[^']*'|[^\\n#]+)`, "gm");
  for (const [k, v] of Object.entries(t.colors)) {
    out = out.replace(yamlValue(k), `$1"${String(v).toUpperCase()}"`);
  }
  // 3) YAML paper / layout 键（缩进形）
  for (const [k, v] of Object.entries(t.layout)) {
    out = out.replace(yamlValue(k), `$1${yamlScalar(k, v)}`);
  }
  return out;
}

/** 自证：渲染确定性 + 按名替换 + collage 去 accent + 内置兜底。 */
function selfTest() {
  const fails = [];
  const check = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(`${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    }
  };
  const root = mkdtempSync(join(tmpdir(), "theme-"));
  try {
    // 渲染确定性
    const block = renderTokenBlock(DEFAULT_THEME);
    check("block.paper", block.includes("      --paper: #f1ede4;"), true);
    check("block.margin", block.includes("      --margin: 96px;"), true);
    check("determinism", renderTokenBlock(DEFAULT_THEME), block);

    // loadTheme：无文件 → 内置默认
    check("load.missing", loadTheme(root).source, "builtin-default");

    // loadTheme：有文件 → 读它
    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(
      join(root, "tools", "theme.json"),
      JSON.stringify({ colors: { paper: "#000000" } }),
    );
    const lt = loadTheme(root);
    check("load.present.source", lt.source, join(root, "tools", "theme.json"));
    check("load.present.paper", lt.theme.colors.paper, "#000000");
    check("load.present.layout.default", lt.theme.layout.margin, 96);

    // applyThemeTokens：按名替换 + 去 accent
    const collage = normalizeTheme({
      name: "collage",
      colors: { paper: "#EDE6D6", ink: "#141310" },
      layout: { margin: 96, "pin-size": 14 },
    });
    const sample = [
      "colors:",
      '  paper: "#F1EDE4"',
      '  ink: "#121212"',
      '  accent: "#1D4ED8"',
      "paper:",
      "  halftone-pitch: 10",
      "  pin-size: 14",
      "layout:",
      '  margin: "96px"',
      "",
      "* {",
      "  margin: 0;",
      "  padding: 0;",
      "}",
      "#root {",
      "  --paper: #f1ede4;",
      "  --accent: #1d4ed8;",
      "}",
    ].join("\n");
    const applied = applyThemeTokens(sample, collage);
    check("apply.paper.yaml", applied.includes('  paper: "#EDE6D6"'), true);
    check("apply.accent.yaml.dropped", applied.includes('  accent: "'), false);
    check("apply.css.paper", applied.includes("--paper: #ede6d6;"), true);
    check("apply.accent.css.dropped", applied.includes("--accent:"), false);
    check("apply.margin.yaml", applied.includes('  margin: "96px"'), true);
    // CSS 声明 `margin: 0;` 不得被 YAML 步骤撞改（issues/15）
    check("apply.margin.css.untouched", applied.includes("  margin: 0;"), true);
    check("apply.margin.yaml.only.once", applied.split('  margin: "96px"').length - 1, 1);
    // 主题里独有、模板里没有的颜色键必须被**补进** colors 块（加了要接线）
    const collage2 = normalizeTheme({ colors: { paper: "#EDE6D6", card: "#F4EEDC" } });
    const added = applyThemeTokens(sample, collage2);
    check("apply.missing.color.added", added.includes('  card: "#F4EEDC"'), true);
    check(
      "apply.missing.color.in.block",
      /colors:\n  paper: "#EDE6D6"\n  card: /.test(added),
      true,
    );
    check("apply.determinism", applyThemeTokens(sample, collage), applied);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (fails.length) {
    console.error(`theme self-test FAILED:\n  - ${fails.join("\n  - ")}`);
    return 1;
  }
  console.log("theme self-test OK（渲染确定性 · 按名替换 · collage 去 accent · 内置兜底）");
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  console.log("usage: node theme.mjs --self-test");
  process.exit(2);
}
