#!/usr/bin/env node
/**
 * verify-timeline.mjs — 用**真实**旁白时长核对槽位表，并产出全局起点表。
 *
 * 为什么需要它：这是"时间闭环"（_contract.md §2）的唯一自动门禁。
 * 槽位必须 = 0.3 + 旁白真实时长 + 呼吸；任何一环用估计值都会让画面与旁白错位，
 * 或者让内容层在旁白还没念完时就关掉（那正是 sync-frame-durations 要修的症状的成因）。
 *
 * 它检查：
 *   1. 每条 voice_0NN.wav 的**真实**秒数（读 wav 头，不信记录/不信 index 里的值）
 *   2. index.html 的 data-duration 与真实秒数是否一致（不一致 → 报 drift）
 *   3. 每条旁白是否放得进它的槽位（0.3 + 旁白 ≤ 槽位）
 *   4. 接缝 pad：wrapper data-duration 是否 == 槽位 + 出幕 pad（有 ledger 的 v2 项目；旧式项目退化为 == 槽位）
 *   5. 总长是否等于**槽位**之和
 *   6. 产出**全局起点表**（取快照用）
 *
 * 用法：
 *   node verify-timeline.mjs [--project .] [--json] [--min-breath 1.0]
 * 退出码：0 = 通过，1 = 有 finding，2 = 用法/环境错误
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

function parseArgs(argv) {
  const out = { project: process.cwd(), json: false, minBreath: 1.0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--min-breath") out.minBreath = Number(argv[++i]);
    else if (!a.startsWith("-")) out.project = a;
    else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

/** 读 PCM wav 头：返回秒数。支持 fmt/data chunk 顺序变化与 odd-sized chunk padding。 */
export function wavDuration(path) {
  const b = readFileSync(path);
  if (
    b.length < 44 ||
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let rate = null;
  let channels = null;
  let bits = null;
  let dataLen = null;
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(i + 8 + 2);
      rate = b.readUInt32LE(i + 8 + 4);
      bits = b.readUInt16LE(i + 8 + 14);
    } else if (id === "data") {
      dataLen = size;
      break;
    }
    i += 8 + size + (size % 2);
  }
  if (!rate || !channels || !bits || dataLen === null) return null;
  return dataLen / (rate * channels * (bits / 8));
}

/** 从 index.html 抓所有 audio 元素的属性 */
function readAudios(html) {
  const out = [];
  for (const m of html.matchAll(/<audio\b[^>]*>/g)) {
    const tag = m[0];
    const src = tag.match(/src="([^"]+)"/)?.[1];
    if (!src) continue;
    out.push({
      tag,
      src,
      id: tag.match(/(?:^|\s)id="([^"]+)"/)?.[1] ?? null,
      start: Number(tag.match(/data-start="([\d.]+)"/)?.[1] ?? NaN),
      duration: Number(tag.match(/data-duration="([\d.]+)"/)?.[1] ?? NaN),
      track: tag.match(/data-track-index="([\d.]+)"/)?.[1] ?? null,
    });
  }
  return out;
}

