#!/usr/bin/env node
/**
 * hf.mjs — vox-explainer 的门禁包装。**一律走包装，不要直接调 CLI。**
 *
 * 存在的唯一理由：`check` 有两类**静默失败**，只看退出码分不出来。
 *
 *   A. 运行时阶段静默空跑却报 ok —— 输出里 duration=0 / samples=[] / contrast.checked=0。
 *      包装对 check 固定注入 `--no-browser-gpu`（走软件渲染 SwiftShader）来避免它。
 *
 *   B. 运行时阶段被**环境**打断，却长得像代码有 bug —— 本项目在受限沙箱内实测到
 *      `check_runtime_failure: spawn EPERM` / exit 1。EINVAL 的原因是沙箱禁止命名管道，
 *      CLI 内部 spawn 无头浏览器需要管道 → 浏览器起不来。**这不是片子的 bug，是环境边界。**
 *      实测 `--no-browser-gpu` **并不能**绕过它（Chrome 仍然要用管道通信）。
 *
 * 所以包装不去猜，而是把两种情形分开说清，并把"自证"责任交还给人/CI：
 *   · lint 可以直接靠退出码判定（它不需要浏览器）
 *   · check **只靠退出码不够**，必须看 --json 里的三件事（见下）
 *
 * ## check 的自证要求（唯一可信的通过条件）
 *
 *   1. 退出码 0
 *   2. `samples.length > 0`    —— 否则运行时阶段根本没跑
 *   3. `contrast.checked > 0`  —— 否则对比度审计根本没跑
 *   4. `duration > 0`          —— 否则它读到的是一张空页
 *   5. 各段 `errorCount` / `warningCount` 合计为 0 —— 与文档判据"0 error 且 0 warning"一致
 *
 * 受限沙箱内无法程序化捕获 CLI 的 stdout（见下），因此第 2–4 项需要人工/CI 核对。
 * **本包装绝不会在没有核对的情况下声称 check 通过。**
 *
 * ## 为什么不自作聪明去解析输出
 *
 * 受限沙箱禁止命名管道：从 Node 里 `spawnSync(..., {stdio: 'pipe'})` 会直接 EPERM，
 * 所以包装内部拿不到 CLI 的 stdout。用 shell 重定向也走不通（那要经过 shell 管道）。
 * 因此：**用 shell 重定向自己把 --json 接到文件**，再核对（下面的 SAFE 用法）。
 *
 * ## 用法
 *
 *   # 静态结构（退出码即判据）
 *   node hf.mjs lint --json
 *
 *   # 浏览器门禁 —— 标准自验证写法（内部用 openSync fd 接走，避免 PowerShell 重定向 bug 与沙箱管道限制）
 *   node hf.mjs check --json --out .hyperframes/check-latest.json
 *
 *   # 取快照看图（默认带 --no-end，否则会顺手把 end 帧也拍掉）
 *   node hf.mjs snapshot --at 12.5 --output .hyperframes/snaps-x --timeout 30000
 *
 * 退出码契约：
 *   0 = 门禁通过且经自验证（check 需要 --out 并核对 samples/contrast/duration 全部 > 0）
 *   1 = 门禁未通过（代码或片子有 bug）
 *   2 = 用法错误或环境边界（找不到 CLI，沙箱禁止等）
 *   3 = check 未经自验证（未提供 --out，无法程序化自证）
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const SANDBOX_PROBE = ["E_PERM", "sandbox", "命名管道", "named pipe"];

/** 线索时间常量（issues/11 Q1）。**单一来源是 scripts/motion-const.mjs**；但 hf.mjs 与它分属
 *  门禁/作者两目录（`tools/vox/` vs `tools/`），目录边界禁止跨侧 import，故此处复写同一组值。
 *  改值必须两处同改。 */
const NARRATION_LEAD = 0.3;
const DEFAULT_LEAD = 0.2;
/** 对拍默认半窗（秒）—— `cue ± window` 两张快照（issues/22 §6 规则 10）。 */
const DEFAULT_PAIR_WINDOW = 0.15;

