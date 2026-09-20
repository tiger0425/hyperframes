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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const SANDBOX_PROBE = ["E_PERM", "sandbox", "命名管道", "named pipe"];

function parse(argv) {
  const out = { cmd: null, project: process.cwd(), outPath: null, rest: [] };
  let sawProject = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (out.cmd === null && !a.startsWith("-")) out.cmd = a;
    else if (a === "--project") {
      out.project = argv[++i];
      sawProject = true;
    } else if (a === "--out") {
      out.outPath = argv[++i];
    } else out.rest.push(a);
  }
  out.sawProject = sawProject;
  return out;
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
        errors === 0 &&
        warnings === 0 &&
        sampleCount > 0 &&
        contrastChecked > 0 &&
        duration > 0;
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
