#!/usr/bin/env node
/**
 * gen-asset.mjs — vox 侧「生成资产命名桥」。
 *
 * 为什么需要它：生成图（氛围 / 转场 / 封面）由公共技能 `media-use` 的 comfyui
 * provider 出图，落盘是它自己的命名（`.media/images/image_NNN.png`）与它自己的
 * 账本行。vox 管线要的是 `.media/assets/gen-<role>-<nn>.png` 加本项目的材料账本
 * `tier:"M5"` 行（带 model / seed / refs / license）。本脚本就是那座桥：调
 * `resolve` → 改名 → 记 vox 账本。它**不重写** `media-use`（那是公共技能）。
 *
 * 一致性纪律（来源票 `../vox-collage/issues/17` §3 / §7.4 / §7.11）：
 *   - 一张**中性锚图** `gen-anchor-01.png`（t2i，冻结后不改），它是这个世界的
 *     纸种 / 色板 / 颗粒度；
 *   - 其余每一张都用 `--ref <锚图>` 走参考编辑，**prompt 必须写 `<image1>` 显式
 *     指代那张参考图**（不写，模型不知道哪张是哪张 → 会另画一张）；
 *   - prompt = **固定风格前缀块**（`STYLE_PREFIX`）+ 这一张要什么。前缀块只描述
 *     纸种 / 色板 / 颗粒度 / 光照 / 禁区，**不描述主体**。
 *
 * 许可（来源票 `17` §1）：`Qwen-Image-2.1` = **Qwen Research License（仅非商用）**
 * ⇒ 每条 `gen-*` 账本行记 `license: "qwen-research (non-commercial)"`，且这些资产
 * **不得用于商用 / 变现项目**。
 *
 * 用法：
 *   node tools/gen-asset.mjs --role anchor --intent "一张空的奶油色新闻纸，直视满幅"
 *   node tools/gen-asset.mjs --role mood --ref .media/assets/gen-anchor-01.png \
 *     --intent "<image1> 是这个世界的一张纸，保留它，只加几片空白的撕纸拼贴" --width 1920 --height 1088
 *   node tools/gen-asset.mjs --role transition --ref .media/assets/gen-anchor-01.png \
 *     --intent "<image1> 保留纸面，只加一条新撕的毛边" --width 1920 --height 1088
 *   node tools/gen-asset.mjs --role cover --ref .media/assets/gen-anchor-01.png \
 *     --intent "<image1> 保留纸面，右上角加一条美纹胶带" --width 1152 --height 704
 *
 * 参数：
 *   --role <anchor|mood|transition|cover>  必填
 *   --intent <text>                        必填；带 --ref 时必须含 `<image1>`
 *   --project <dir>                        默认 .
 *   --seed <int>                           默认 20260923（固定；换 seed = 换一版世界）
 *   --ref <path>                           参考图（通常是锚图）；缺省 = t2i 直接出图
 *   --width / --height <px>                目标尺寸（会 snap 到 32 的倍数）
 *   --steps <n>                            采样步数，默认 30
 *   --nn <NN>                              产物序号，默认 01
 *   --transparent                          原生 RGBA 输出
 *   --provider <name>                      默认 comfyui
 *   --media-use <resolve.mjs 路径>         覆盖 media-use 定位
 *   --dry-run                              只打印将执行的 resolve 命令，不生成、不记账
 *   --json                                 机器可读输出
 *   --help, -h
 *
 * 退出码：0 成功；1 生成 / 记账失败；2 参数错误
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/** 冻结的风格前缀块 —— 只描述「这个世界」的纸种 / 色板 / 颗粒度 / 光照 / 禁区。 */
export const STYLE_PREFIX =
  "aged cream newsprint paper, warm off-white ground, fine halftone printing grain, " +
  "soft paper fibres, subtle edge ageing, flat even scan lighting, " +
  "muted warm palette of cream / ink black / halftone grey / one hot red / restrained mustard, " +
  "no text, no words, no numbers, no lettering, no labels, no UI, no shadows";

/** 封面的额外禁区：生成层只做氛围 / 纸层，不得出现假 UI / 假代码（来源票 12）。 */
export const COVER_BAN = "no interface mockups, no app screenshots, no code, no charts, no logos";