function parse(argv) {
  const out = {
    cmd: null,
    project: process.cwd(),
    outPath: null,
    rest: [],
    pair: false,
    cue: null,
    window: DEFAULT_PAIR_WINDOW,
    frame: null,
    output: null,
  };
  let sawProject = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (out.cmd === null && !a.startsWith("-")) out.cmd = a;
    else if (a === "--project") {
      out.project = argv[++i];
      sawProject = true;
    } else if (a === "--out") {
      out.outPath = argv[++i];
    } else if (a === "--pair") out.pair = true;
    else if (a === "--cue") out.cue = argv[++i];
    else if (a === "--window") out.window = Number(argv[++i]);
    else if (a === "--frame") out.frame = argv[++i];
    else if (a === "--output" || a === "-o") out.output = argv[++i];
    else out.rest.push(a);
  }
  out.sawProject = sawProject;
  // 这四个开关只有 `snapshot --pair` 认；其它命令要**原样透传**给 CLI
  // （否则 `snapshot --at … -o <dir>` 的输出目录会被吞掉）。
  if (!out.pair) {
    if (out.frame !== null) out.rest.push("--frame", out.frame);
    if (out.output !== null) out.rest.push("--output", out.output);
    if (out.cue !== null) out.rest.push("--cue", out.cue);
    if (out.window !== DEFAULT_PAIR_WINDOW) out.rest.push("--window", String(out.window));
  }
  return out;
}

/** index.html 里每个槽位的起点（composition id → 秒），供 cue → 全局时间换算。 */
function readSlotStarts(project) {
  const p = join(project, "index.html");
  if (!existsSync(p)) return new Map();
  const html = readFileSync(p, "utf8");
  const starts = new Map();
  for (const m of html.matchAll(/<div\b[^>]*data-composition-src="[^"]*"[^>]*>/g)) {
    const cid = m[0].match(/data-composition-id="([^"]+)"/)?.[1];
    const start = m[0].match(/data-start="([\d.]+)"/)?.[1];
    if (cid && start !== undefined) starts.set(cid, Number(start));
  }
  return starts;
}

/**
 * 把线索名换成**全局秒点**。
 *   帧内秒点 = CUE[k] + NARRATION_LEAD − DEFAULT_LEAD（= 帧脚本里 `at(k)` 的公式）
 *   全局秒点 = 该帧槽位起点 + 帧内秒点
 * 线索名可跨帧重名（实测 freetoken 的 `ver-badge` 同时在 01 与 03）→ 用 `--frame NN` 消歧。
 */
function resolveCue(project, cueKey, frameArg) {
  const cuePath = join(project, "tools", "cue-times.json");
  if (!existsSync(cuePath)) {
    throw new Error(
      "找不到 tools/cue-times.json —— --pair 需要词级线索表（跑 align-cues.py 产出）",
    );
  }
  let table;
  try {
    table = JSON.parse(readFileSync(cuePath, "utf8"));
  } catch (e) {
    throw new Error(`tools/cue-times.json 不是合法 JSON：${e.message}`);
  }
  const wantNN = frameArg === null ? null : String(frameArg).padStart(2, "0");
  const hits = [];
  for (const [frameKey, fr] of Object.entries(table)) {
    const nn = String(fr?.nn ?? "");
    if (wantNN && nn !== wantNN) continue;
    for (const c of fr?.cues ?? []) {
      if (c?.id === cueKey) hits.push({ frameKey, nn, cueT: Number(c.t) });
    }
  }
  if (hits.length === 0) {
    throw new Error(
      wantNN
        ? `线索 "${cueKey}" 在帧 ${wantNN} 的 tools/cue-times.json 里找不到`
        : `线索 "${cueKey}" 在 tools/cue-times.json 里找不到`,
    );
  }
  if (hits.length > 1) {
    const names = hits.map((h) => `${h.frameKey}`).join(", ");
    throw new Error(`线索 "${cueKey}" 在多帧里重名（${names}）—— 加 --frame NN 指定`);
  }
  const hit = hits[0];
  const starts = readSlotStarts(project);
  const entry = [...starts.entries()].find(([cid]) => cid.startsWith(`frame-${hit.nn}-`));
  if (!entry) throw new Error(`index.html 里找不到 frame-${hit.nn}-* 的槽位起点`);
  return { ...hit, cid: entry[0], frameStart: entry[1] };
}

