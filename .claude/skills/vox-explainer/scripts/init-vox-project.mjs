#!/usr/bin/env node
/**
 * init-vox-project.mjs — 从一个 VOX 项目骨架起手。
 *
 * 为什么需要它：本管线是"从 brief 到成片"的全链路，但**逐帧参数**（comp id / 槽位时长 / 标题）
 * 不该靠人肉记得。脚手架把**文档级参数**一次填好，把**逐帧模板**放进 `_templates/` 备用，
 * 并顺手把本技能的门禁脚本复制进项目，让项目自包含（接手者不必知道技能目录在哪）。
 *
 * 它**不**生成帧内容 —— 帧是作者按 `_templates/frame-skeleton.html` 逐帧写的。
 * 它**不**做 TTS —— 见 references/pipeline-stages.md 阶段④。
 *
 * 用法：
 *   node init-vox-project.mjs <目标目录> [--title "…"] [--framespreset 12] [--force]
 * 退出码：0 = 成功，1 = 已存在/有残留，2 = 用法错误
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const TEMPLATES = join(SKILL_ROOT, "templates");

/** 文档级占位符：init 负责填。逐帧占位符（NN / slug / COMPOSITION_ID / DURATION / …）留给作者。 */
const DOC_LEVEL = ["TITLE", "FRAMES", "TOTAL", "CHANNEL_TAG", "AUDIENCE"];

/**
 * **预期残留**：这些占位符在 `_templates/` 的逐帧模板里是**故意留着**的，
 * 而且逐帧模板里也包含文档级占位符与逐帧占位符的混合 —— 所以不能按文件名区分。
 * 出现在这些名字里的残留是正常的，不算"模板与脚本不同步"。
 */
const PER_FRAME = new Set([
  "NN",
  "FRAME_NN",
  "slug",
  "COMPOSITION_ID",
  "DURATION",
  "HEADLINE",
  "RULE_1",
  "RULE_2",
  // index.html 模板里给作者看的槽位示例（D0x=槽位时长 / V0x=旁白时长 / S0x=音效时长）
  "D01",
  "V01",
  "S01",
  // 逐帧中文占位符
  "该帧角色",
  "该行角色",
  "起",
  "止",
]);

