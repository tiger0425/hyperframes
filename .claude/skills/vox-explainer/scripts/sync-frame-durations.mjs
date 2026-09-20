#!/usr/bin/env node
/**
 * sync-frame-durations.mjs — 把每帧**所有** timed layer 对齐到该帧在 index.html 里的槽位。
 *
 * 为什么需要它（实测教训）：一帧不只有一个 data-duration —— 帧根 + 三条 .clip 层
 * （paper / content / grain）各带自己的时间窗。运行时会把时间窗已过期的元素隐藏。
 * 旁白重建把某槽位从 19s 拉到 24.1s，但帧内层还停在 19s，结果**内容层在第 19 秒关掉**，
 * 这一幕以近乎空屏收尾——只有内联 visibility:visible 的元素还亮着，
 * 所以症状看起来像"最后一段只显示了一小块内容"。
 *
 * 帧数由项目决定，本脚本不含任何帧数常数：判据是"已核对帧数 == 项目帧数"。
 *
 * 用法：
 *   node sync-frame-durations.mjs [--project .] [--check] [--json]
 *   --check  只报告不改（CI / 自证用）
 * 退出码：0 = 全部对齐，1 = 有 stale（--check 时）或无法解析，2 = 用法错误
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const out = { project: process.cwd(), check: false, frame: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--json") out.json = true;
    else if (a === "--frame") out.frame = argv[++i];
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) out.project = a;
    else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

/** 从 index.html 解析槽位：composition id -> 槽位时长 */
export function readSlots(project) {
  const indexPath = join(project, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const slots = new Map();
  for (const m of html.matchAll(/<div\b[^>]*>/g)) {
    const tag = m[0];
    if (!/data-composition-src="/.test(tag)) continue;
    const cid = tag.match(/data-composition-id="([^"]+)"/)?.[1];
    const dur = tag.match(/data-duration="([\d.]+)"/)?.[1];
    if (cid && dur) slots.set(cid, Number(dur));
  }
  return slots;
}

export function frameCompositionId(text) {
  return (
    text.match(/id="root"\s+data-composition-id="([^"]+)"/)?.[1] ??
    text.match(/data-composition-id="(frame-[^"]+)"/)?.[1] ??
    null
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = resolve(args.project);
  const framesDir = join(project, "compositions", "frames");
  if (!existsSync(framesDir) || !statSync(framesDir).isDirectory()) {
    console.error(`[usage] missing ${framesDir} — 传 --project <dir>`);
    return 2;
  }
  if (!existsSync(join(project, "index.html"))) {
    console.error(`[usage] missing index.html in ${project}`);
    return 2;
  }

  const slots = readSlots(project);
  let files = readdirSync(framesDir)
    .filter((f) => f.endsWith(".html"))
    .sort();
  if (args.frame) {
    const targetNN = String(args.frame).padStart(2, "0");
    const frameRe = new RegExp(`^(?:frame-)?${targetNN}-`);
    files = files.filter((f) => frameRe.test(f));
    if (files.length === 0) {
      console.error(
        `[sync-frame-durations] 错误: 未在 ${framesDir} 中找到帧号为 ${targetNN} 的帧文件`,
      );
      return 2;
    }
  }
  const report = [];
  let staleCount = 0;
  let fixedCount = 0;
  let matched = 0;

  for (const name of files) {
    const path = join(framesDir, name);
    const text = readFileSync(path, "utf8");
    const cid = frameCompositionId(text);
    if (!cid) {
      report.push({ file: name, status: "no-composition-id" });
      continue;
    }
    if (!slots.has(cid)) {
      report.push({ file: name, status: "no-slot", compositionId: cid });
      continue;
    }
    matched += 1;
    const slot = slots.get(cid);
    const found = [...text.matchAll(/data-duration="([\d.]+)"/g)].map((m) => Number(m[1]));
    const stale = [...new Set(found.filter((v) => Math.abs(v - slot) > 1e-6))];

    // 同步检测与对齐 .motion.json 侧车 duration_s
    const stem = name.replace(/\.html$/, "");
    const motionPath = join(framesDir, `${stem}.motion.json`);
    let sidecarStale = false;
    let oldSidecarDuration = null;
    if (existsSync(motionPath)) {
      try {
        const motionJson = JSON.parse(readFileSync(motionPath, "utf8"));
        if (Math.abs(Number(motionJson.duration_s) - slot) > 1e-6) {
          sidecarStale = true;
          oldSidecarDuration = motionJson.duration_s;
          if (!args.check) {
            motionJson.duration_s = slot;
            writeFileSync(motionPath, `${JSON.stringify(motionJson, null, 2)}\n`, "utf8");
          }
        }
      } catch {
        // 侧车 JSON 语法错误留给 audit-frames 报告
      }
    }

    if (stale.length === 0 && !sidecarStale) {
      report.push({ file: name, status: "ok", layers: found.length, slot });
      continue;
    }

    if (args.check) {
      staleCount += 1;
      report.push({
        file: name,
        status: "stale",
        layers: found.length,
        stale,
        sidecarStale,
        oldSidecarDuration,
        slot,
      });
      continue;
    }

    fixedCount += 1;
    const next = text.replace(/data-duration="[\d.]+"/g, `data-duration="${slot}"`);
    writeFileSync(path, next, "utf8");
    report.push({
      file: name,
      status: "fixed",
      layers: found.length,
      from: stale,
      sidecarFixed: sidecarStale,
      slot,
    });
  }

  const totalSlots = slots.size;
  const expectedMatch = args.frame ? files.length : totalSlots;
  const ok =
    (args.check ? staleCount === 0 : true) && matched === expectedMatch && expectedMatch > 0;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok,
          projectFrames: totalSlots,
          targetFrames: files.length,
          matched,
          stale: staleCount,
          fixed: fixedCount,
          report,
        },
        null,
        2,
      ),
    );
  } else {
    for (const r of report) {
      const pad = r.file.padEnd(28);
      if (r.status === "ok") {
        console.log(`${pad} ${r.layers} layer(s) ok @ ${r.slot}`);
      } else if (r.status === "fixed") {
        const sideMsg = r.sidecarFixed ? " [+sidecar motion.json]" : "";
        const fromMsg = r.from.length ? `${r.from.join(", ")} -> ` : "";
        console.log(`${pad} ${r.layers} layer(s) ${fromMsg}${r.slot}${sideMsg}  FIXED`);
      } else if (r.status === "stale") {
        const details = [];
        if (r.stale && r.stale.length) details.push(`layers: ${r.stale.join(", ")}`);
        if (r.sidecarStale) details.push(`sidecar: ${r.oldSidecarDuration}`);
        console.log(`${pad} STALE [${details.join(", ")}] (slot ${r.slot})`);
      } else if (r.status === "no-slot")
        console.log(`${pad} SKIP — index.html 里没有槽位 "${r.compositionId}"`);
      else console.log(`${pad} SKIP — 找不到 composition id`);
    }
    console.log(`\n${matched}/${expectedMatch} frames matched.`);
    if (args.check && staleCount > 0) {
      console.log(
        `\n${staleCount} frame(s) have stale layer durations — re-run without --check to fix`,
      );
    } else if (fixedCount > 0) {
      console.log(`\n${fixedCount} frame(s) fixed successfully.`);
    } else if (matched !== expectedMatch) {
      console.log(
        `\nWARNING: ${expectedMatch - matched} slot(s) in index.html have no matching frame file.`,
      );
    } else {
      console.log(`${matched}/${matched} frames ok`);
    }
  }

  // ok 的条件里 matched !== expectedMatch 也算失败：index 里有帧文件对不上的槽位
  return ok ? 0 : 1;
}

process.exit(main());