/**
 * `snapshot --pair --cue <key> [--window 0.15]` —— 线索对拍（issues/22 §6 规则 10）。
 * 在 `cue ± window` 各拍一张：**两张的在場元素集合必须不同**（不同 ⇒ 该线索确实在此刻落定）。
 * 判据与流程写在 references/verification.md §9。
 *
 * 机制上一张一张地拍会各起一次浏览器，故用**一次 CLI 调用** `--at t-w,t+w`（同一会话），
 * 再逐字节比对两张 PNG：**字节相同 ⇒ 两张像素相同 ⇒ 该变化没落在 ±window 里**（同步失败）。
 * 反过来（字节不同）只说明"有变化"，仍需人眼看元素是否"跟着词出现"——本工具不替代 §9 的眼睛。
 */
function runPairSnapshot(project, args, cli) {
  if (!args.cue) {
    console.error("usage: hf.mjs snapshot --pair --cue <线索名> [--window 0.15] [--frame NN]");
    return 2;
  }
  let hit;
  try {
    hit = resolveCue(project, args.cue, args.frame);
  } catch (e) {
    console.error(`[hf] --pair: ${e.message}`);
    return 2;
  }
  const w = Number.isFinite(args.window) && args.window > 0 ? args.window : DEFAULT_PAIR_WINDOW;
  const at = hit.frameStart + NARRATION_LEAD + hit.cueT - DEFAULT_LEAD;
  const r3 = (x) => Number(Math.max(0, x).toFixed(3));
  const lo = r3(at - w);
  const hi = r3(at + w);
  const outDir = args.output
    ? resolve(project, args.output)
    : join(project, ".hyperframes", `pair-${args.cue}`);

  console.log(
    `[hf] pair snapshot  cue=${args.cue}  frame=${hit.cid}  ` +
      `帧内 ${hit.cueT}s → 全局 ${at.toFixed(3)}s  → --at ${lo},${hi} (±${w}s)`,
  );

  const passthrough = args.rest.filter((a) => a !== "--end" && a !== "--no-end");
  const argv = [
    cli,
    "snapshot",
    project,
    "--at",
    `${lo},${hi}`,
    "--no-end",
    "--output",
    outDir,
    ...passthrough,
  ];
  const r = spawnSync(process.execPath, argv, { cwd: project, stdio: "inherit", shell: false });
  if (r.status !== 0) return r.status === null ? 2 : r.status;

  let pngs = [];
  try {
    pngs = readdirSync(outDir)
      .filter((f) => /\.png$/i.test(f) && !/^contact-sheet/i.test(f))
      .sort();
  } catch {
    /* fall through to the count check */
  }
  if (pngs.length !== 2) {
    console.error(
      `[hf] --pair: 期望 2 张快照，得到 ${pngs.length} 张（${outDir}）—— 检查 --at 是否被吞掉`,
    );
    return 2;
  }
  const [aBuf, bBuf] = pngs.map((f) => readFileSync(join(outDir, f)));
  console.log("");
  console.log("─".repeat(72));
  if (aBuf.equals(bBuf)) {
    console.error(
      `[hf] --pair 失败：${pngs[0]} 与 ${pngs[1]} 逐字节相同 —— 该线索的变化没有落在 ±${w}s 里。`,
    );
    console.error("     元素在该窗口内没有任何变化 ⇒ 要么出现得太早（线索名/锚短语写错），");
    console.error("     要么根本没出现。改完线索名必须重拍（at() 对未定义线索返回 0）。");
    console.error(`     证据：${outDir}`);
    return 1;
  }
  console.log(`[hf] --pair 通过（两张不同）：${pngs[0]} vs ${pngs[1]}`);
  console.log("     ⚠️ 字节不同只说明「有变化」—— 仍须用 read_image 亲眼看元素是否跟着词出现");
  console.log("     （verification.md §9：抽 10 条线索做同样的对拍）。");
  console.log(`     证据：${outDir}`);
  return 0;
}

