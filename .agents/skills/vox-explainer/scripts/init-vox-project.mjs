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

// 令牌源收敛（issues/13）：按**名**灌令牌 + 渲染令牌块，与 gen-frames 共用同一份实现。
import { applyThemeTokens, normalizeTheme } from "./theme.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const TEMPLATES = join(SKILL_ROOT, "templates");

/** 文档级占位符：init 负责填。逐帧占位符（NN / slug / COMPOSITION_ID / DURATION / …）留给作者。 */
const DOC_LEVEL = ["TITLE", "FRAMES", "TOTAL", "CHANNEL_TAG", "AUDIENCE"];
const VENDOR_FILES = ["gsap.min.js", "GSAP-NOTICE.txt"];

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
  for (const file of VENDOR_FILES) {
    const source = join(TEMPLATES, "assets", "vendor", file);
    if (!existsSync(source)) {
      console.error(`[env] 缺少内置 GSAP 资产: ${source}`);
      return 2;
    }
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
    "assets/vendor",
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

  // ── 加载主题预设（令牌单一源）
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
  themeConfig = normalizeTheme(themeConfig ?? {});
  // 把主题落成项目根的 `tools/theme.json` —— 生成器（gen-frames / gen-index）只读它。
  writeFileSync(
    join(target, "tools", "theme.json"),
    JSON.stringify(themeConfig, null, 2) + "\n",
    "utf8",
  );
  written.push("tools/theme.json");

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

  // ── 技能内置字体：开箱即有字体文件，否则骨架的 @font-face 全 404、check 判红。
  //    来源与许可见 templates/assets/fonts/CREDITS.md（四个都是 OFL）；
  //    NotoSansSC-VF.ttf 过大，走 Git LFS（.gitattributes 的 .agents/.claude/skills/**/*.ttf）。
  const fontsDir = join(TEMPLATES, "assets", "fonts");
  if (existsSync(fontsDir)) {
    for (const f of readdirSync(fontsDir)) {
      cpSync(join(fontsDir, f), join(target, "assets", "fonts", f));
      written.push(`assets/fonts/${f}`);
    }
  }
  for (const file of VENDOR_FILES) {
    cpSync(join(TEMPLATES, "assets", "vendor", file), join(target, "assets", "vendor", file));
    written.push(`assets/vendor/${file}`);
  }

  // ── 脚本复制进项目（自包含：接手者不需要知道技能目录在哪）。
  //    分两组：通用门禁 -> tools/vox/；作者侧生成 -> tools/（这两组的分工见 references/_contract.md §5）
  const scriptsDir = join(SKILL_ROOT, "scripts");

  const GATE_SCRIPTS = [
    "audit-frames.mjs",
    // audit-frames 依赖的共享分档模块（issues/01）—— 必须随门禁一起进项目，否则 import 失败
    "gate-tier.mjs",
    "sync-frame-durations.mjs",
    "verify-timeline.mjs",
    "verify-film-audio.mjs",
    "hf.mjs",
    "draft-voice-timeline.mjs",
    "gen-vox-annotation.mjs",
  ];
  /** 作者侧：生成器与素材脚本。run 之前必须先读它们的头部注释（路径多为本机示例） */
  const AUTHORING_SCRIPTS = [
    "slots.mjs",
    "ink.mjs",
    // 撕边（低频 + 振幅随尺寸）生成器（issues/15）
    "torn.mjs",
    // gen-frames 依赖的令牌模块（issues/13）与常量模块（issues/11·22）—— 必须随生成器进项目
    "theme.mjs",
    "motion-const.mjs",
    "gen-frames.mjs",
    "gen-index.mjs",
    // 纸 ASMR 素材生成器（通道 C：ffmpeg 确定性合成；issues/09）
    "gen-asmr.mjs",
    // 生成资产命名桥（调 media-use 的 comfyui provider → .media/assets/gen-<role>-<nn>.png + M5 账本行；issues/10）
    "gen-asset.mjs",
    "align-cues.py",
    "synthesize_voice.py",
    "shot.ps1",
  ];

  const available = new Set(readdirSync(scriptsDir));
  for (const s of GATE_SCRIPTS) {
    if (!available.has(s)) continue;
    cpSync(join(scriptsDir, s), join(target, "tools", "vox", s));
    written.push(`tools/vox/${s}`);
  }
  for (const s of AUTHORING_SCRIPTS) {
    if (!available.has(s)) continue;
    cpSync(join(scriptsDir, s), join(target, "tools", s));
    written.push(`tools/${s}`);
  }
  // beat-* / check-selectors 这类可选工具也一并带上（有就复制）
  for (const s of ["beat-timeline.mjs", "beat-at.mjs", "check-selectors.mjs"]) {
    if (!available.has(s)) continue;
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

## tools/ —— 作者侧生成脚本（改了 frames-data / cues.json 之后按序重跑）

| 脚本 | 用途 | 命令 |
|---|---|---|
| \`synthesize_voice.py\` | 旁白合成 + 量真实秒数 + 写 \`.media/voice-manifest.json\` | \`python tools/synthesize_voice.py [--frame NN]\` |
| \`align-cues.py\` | 词级对齐：\`SCRIPT.md\` + \`tools/cues.json\` + faster-whisper → \`tools/cue-times.json\` | \`python tools/align-cues.py --model medium\` |
| \`gen-frames.mjs\` | 按 \`tools/frames-data.mjs\` 生成 N 帧 + N 个侧车（构建时注入 CUE 表、自动补 \`position\`） | \`node tools/gen-frames.mjs\` |
| \`gen-index.mjs\` | 装配 \`index.html\`（槽位 + 旁白轨 + 音效轨） | \`node tools/gen-index.mjs\` |
| \`slots.mjs\` | 槽位表的唯一计算处（读 wav 头真值） | 被上面两个 import，不单独跑 |
| \`ink.mjs\` | 确定性手绘路径（circle / underline / arrow / rect / check / slash） | 被 \`frames-data.mjs\` import |
| \`shot.ps1\` | 本机 Chrome 无头实拍真实页面（2× → 3788×1960） | \`powershell -File tools/shot.ps1 -Url <url> -Out <png>\` |

> **要自己改的**：\`tools/frames-data.mjs\`（逐帧 CSS / markup / 时间轴）与 \`tools/cues.json\`（线索表）
> 是每个项目自己的内容；\`tools/cue-times.json\` 是机器产物、**不许手改**；
> 帧里**不许写死秒数**。同步链的做法见技能 \`references/voice-sync.md\`。

## 本项目的关键约束

- **帧数是参数**，由内容分段决定，不是固定的 12。见技能 \`references/_contract.md\` §0.5。
- **帧内每个 \`data-duration\` 都必须等于槽位**（层数每帧不同：root + paper/content/grain，实测 2–4 层）。
- **旁白锁定后不许改文案**；要改就得重跑该条 TTS 并重算槽位。
- **每一帧一个作者，写入范围互斥**；编辑帧期间不要开 \`preview\`。
- 两个集成块（\`hf-scene-visibility-leak-guard\` / \`hf-js-hide-reveal-pass\`）**原样保留，别删**。
- 主时间轴的 GSAP 从 \`assets/vendor/gsap.min.js\` 加载；不要改回 CDN。

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
    "  6. 过门禁（门禁链 v2，顺序固定）：sync-frame-durations（修）→ hf.mjs lint → audit-frames → sync-frame-durations --check → verify-timeline → seam-gate verify（第 6 道；需无头 Chrome）→ hf.mjs check --json --out .hyperframes/check-latest.json",
  );
  return 0;
}

process.exit(main());