export const DEFAULT_SEED = 20260923;
export const LICENSE = "qwen-research (non-commercial)";
export const ROLES = ["anchor", "mood", "transition", "cover"];

function normalizeModelSha256(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

function parseArgs(argv) {
  const out = {
    role: null,
    intent: null,
    project: ".",
    seed: DEFAULT_SEED,
    ref: null,
    width: null,
    height: null,
    steps: 30,
    nn: "01",
    modelSha256: null,
    transparent: false,
    provider: "comfyui",
    mediaUse: null,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--role") out.role = argv[++i];
    else if (a === "--intent") out.intent = argv[++i];
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--seed") out.seed = Number(argv[++i]);
    else if (a === "--ref") out.ref = argv[++i];
    else if (a === "--width") out.width = Number(argv[++i]);
    else if (a === "--height") out.height = Number(argv[++i]);
    else if (a === "--steps") out.steps = Number(argv[++i]);
    else if (a === "--nn") out.nn = argv[++i];
    else if (a === "--model-sha256") out.modelSha256 = argv[++i];
    else if (a === "--transparent") out.transparent = true;
    else if (a === "--provider") out.provider = argv[++i];
    else if (a === "--media-use") out.mediaUse = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`[gen-asset] 未知参数: ${a}`);
      process.exit(2);
    }
  }
  if (!/^\d{2,}$/.test(String(out.nn))) {
    console.error("[gen-asset] --nn 必须是两位以上数字，如 01");
    process.exit(2);
  }
  return out;
}

const HELP = `vox 生成资产命名桥（调 media-use 的 comfyui provider → 改名 → 记 vox 账本）

用法:
  node tools/gen-asset.mjs --role <anchor|mood|transition|cover> --intent "<这一张要什么>" [选项]

选项:
  --role        anchor | mood | transition | cover（必填）
  --intent      这一张要什么（必填）。带 --ref 时**必须**含 <image1>
  --project     项目根，默认 .
  --seed        固定 seed，默认 ${DEFAULT_SEED}
  --ref         参考图（通常是 .media/assets/gen-anchor-01.png）
  --width/--height  目标尺寸（snap 到 32 的倍数）
  --steps       采样步数，默认 30
  --nn          产物序号，默认 01
  --model-sha256 64 位模型文件 SHA-256（写入复现账本）
  --transparent 原生 RGBA
  --provider    默认 comfyui
  --media-use   覆盖 media-use 的 resolve.mjs 路径（也可用 env MEDIA_USE_RESOLVE）
  --dry-run     只打印命令
  --json        机器可读输出
`;