function readSlots(html) {
  const out = [];
  for (const m of html.matchAll(/<div\b[^>]*>/g)) {
    const tag = m[0];
    if (!/data-composition-src="/.test(tag)) continue;
    const cid = tag.match(/data-composition-id="([^"]+)"/)?.[1];
    const src = tag.match(/data-composition-src="([^"]+)"/)?.[1];
    // 属性名要带词界：Studio 回写的 `data-hf-id="…"` 会让裸 /id="/ 抢到错的值（issues/14）。
    const id = tag.match(/(?:^|\s)id="([^"]+)"/)?.[1] ?? null;
    const start = Number(tag.match(/data-start="([\d.]+)"/)?.[1] ?? NaN);
    const duration = Number(tag.match(/data-duration="([\d.]+)"/)?.[1] ?? NaN);
    // 是否落在 HTML 注释里：检查该位置之前最后一个 <!-- 与 --> 谁更近
    const before = html.slice(0, m.index);
    const lastOpen = before.lastIndexOf("<!--");
    const lastClose = before.lastIndexOf("-->");
    const commented = lastOpen !== -1 && lastOpen > lastClose;
    if (cid) out.push({ cid, src, id, start, duration, commented });
  }
  return out.sort((a, b) => a.start - b.start);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = resolve(args.project);
  const indexPath = join(project, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`[usage] missing index.html in ${project}`);
    return 2;
  }
  const html = readFileSync(indexPath, "utf8");
  const slots = readSlots(html);
  // 接缝账本（issues/20 §5.1 / issues/14）：wrapper 的 data-duration = **槽位 + 出幕 pad**。
  // 无 ledger.json → exitDur 一律 0，退化回「wrapper 时长 == 槽位」的旧式项目。
  const ledgerPath = join(project, "ledger.json");
  let seams = [];
  if (existsSync(ledgerPath)) {
    try {
      seams = JSON.parse(readFileSync(ledgerPath, "utf8"))?.seams ?? [];
    } catch {
      /* JSON 语法错由 audit-frames 报告 */
    }
  }
  const exitDurOf = (id) => {
    if (!id) return 0;
    const s = seams.find((x) => x.exit && x.exit.selector === `#${id}`);
    return s ? Number(s.exit.dur) || 0 : 0;
  };
  const audios = readAudios(html);
  const voices = audios
    .filter((a) => /audio\/voice\//.test(a.src))
    .filter((a) => Number.isFinite(a.start))
    .sort((a, b) => a.start - b.start);

  if (slots.length === 0) {
    // 刚 `init` 出来的空项目：0 帧 / 0 槽位是"尚未开工"，不是错误
    // （终点验收 #3「init 开箱即过静态门禁」）。有帧却一个槽位都没有才是真错。
    const framesDirProbe = join(project, "compositions", "frames");
    const frameCount = existsSync(framesDirProbe)
      ? readdirSync(framesDirProbe).filter((f) => f.endsWith(".html")).length
      : 0;
    if (frameCount === 0) {
      console.log(`[usage] 项目尚未开工（0 帧 / 0 槽位）—— 无事可验，跳过`);
      return 0;
    }
    console.error(`[usage] index.html 里找不到槽位（需要 data-composition-src 的 div）`);
    return 2;
  }
  if (voices.length === 0) {
    console.error(`[usage] index.html 里找不到旁白轨（src 含 audio/voice/ 的 <audio>）`);
    return 2;
  }

  const findings = [];
  const add = (level, rule, message, hint) => findings.push({ level, rule, message, hint });

  // ── 0 注释里的槽位：模板留下的坑。它会被当成真槽位，产生一个 start=0 的幽灵，
  //      报出一串莫名其妙的下游错误。这里直接点破。
  const commented = slots.filter((s) => s.commented);
  if (commented.length > 0) {
    add(
      "error",
      "slot_is_commented_out",
      `index.html 里有 ${commented.length} 个槽位写在 HTML 注释里（例：${commented[0].cid}）`,
      "把槽位从 <!-- … --> 里拿出来、填上真实 data-start/data-duration；否则它不生效且会污染本检查",
    );
  }
  const liveSlots = slots
    .filter((s) => !s.commented)
    .map((s, i, arr) => {
      const next = arr[i + 1];
      const exitDur = exitDurOf(s.id);
      const slot =
        next && Number.isFinite(next.start)
          ? Number((next.start - s.start).toFixed(3))
          : Number((s.duration - exitDur).toFixed(3));
      return { ...s, slot, exitDur, wrapperWant: Number((slot + exitDur).toFixed(3)) };
    });

  // ── 0b 未替换的占位符：模板残留在 index.html 里的话，一切数字都是假的
  const leftover = [...new Set([...html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]))];
  if (leftover.length > 0) {
    add(
      "error",
      "unsubstituted_placeholder",
      `index.html 里还有未替换的占位符: ${leftover.join(", ")}`,
      "作者必须把槽位/旁白/音效写成真实元素与真实数字；占位符留着会让时长与旁白全都对不上",
    );
  }

  // ── 1/2/3 逐条旁白
  const voiceRows = [];
  for (const v of voices) {
    const abs = join(project, v.src.replace(/\//g, "\\"));
    const rel = v.src.replace(/\\/g, "/");
    const file = existsSync(abs) ? abs : join(project, v.src);
    let real = null;
    if (existsSync(file)) real = wavDuration(file);
    else
      add(
        "error",
        "voice_file_missing",
        `旁白文件不存在: ${v.src}`,
        "确认 .media/audio/voice/ 下的文件与 index.html 的 src 一致",
      );

    // 找所属槽位：槽位起点 + 0.3 ≈ 旁白 data-start
    const owner =
      liveSlots.find((s) => Math.abs(v.start - (s.start + 0.3)) < 0.35) ??
      [...liveSlots].reverse().find((s) => v.start >= s.start && v.start < s.start + s.slot) ??
      null;

    const row = {
      file: rel,
      id: v.id,
      declaredDuration: Number.isFinite(v.duration) ? v.duration : null,
      realDuration: real === null ? null : Number(real.toFixed(3)),
      start: v.start,
      slot: owner ? owner.cid : null,
      slotDuration: owner ? owner.slot : null,
    };

    if (!owner) {
      add(
        "error",
        "voice_without_slot",
        `${rel}（start=${v.start}）找不到所属槽位`,
        "旁白 data-start 应等于槽位起点 + 0.3",
      );
    }

    if (real !== null && Number.isFinite(v.duration) && Math.abs(real - v.duration) > 0.02) {
      add(
        "error",
        "voice_declared_duration_drift",
        `${rel}：index.html 声明 ${v.duration}s，wav 实测 ${real.toFixed(3)}s`,
        "data-duration 必须写真实秒数；改完重跑 sync-frame-durations",
      );
    }

    if (owner && real !== null) {
      const need = 0.3 + real;
      const breath = owner.slot - need;
      row.breath = Number(breath.toFixed(3));
      if (breath < 0) {
        add(
          "error",
          "voice_overflows_slot",
          `${owner.cid}：旁白需 ${need.toFixed(3)}s（0.3+${real.toFixed(3)}），槽位只有 ${owner.slot}s`,
          `把该槽位改成至少 ${(need + args.minBreath).toFixed(1)}s（含 ${args.minBreath}s 呼吸），并同步帧内四处时长与后续 data-start`,
        );
      } else if (breath < args.minBreath - 1e-9) {
        add(
          "warning",
          "voice_breath_tight",
          `${owner.cid}：呼吸只有 ${breath.toFixed(3)}s（< ${args.minBreath}s）`,
          `实测健康值 2.4s（+0.3 入点 = 2.7s 总余量）。建议把槽位加到 ${(need + 2.4).toFixed(1)}s`,
        );
      }
    }
    voiceRows.push(row);
  }

  // ── 4 接缝 pad：wrapper data-duration == 槽位 + 出幕 pad（issues/20 §5.1 / issues/14）
  //      v2 的相邻 wrapper 时间上重叠是**故意的**（出幕纸要在 cut 之后继续动）；旧式项目 exitDur=0，
  //      此判据退化成「wrapper 时长 == 槽位」。
  if (liveSlots.length && Math.abs(liveSlots[0].start) > 1e-6) {
    add(
      "error",
      "slot_start_not_zero",
      `首槽位起点 ${liveSlots[0].start}s ≠ 0`,
      "data-start 必须从 0 起算",
    );
  }
  for (const s of liveSlots) {
    if (Math.abs(s.duration - s.wrapperWant) > 0.001) {
      add(
        "error",
        "wrapper_pad_mismatch",
        `${s.cid}（#${s.id}）wrapper 声明 ${s.duration}s，应为 槽位 ${s.slot} + 出幕 ${s.exitDur} = ${s.wrapperWant}s`,
        "重跑 gen-index.mjs → seam-stamp.mjs --write index.html",
      );
    }
  }

  // ── 5 总长
  const sum = Number(liveSlots.reduce((acc, s) => acc + s.slot, 0).toFixed(3));
  const declaredTotal = Number(html.match(/id="root"[^>]*data-duration="([\d.]+)"/)?.[1] ?? NaN);
  if (Number.isFinite(declaredTotal) && Math.abs(declaredTotal - sum) > 0.05) {
    add(
      "error",
      "total_duration_mismatch",
      `根 data-duration=${declaredTotal}s，槽位之和=${sum}s`,
      "根时长必须等于槽位之和",
    );
  }

  // ── 旁白总数 vs 槽位数
  if (voices.length !== liveSlots.length) {
    add(
      "warning",
      "voice_count_mismatch",
      `旁白 ${voices.length} 条，槽位 ${liveSlots.length} 个`,
      "通常一帧一条旁白；确认是有意为之（例如某帧无旁白）",
    );
  }

  // ── 帧文件与槽位是否配对（顺带，比 audit-frames 更早发现）
  const framesDir = join(project, "compositions", "frames");
  if (existsSync(framesDir)) {
    const ids = new Set(
      readdirSync(framesDir)
        .filter((f) => f.endsWith(".html"))
        .map((f) => {
          const t = readFileSync(join(framesDir, f), "utf8");
          return t.match(/data-composition-id="(frame-[^"]+)"/)?.[1] ?? null;
        })
        .filter(Boolean),
    );
    for (const s of liveSlots) {
      if (!ids.has(s.cid))
        add(
          "error",
          "slot_without_frame",
          `槽位 ${s.cid} 没有对应的帧文件`,
          "帧的 composition id 应等于该槽位的 data-composition-id",
        );
    }
  }

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const voiceTotal = Number(voiceRows.reduce((a, r) => a + (r.realDuration ?? 0), 0).toFixed(2));

  const out = {
    ok: errors.length === 0,
    frames: liveSlots.length,
    voices: voices.length,
    voiceTotalReal: voiceTotal,
    slotTotal: sum,
    declaredTotal: Number.isFinite(declaredTotal) ? declaredTotal : null,
    errors: errors.length,
    warnings: warnings.length,
    startTable: liveSlots.map((s, i) => ({
      frame: String(i + 1).padStart(2, "0"),
      cid: s.cid,
      start: s.start,
      duration: s.slot,
    })),
    voicesDetail: voiceRows,
    findings,
  };

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log("旁白实长：");
    for (const r of voiceRows) {
      console.log(
        `  ${(r.id ?? basename(r.file)).padEnd(10)} ${String(r.realDuration).padStart(7)}s  start=${String(r.start).padStart(6)}  ${r.slot ?? "(no slot)"}  breath=${r.breath ?? "?"}`,
      );
    }
    console.log(`\n旁白合计 ${voiceTotal}s · 槽位合计 ${sum}s · 根声明 ${out.declaredTotal}s`);
    console.log("\n全局起点表（取快照用）：");
    console.log("  " + out.startTable.map((r) => `${r.frame}=${r.start}`).join(" · "));
    // 装配表的 owner 是 gen-frames.mjs —— 这里只**指向**它，不合并它的数据
    // （混进时间轴校验会让两边互相污染，issues/22 §6 规则 11）。
    console.log(
      `  （逐帧装配/线索时刻见 tools/assemble-table.json${
        existsSync(join(project, "tools", "assemble-table.json")) ? "" : "（v2 项目才有）"
      } —— owner 是 gen-frames.mjs）`,
    );
    if (findings.length) console.log("");
    for (const f of findings) {
      const tag = f.level === "error" ? "ERROR" : "WARN ";
      console.log(`${tag} [${f.rule}] ${f.message}\n      → ${f.hint}`);
    }
    console.log(
      `\n${errors.length} error · ${warnings.length} warning — ${out.ok ? "verify-timeline: OK" : "verify-timeline: FAILED"}`,
    );
  }
  return out.ok ? 0 : 1;
}

process.exit(main());