function parseArgs(argv) {
  const out = {
    target: null,
    title: null,
    channelTag: null,
    frames: null,
    theme: "paper",
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--title") out.title = argv[++i];
    else if (a === "--channel-tag") out.channelTag = argv[++i];
    else if (a === "--frames") out.frames = argv[++i];
    else if (a === "--theme") out.theme = argv[++i]?.toLowerCase();
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) out.target = a;
    else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function substitute(text, vars) {
  let out = text;
  for (const key of DOC_LEVEL) {
    const value = vars[key];
    if (value === undefined || value === null) continue;
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

function applyThemeTokens(text, themeConfig) {
  if (!themeConfig || !themeConfig.colors) return text;
  let out = text;
  const c = themeConfig.colors;
  const paperShadow = c["paper-shadow"] || c["paper-deep"];

  // 替换 frame.md 中的 YAML 色彩声明
  out = out.replace(/paper:\s*"#F1EDE4"/i, `paper: "${c.paper}"`);
  out = out.replace(/paper-deep:\s*"#E3DCCC"/i, `paper-deep: "${c["paper-deep"]}"`);
  out = out.replace(/paper-shadow:\s*"#[A-Fa-f0-9]+"/i, `paper-shadow: "${paperShadow}"`);
  out = out.replace(/ink:\s*"#121212"/i, `ink: "${c.ink}"`);
  out = out.replace(/ink-soft:\s*"#514C44"/i, `ink-soft: "${c["ink-soft"]}"`);
  out = out.replace(/rule:\s*"#C9C2B4"/i, `rule: "${c.rule}"`);
  out = out.replace(/accent:\s*"#1D4ED8"/i, `accent: "${c.accent}"`);
  out = out.replace(/signal:\s*"#E23A2E"/i, `signal: "${c.signal}"`);
  out = out.replace(/marker:\s*"#FFD400"/i, `marker: "${c.marker}"`);

  // 替换 frame-skeleton.html 中的 CSS 变量
  out = out.replace(/--paper:\s*#f1ede4;/i, `--paper: ${c.paper.toLowerCase()};`);
  out = out.replace(/--paper-deep:\s*#e3dccc;/i, `--paper-deep: ${c["paper-deep"].toLowerCase()};`);
  out = out.replace(
    /--paper-shadow:\s*#[a-f0-9]+;/i,
    `--paper-shadow: ${paperShadow.toLowerCase()};`,
  );
  out = out.replace(/--ink:\s*#121212;/i, `--ink: ${c.ink.toLowerCase()};`);
  out = out.replace(/--ink-soft:\s*#514c44;/i, `--ink-soft: ${c["ink-soft"].toLowerCase()};`);
  out = out.replace(/--rule:\s*#c9c2b4;/i, `--rule: ${c.rule.toLowerCase()};`);
  out = out.replace(/--accent:\s*#1d4ed8;/i, `--accent: ${c.accent.toLowerCase()};`);
  out = out.replace(/--signal:\s*#e23a2e;/i, `--signal: ${c.signal.toLowerCase()};`);
  out = out.replace(/--marker:\s*#ffd400;/i, `--marker: ${c.marker.toLowerCase()};`);

  // 替换 index.html 中的背景色（覆盖 body 与 #root 两处）
  out = out.replace(/background:\s*#f1ede4;/gi, `background: ${c.paper.toLowerCase()};`);

  return out;
}

function findLeftover(text) {
  return [...new Set([...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]))];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) {
    console.log(
      'usage: node init-vox-project.mjs <目标目录> [--title "…"] [--channel-tag "…"] [--frames N] [--theme paper|terminal-dark|minimal-swiss] [--force]',
    );
    return args.help ? 0 : 2;
  }
  const target = resolve(args.target);
  if (!existsSync(TEMPLATES)) {
    console.error(`[env] 找不到 templates 目录: ${TEMPLATES}`);
    return 2;
  }
  if (existsSync(target)) {
    const entries = readdirSync(target);
    if (entries.length > 0 && !args.force) {
      console.error(`[usage] 目标目录已存在且非空: ${target}\n        确认要覆盖请加 --force`);
      return 2;
    }
  }

  const title = args.title ?? "（待填：片子标题）";
  const frames = args.frames ?? "（待填：帧数，由内容分段决定 —— 见 references/_contract.md §0.5）";
  const channelTag = args.channelTag ?? "（待填：左上频道标签，如 DSH · AGENT TEAMS）";
  const vars = {
    TITLE: title,
    FRAMES: frames,
    TOTAL: "（待填：槽位之和，由 verify-timeline.mjs 产出）",
    CHANNEL_TAG: channelTag,
    AUDIENCE: "（待填：与 BRIEF.md 的 audience 一致）",
  };

  // ── 目录骨架
  for (const dir of [
    "compositions/frames",
    "compositions/components",
    "assets/fonts",
    ".media/assets",
    ".media/audio/voice",
    ".media/audio/sfx",
    "renders",
    "tools/vox",
    "_templates",
  ]) {
    mkdirSync(join(target, dir), { recursive: true });
  }

  const written = [];
  /** 文档级占位符漏填 = 真的不同步（失败）；逐帧占位符残留 = 作者的活（不算失败） */
  const residueDocLevel = [];
  const residuePerFrame = [];

  const collectResidue = (file, text) => {
    const all = findLeftover(text);
    const doc = all.filter((p) => !PER_FRAME.has(p));
    const perFrame = all.filter((p) => PER_FRAME.has(p));
    if (doc.length) residueDocLevel.push({ file, placeholders: doc });
    if (perFrame.length) residuePerFrame.push({ file, placeholders: perFrame });
  };

  // ── 加载主题预设
  const themeName = args.theme || "paper";
  const themeFile = join(SKILL_ROOT, "themes", `${themeName}.json`);
  let themeConfig = null;
  if (existsSync(themeFile)) {
    try {
      themeConfig = JSON.parse(readFileSync(themeFile, "utf8"));
    } catch (e) {
      console.warn(`[theme] 无法解析主题文件 ${themeFile}: ${e.message}`);
    }
  } else {
    console.warn(`[theme] 未找到主题预设 "${themeName}"，使用默认 paper 主题`);
  }

  // ── 项目根文件：文档级占位符全部替换
  const rootFiles = [
    ["brief.md", "BRIEF.md"],
    ["frame.md", "frame.md"],
    ["script.md", "SCRIPT.md"],
    ["storyboard.md", "STORYBOARD.md"],
    ["index-timeline.html", "index.html"],
  ];
  for (const [src, dest] of rootFiles) {
    const srcPath = join(TEMPLATES, src);
    let text = substitute(readFileSync(srcPath, "utf8"), vars);
    if ((dest === "frame.md" || dest === "index.html") && themeConfig) {
      text = applyThemeTokens(text, themeConfig);
    }
    const destPath = join(target, dest);
    writeFileSync(destPath, text, "utf8");
    written.push(dest);
    collectResidue(dest, text);
  }

  // ── 逐帧模板：文档级占位符也替换掉，逐帧占位符**故意保留**供作者逐帧复制
  for (const src of ["frame-skeleton.html", "frame.motion.json"]) {
    const dest = join("_templates", src);
    let text = substitute(readFileSync(join(TEMPLATES, src), "utf8"), vars);
    if (src === "frame-skeleton.html" && themeConfig) {
      text = applyThemeTokens(text, themeConfig);
    }
    writeFileSync(join(target, dest), text, "utf8");
    written.push(dest);
    collectResidue(dest, text);
  }

  // ── 门禁脚本复制进项目（自包含：接手者不需要知道技能目录在哪）
  const scriptsDir = join(SKILL_ROOT, "scripts");
  const scripts = readdirSync(scriptsDir).filter(
    (f) => f.endsWith(".mjs") && f !== "init-vox-project.mjs",
  );
  for (const s of scripts) {
    cpSync(join(scriptsDir, s), join(target, "tools", "vox", s));
    written.push(`tools/vox/${s}`);
  }

  // ── 项目侧 README：说明门禁与技能文档在哪
  const readme = `# tools/ · vox-explainer 施工与门禁

本目录由 \`vox-explainer\` 技能初始化（主题: ${themeConfig?.displayName || themeName}）。

## tools/vox/ —— 门禁与生产脚本（已复制进项目，可直接跑）

| 脚本 | 用途 | 命令 |
|---|---|---|
| \`hf.mjs\` | 门禁包装（lint / check / snapshot） | \`node tools/vox/hf.mjs lint --json\`；\`node tools/vox/hf.mjs check --json --out .hyperframes/check-latest.json\` |
| \`audit-frames.mjs\` | 静态扫 9 条已知坑（支持 --frame 单帧） | \`node tools/vox/audit-frames.mjs [--frame NN] --json\` |
| \`sync-frame-durations.mjs\` | 帧内四处时长 + \`.motion.json\` 侧车 \`duration_s\` 对齐（支持 --frame 单帧） | \`node tools/vox/sync-frame-durations.mjs [--frame NN]\` ／ \`--check\` 只报告 |
| \`verify-timeline.mjs\` | 槽位 vs 真实旁白时长 | \`node tools/vox/verify-timeline.mjs --json\` |
| \`verify-film-audio.mjs\` | 语音 vs 杂音判别 | \`node tools/vox/verify-film-audio.mjs <media> <start> <dur>\` |
| \`gen-vox-annotation.mjs\` | DOM/坐标锚定手绘 SVG 生成器 | \`node tools/vox/gen-vox-annotation.mjs --rect "x,y,w,h"\` |
| \`draft-voice-timeline.mjs\`| 前置文案时序推导与打样 | \`node tools/vox/draft-voice-timeline.mjs\` |

## 本项目的关键约束

- **帧数是参数**，由内容分段决定，不是固定的 12。见技能 \`references/_contract.md\` §0.5。
- **帧内每个 \`data-duration\` 都必须等于槽位**（层数每帧不同：root + paper/content/grain，实测 2–4 层）。
- **旁白锁定后不许改文案**；要改就得重跑该条 TTS 并重算槽位。
- **每一帧一个作者，写入范围互斥**；编辑帧期间不要开 \`preview\`。
- 两个集成块（\`hf-scene-visibility-leak-guard\` / \`hf-js-hide-reveal-pass\`）**原样保留，别删**。

## 技能文档（不在本项目内）

\`.claude/skills/vox-explainer/\`：\`SKILL.md\` + \`references/\`（契约 / 视觉语法 / 叙事弧线 /
流水线各阶段 / 材料化 / 验证 / 坑清单）。要改帧之前先读 \`references/pitfalls.md\`。
`;
  writeFileSync(join(target, "tools", "README.md"), readme, "utf8");
  written.push("tools/README.md");

  // ── 报告
  console.log(`vox-explainer 项目骨架已建立：${target}\n`);
  for (const w of written) console.log(`  + ${w}`);
  console.log("");
  if (residueDocLevel.length) {
    console.log("✗ 以下文件有**未替换的文档级占位符**（说明模板与脚本不同步，必须修）：");
    for (const r of residueDocLevel) console.log(`   ${r.file}: ${r.placeholders.join(", ")}`);
    return 1;
  }
  console.log("✓ 文档级占位符已全部替换。");
  if (residuePerFrame.length) {
    console.log("");
    console.log("○ 以下位置保留**逐帧占位符**，这是预期的 —— 逐帧由作者填：");
    for (const r of residuePerFrame) console.log(`   ${r.file}: ${r.placeholders.join(", ")}`);
    console.log("   （逐帧模板在 _templates/，复制 N 份、每份填成对应帧；N = 你定的帧数）");
  }
  console.log("");
  console.log("下一步（顺序不要跳）：");
  console.log("  1. 填 BRIEF.md（先定 message / audience / length）");
  console.log("  2. 按 references/narrative-arc.md 分段 → 段数即帧数 → 填 STORYBOARD.md");
  console.log("  3. 写 SCRIPT.md（旁白逐字锁定）后合成旁白");
  console.log("  4. 跑 verify-timeline.mjs 拿真实槽位表，回填 index.html 与 BRIEF.md 运行中记录");
  console.log("  5. 按 _templates/frame-skeleton.html 逐帧施工，每帧交 .motion.json 侧车");
  console.log(
    "  6. 过门禁（顺序固定）：sync-frame-durations（修）→ audit-frames → sync-frame-durations --check → hf.mjs lint → hf.mjs check --json --out .hyperframes/check-latest.json",
  );
  return 0;
}

process.exit(main());