/** 定位 media-use 的 resolve.mjs：显式 > env > 仓库开发树 > 全局安装。 */
export function locateResolve(explicit) {
  const here = import.meta.dirname;
  const candidates = [
    explicit,
    process.env.MEDIA_USE_RESOLVE,
    // 源技能树：<repo>/.agents/skills/vox-explainer/scripts → <repo>/skills/media-use
    join(here, "..", "..", "..", "..", "skills", "media-use", "scripts", "resolve.mjs"),
    join(homedir(), ".config", "opencode", "skills", "media-use", "scripts", "resolve.mjs"),
    join(homedir(), ".claude", "skills", "media-use", "scripts", "resolve.mjs"),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

/** 组合这一张的 prompt：固定前缀块 + 这一张要什么（+ 封面禁区）。 */
export function composePrompt(role, intent) {
  const parts = [STYLE_PREFIX, String(intent).trim()];
  if (role === "cover") parts.push(COVER_BAN);
  return parts.join(", ");
}

/** 参考图按项目根相对路径记录（账本里一律写项目根相对路径）。 */
export function toProjectRelative(projectDir, refPath) {
  const abs = isAbsolute(refPath) ? refPath : resolvePath(projectDir, refPath);
  const rel = relative(projectDir, abs);
  return rel.split("\\").join("/");
}

/** 组装交给 resolve.mjs 的参数（纯函数，便于自证）。 */
export function buildResolveArgs({
  prompt,
  provider,
  scratchDir,
  seed,
  steps,
  width,
  height,
  modelSha256,
  transparent,
  ref,
}) {
  const args = [
    "--type",
    "image",
    "--provider",
    provider,
    "--intent",
    prompt,
    "--project",
    scratchDir,
    "--seed",
    String(seed),
    "--steps",
    String(steps),
    "--json",
  ];
  if (modelSha256) args.push("--model-sha256", modelSha256);
  if (width && height) args.push("--width", String(width), "--height", String(height));
  if (transparent) args.push("--transparent");
  if (ref) args.push("--process", "--image", ref);
  return args;
}

/** 构造 vox 材料账本的 M5 行（对齐 issues/23 的 schema）。 */
export function buildLedgerRow({ role, nn, rel, provenance, refRel, seed, method, workflowPath }) {
  return {
    id: `gen-${role}-${nn}`,
    path: rel,
    type: "image",
    role,
    kind: "gen",
    tier: "M5",
    origin: `comfyui ${provenance?.model || "qwen"} (${provenance?.provider || "comfyui"})`,
    method,
    used_in: [],
    size: { width: provenance?.width ?? null, height: provenance?.height ?? null },
    model: provenance?.model || null,
    model_file: provenance?.model_file || provenance?.model || null,
    model_sha256: provenance?.model_sha256 || null,
    seed,
    loras: [],
    refs: refRel ? [{ path: refRel, ref_role: "style" }] : [],
    workflow_path: workflowPath || null,
    attempts: 1,
    license: LICENSE,
  };
}

export function writeWorkflowSnapshot(projectDir, role, nn, workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return null;
  const rel = `.media/gen/${role}-${nn}.workflow.json`;
  const abs = join(projectDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return rel;
}

/** 追加一行账本（同 path 的旧行先移除，重跑幂等）。返回该行。 */
export function appendLedgerRow(projectDir, row) {
  const ledgerPath = join(projectDir, ".media", "manifest.jsonl");
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const kept = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => {
          if (!line.trim()) return false;
          try {
            return JSON.parse(line).path !== row.path;
          } catch {
            return true; // 坏行不吞掉，原样保留让门禁去报
          }
        })
    : [];
  kept.push(JSON.stringify(row));
  writeFileSync(ledgerPath, `${kept.join("\n")}\n`);
  return row;
}

function fail(message, code = 2) {
  console.error(`[gen-asset] ${message}`);
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!args.role || !ROLES.includes(args.role)) {
    fail(`--role 必须是 ${ROLES.join(" | ")}`);
  }
  if (!args.intent || !args.intent.trim()) fail("--intent 必填");
  if (args.modelSha256 !== null && !normalizeModelSha256(args.modelSha256)) {
    fail("--model-sha256 必须是 64 位十六进制 SHA-256");
  }

  const projectDir = resolvePath(args.project);
  const role = args.role;
  const nn = String(args.nn);
  const rel = `.media/assets/gen-${role}-${nn}.png`;

  if (role === "anchor" && args.ref) {
    fail("--role anchor 是那张 t2i 锚图，不接受 --ref（其余角色用 --ref 指向锚图）");
  }
  if (args.ref && !/<image1>/.test(args.intent)) {
    fail('带 --ref 时 --intent 必须用 "<image1>" 显式指代参考图（否则模型会另画一张）');
  }

  const refAbs = args.ref ? resolvePath(projectDir, args.ref) : null;
  if (refAbs && !existsSync(refAbs)) fail(`参考图不存在: ${args.ref}`);

  const resolvePath_ = locateResolve(args.mediaUse);
  if (!resolvePath_) {
    fail(
      "找不到 media-use 的 resolve.mjs —— 用 --media-use <path> 或 env MEDIA_USE_RESOLVE 指定",
      1,
    );
  }

  const prompt = composePrompt(role, args.intent);
  // media-use 在 scratch 项目里落它自己的命名与账本；桥再把产物搬进 vox 项目，
  // 避免 media-use 的账本行混进 vox 账本（两者 schema 不同）。
  const scratchDir = join(projectDir, ".media", "gen", ".scratch", `${role}-${nn}`);
  mkdirSync(scratchDir, { recursive: true });

  const resolveArgs = buildResolveArgs({
    prompt,
    provider: args.provider,
    scratchDir,
    seed: args.seed,
    steps: args.steps,
    width: args.width,
    height: args.height,
    modelSha256: normalizeModelSha256(args.modelSha256),
    transparent: args.transparent,
    ref: refAbs,
  });

  if (args.dryRun) {
    console.log(
      `[dry-run] node ${resolvePath_} ${resolveArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
    );
    process.exit(0);
  }

  const run = spawnSync(process.execPath, [resolvePath_, ...resolveArgs], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error) fail(`调用 resolve 失败: ${run.error.message}`, 1);
  const stdout = run.stdout || "";
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => l.startsWith("{"));
  let rec = null;
  try {
    rec = jsonLine ? JSON.parse(jsonLine) : null;
  } catch {
    rec = null;
  }
  if (!rec || rec.ok !== true) {
    const why =
      rec?.error ||
      (run.stderr || "").trim().split(/\r?\n/).slice(-3).join(" ") ||
      `resolve exit ${run.status}`;
    fail(`生成失败: ${why}`, 1);
  }

  const srcAbs = resolvePath(scratchDir, rec.path);
  if (!existsSync(srcAbs)) fail(`resolve 报的产物不存在: ${rec.path}`, 1);

  const provenance = rec.provenance || {};
  if (provenance.provider?.startsWith("comfyui.") && !provenance.workflow) {
    fail("ComfyUI 返回结果缺少 workflow graph，拒绝写入不完整的 M5 资产", 1);
  }
  if (args.modelSha256 && provenance.model_sha256 !== normalizeModelSha256(args.modelSha256)) {
    fail("ComfyUI 返回的 model_sha256 与传入值不一致", 1);
  }
  const workflowPath = writeWorkflowSnapshot(projectDir, role, nn, provenance.workflow);
  const destAbs = join(projectDir, rel);
  mkdirSync(dirname(destAbs), { recursive: true });
  try {
    renameSync(srcAbs, destAbs);
  } catch {
    copyFileSync(srcAbs, destAbs);
    rmSync(srcAbs, { force: true });
  }
  // 清掉 scratch 的 media-use 自记账本（产物已迁走，留着会指向不存在的文件）
  rmSync(join(scratchDir, ".media"), { recursive: true, force: true });

  const isEdit = !!refAbs;
  const refRel = isEdit ? toProjectRelative(projectDir, args.ref) : null;
  const row = appendLedgerRow(
    projectDir,
    buildLedgerRow({
      role,
      nn,
      rel,
      provenance,
      refRel,
      seed: args.seed,
      workflowPath,
      method: isEdit
        ? `reference edit from ${refRel} (seed ${args.seed})`
        : `text-to-image (seed ${args.seed})`,
    }),
  );

  if (args.json) {
    console.log(
      JSON.stringify({
        ok: true,
        role,
        path: rel,
        row,
        provider: provenance.provider || null,
        model_sha256: provenance.model_sha256 || null,
        workflow_path: workflowPath,
      }),
    );
  } else {
    const dims =
      provenance.width && provenance.height ? `${provenance.width}×${provenance.height}` : "?";
    console.log(
      `生成 ${rel} (${role}, ${dims}, seed ${args.seed}) → 账本 tier:M5 / license ${LICENSE}`,
    );
  }
}

/** 自证：`node gen-asset.mjs --self-test`（纯函数 + 账本追加/幂等）。 */
function selfTest() {
  const fails = [];
  const check = (name, got, want) => {
    const a = JSON.stringify(got);
    const b = JSON.stringify(want);
    if (a !== b) fails.push(`${name}: got ${a}, want ${b}`);
  };

  const moodPrompt = composePrompt("mood", "<image1> 加几片纸");
  if (!moodPrompt.startsWith(STYLE_PREFIX)) fails.push("composePrompt: 前缀块必须打头");
  if (!moodPrompt.includes("<image1> 加几片纸")) fails.push("composePrompt: 必须包含 intent");
  if (moodPrompt.includes(COVER_BAN)) fails.push("composePrompt: 非封面不得带封面禁区");
  if (!composePrompt("cover", "x").includes(COVER_BAN)) fails.push("composePrompt: 封面必须带禁区");

  const withRef = buildResolveArgs({
    prompt: "p",
    provider: "comfyui",
    scratchDir: "/s",
    seed: 7,
    steps: 30,
    width: 1920,
    height: 1088,
    modelSha256: "a".repeat(64),
    transparent: false,
    ref: "/a.png",
  });
  if (!(withRef.includes("--process") && withRef.includes("--image") && withRef.includes("/a.png")))
    fails.push("buildResolveArgs: 带 ref 必须走 --process --image");
  check("buildResolveArgs seed", withRef[withRef.indexOf("--seed") + 1], "7");
  check("buildResolveArgs width", withRef[withRef.indexOf("--width") + 1], "1920");
  check(
    "buildResolveArgs model hash",
    withRef[withRef.indexOf("--model-sha256") + 1],
    "a".repeat(64),
  );

  const noSize = buildResolveArgs({
    prompt: "p",
    provider: "comfyui",
    scratchDir: "/s",
    seed: 1,
    steps: 30,
    width: null,
    height: null,
    transparent: false,
    ref: null,
  });
  if (noSize.includes("--process")) fails.push("buildResolveArgs: 无 ref 不得带 --process");
  if (noSize.includes("--width")) fails.push("buildResolveArgs: 无尺寸不得带 --width");

  check(
    "toProjectRelative",
    toProjectRelative("C:/p", ".media/assets/a.png"),
    ".media/assets/a.png",
  );
  check(
    "toProjectRelative abs",
    toProjectRelative("C:/p", "C:/p/.media/assets/a.png"),
    ".media/assets/a.png",
  );

  const row = buildLedgerRow({
    role: "mood",
    nn: "01",
    rel: ".media/assets/gen-mood-01.png",
    provenance: {
      provider: "comfyui.qwen_image_2_1_edit",
      model: "m.safetensors",
      model_file: "m.safetensors",
      model_sha256: "b".repeat(64),
      width: 1920,
      height: 1088,
    },
    refRel: ".media/assets/gen-anchor-01.png",
    seed: 20260923,
    workflowPath: ".media/gen/mood-01.workflow.json",
    method: "reference edit",
  });
  check("row.tier", row.tier, "M5");
  check("row.license", row.license, LICENSE);
  check("row.model", row.model, "m.safetensors");
  check("row.model_file", row.model_file, "m.safetensors");
  check("row.model_sha256", row.model_sha256, "b".repeat(64));
  check("row.workflow_path", row.workflow_path, ".media/gen/mood-01.workflow.json");
  check("row.seed", row.seed, 20260923);
  check("row.refs", row.refs, [{ path: ".media/assets/gen-anchor-01.png", ref_role: "style" }]);
  if (!row.path || !row.origin) fails.push("row: path/origin 必填");

  const dir = join(tmpdir(), `gen-asset-selftest-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, ".media"), { recursive: true });
  const workflowPath = writeWorkflowSnapshot(dir, "mood", "01", {
    sampler: { inputs: { seed: 7 } },
  });
  check("writeWorkflowSnapshot path", workflowPath, ".media/gen/mood-01.workflow.json");
  check(
    "writeWorkflowSnapshot content",
    JSON.parse(readFileSync(join(dir, workflowPath), "utf8")).sampler.inputs.seed,
    7,
  );
  writeFileSync(
    join(dir, ".media", "manifest.jsonl"),
    `${JSON.stringify({ path: ".media/assets/gen-mood-01.png", tier: "M5" })}\n${JSON.stringify({
      path: ".media/audio/voice/voice_001.wav",
      tier: "M1",
    })}\n`,
  );
  appendLedgerRow(dir, row);
  appendLedgerRow(dir, row); // 同 path 重跑必须幂等
  const lines = readFileSync(join(dir, ".media", "manifest.jsonl"), "utf8")
    .trim()
    .split("\n");
  check("appendLedgerRow 行数", lines.length, 2);
  const parsed = lines.map((l) => JSON.parse(l));
  check(
    "appendLedgerRow 保留无关行",
    parsed.some((r) => r.path === ".media/audio/voice/voice_001.wav"),
    true,
  );
  check(
    "appendLedgerRow 替换同 path",
    parsed.filter((r) => r.path === ".media/assets/gen-mood-01.png").length,
    1,
  );
  rmSync(dir, { recursive: true, force: true });

  if (fails.length) {
    console.error(`gen-asset self-test FAILED:\n  - ${fails.join("\n  - ")}`);
    return 1;
  }
  console.log(
    "gen-asset self-test OK（前缀块 · resolve 参数 · 账本 M5 行 · workflow 快照 · 追加幂等）",
  );
  return 0;
}

const isMain = process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  main();
}