/** 找 CLI：项目内 node_modules → 仓库 packages/cli/dist */
function findCli(project) {
  const candidates = [];
  let dir = resolve(project);
  for (let i = 0; i < 4; i += 1) {
    candidates.push(join(dir, "node_modules", "hyperframes", "dist", "cli.js"));
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  dir = resolve(project);
  for (let i = 0; i < 5; i += 1) {
    candidates.push(join(dir, "packages", "cli", "dist", "cli.js"));
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function main() {
  const args = parse(process.argv.slice(2));
  const cmd = args.cmd;
  if (!cmd || !["lint", "check", "snapshot"].includes(cmd)) {
    console.error(
      "usage: node hf.mjs <lint|check|snapshot> [args] [--out <file>] [--project <dir>]",
    );
    console.error(
      "       node hf.mjs snapshot --pair --cue <线索名> [--window 0.15] [--frame NN]   # 线索对拍",
    );
    return 2;
  }
  const project = resolve(args.project);
  const cli = findCli(project);
  if (!cli) {
    console.error("[env] 找不到 hyperframes CLI。预期位置之一：");
    console.error("      <project>/node_modules/hyperframes/dist/cli.js");
    console.error("      <repo>/packages/cli/dist/cli.js");
    console.error("      先跑 `bun run build`，或在项目里 `bun install`。");
    return 2;
  }

  const rest = [...args.rest];
  // 成对快照（线索对拍）走独立编排：先算全局秒点，再交给 CLI 一次拍两张。
  if (cmd === "snapshot" && args.pair) {
    return runPairSnapshot(project, args, cli);
  }
  if (
    cmd === "check" &&
    !rest.some((a) => a.startsWith("--browser-gpu") || a.startsWith("--no-browser-gpu"))
  ) {
    rest.push("--no-browser-gpu");
  }
  if (cmd === "check" && args.outPath && !rest.includes("--json")) {
    rest.push("--json");
  }
  if (cmd === "snapshot" && !rest.includes("--no-end") && !rest.includes("--end")) {
    rest.push("--no-end");
  }

  const argv = [cli, cmd];
  if (!args.sawProject) argv.push(project);
  argv.push(...rest);

  let outFd = null;
  let outAbsPath = null;
  if (cmd === "check" && args.outPath) {
    outAbsPath = isAbsolute(args.outPath) ? args.outPath : resolve(project, args.outPath);
    mkdirSync(dirname(outAbsPath), { recursive: true });
    outFd = openSync(outAbsPath, "w");
  }

  const stdio = outFd !== null ? ["inherit", outFd, "inherit"] : "inherit";
  const r = spawnSync(process.execPath, argv, {
    cwd: project,
    stdio,
    shell: false,
  });
  if (outFd !== null) {
    closeSync(outFd);
  }
  const code = r.status === null ? 2 : r.status;

  if (cmd === "check") {
    if (code !== 0) {
      console.log("");
      console.log("─".repeat(72));
      console.log(`[hf] check 退出码 ${code}。`);
      console.log("");
      console.log("    先分辨是『片子的问题』还是『环境边界』：");
      console.log(`    · 输出里若含 ${SANDBOX_PROBE.map((s) => `"${s}"`).join(" / ")} 或`);
      console.log(
        "      `check_runtime_failure: spawn EPERM` → 沙箱禁止命名管道，无头浏览器起不来。",
      );
      console.log(
        "      这是环境边界，**不是片子的 bug**；换到允许子进程管道的环境（或在 IDE/CI 里）重跑。",
      );
      console.log("      实测：`--no-browser-gpu` 绕过不了它（Chrome 仍要用管道）。");
      console.log("    · 否则就是真的 finding，按 message 修。");
      return 1;
    }

    if (outAbsPath && existsSync(outAbsPath)) {
      const rawOutput = readFileSync(outAbsPath, "utf8");
      const startIdx = rawOutput.indexOf("{");
      const endIdx = rawOutput.lastIndexOf("}");
      if (startIdx === -1 || endIdx <= startIdx) {
        console.error("");
        console.error("─".repeat(72));
        console.error(`[hf] check 错误: 输出未包含有效 JSON。文件内容位于: ${outAbsPath}`);
        return 1;
      }
      let data;
      try {
        data = JSON.parse(rawOutput.slice(startIdx, endIdx + 1));
      } catch (err) {
        console.error("");
        console.error("─".repeat(72));
        console.error(`[hf] check 错误: 解析 JSON 失败: ${err.message}`);
        return 1;
      }

      const sampleCount = data.layout?.samples?.length ?? 0;
      const contrastChecked = data.contrast?.checked ?? 0;
      const duration = data.layout?.duration ?? 0;
      const sections = [data.lint, data.runtime, data.layout, data.motion, data.contrast];
      const errors =
        sections.reduce((n, s) => n + (s?.errorCount ?? 0), 0) || (data.ok === false ? 1 : 0);
      const warnings = sections.reduce((n, s) => n + (s?.warningCount ?? 0), 0);

      const passed =
        errors === 0 && warnings === 0 && sampleCount > 0 && contrastChecked > 0 && duration > 0;
      console.log("");
      console.log("─".repeat(72));
      if (!passed) {
        console.error("[hf] check 自核对未通过：");
        console.error(`     · errors: ${errors} (预期 0)`);
        console.error(`     · warnings: ${warnings} (预期 0)`);
        console.error(`     · samples: ${sampleCount} (预期 > 0)`);
        console.error(`     · contrast.checked: ${contrastChecked} (预期 > 0)`);
        console.error(`     · duration: ${duration}s (预期 > 0)`);
        return 1;
      }

      console.log("[hf] check 自验证通过 (exit 0):");
      console.log(`     · samples: ${sampleCount}`);
      console.log(`     · contrast.checked: ${contrastChecked}`);
      console.log(`     · duration: ${duration}s`);
      console.log(`     · errors: 0`);
      console.log(`     · warnings: 0`);
      console.log(`     · 报告已写入: ${outAbsPath}`);
      return 0;
    }

    console.log("");
    console.log("─".repeat(72));
    console.log("[hf] check 退出码 0 —— 但未提供 --out <file> 进行程序化自核对。");
    console.log("     按契约返回退出码 3 (未自验证)。");
    console.log("     必须核对 --json 里的三项（防止运行时/对比度阶段静默空跑）：");
    console.log("       samples.Count    > 0     （为 0 = 运行时阶段根本没跑）");
    console.log("       contrast.checked > 0     （为 0 = 对比度审计根本没跑）");
    console.log("       duration         ≈ 成片总长（为 0 = 读到的是空页）");
    console.log("");
    console.log("     标准自验证用法 (避免 PowerShell 重定向编码问题与沙箱管道限制)：");
    console.log("       node hf.mjs check --json --out .hyperframes/check-latest.json");
    console.log("     未提供 --out 时，禁止在脚本或 CI 中判定为通过。");
    return 3;
  }

  if (cmd === "lint") {
    if (code !== 0) {
      console.error(`\n[hf] lint 退出码 ${code} —— 有 error。lint 不需要浏览器，退出码即判据。`);
      return 1;
    }
    console.log("\n[hf] lint 退出码 0。注意：ok=true 只表示没有 error，还要确认 warning 也是 0。");
    return 0;
  }

  if (cmd === "snapshot") {
    if (code !== 0) {
      console.error(`\n[hf] snapshot 退出码 ${code}。`);
      return 1;
    }
    console.log(
      "\n[hf] 快照已带 --no-end。**下一步必须用 read_image 亲眼看图**，别只看文件生成成功。",
    );
    return 0;
  }
  return code === 0 ? 0 : 1;
}

process.exit(main());
