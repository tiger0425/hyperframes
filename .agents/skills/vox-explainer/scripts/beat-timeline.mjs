/**
 * beat-timeline.mjs — 从已合成的旁白 wav 里量出"句子节拍"的真实时间点。
 *
 * 为什么需要它：帧内的入场动效必须跟着**旁白说到哪**走，而不是开场 5 秒全放完。
 * 旁白是 TTS 合成的，句间停顿是真实存在的——所以用 silencedetect 量出停顿，
 * 再把 SCRIPT.md 的句子边界对到那些停顿上，就得到每个句子的真实起点。
 *
 * 用法：node tools/beat-timeline.mjs [--project .] [--json]
 * 产物：.media/beat-map.json
 *   { "01": { "wav": "...", "duration": 22.008, "beats": [ { "text": "...", "start": 0.0 }, ... ] } }
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const project = path.resolve(
  args.includes("--project") ? args[args.indexOf("--project") + 1] : process.cwd(),
);

const script = fs.readFileSync(path.join(project, "SCRIPT.md"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(project, ".media", "voice-manifest.json"), "utf8"),
);

/** 从 SCRIPT.md 抠出每行的正文（与 synthesize_voice.py 同一套语义）
 *  按 `---` 分块解析，避免依赖 `\Z` 这种 JS 不存在的锚点。 */
function parseLines(text) {
  const out = [];
  for (const chunk of text.split(/\r?\n---\r?\n/)) {
    const head = chunk.match(/## Line (\d+)\s*—/);
    const wavM = chunk.match(/`(voice_\d+\.wav)`/);
    const bodyM = chunk.match(/\*\*Delivery:\*\*[^\n]*\n\n([\s\S]+)/);
    if (!head || !wavM || !bodyM) continue;
    out.push({
      line: Number(head[1]),
      wav: wavM[1],
      body: bodyM[1].replace(/\s+/g, " ").trim(),
    });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** 按句末标点切节拍：。！？； 以及破折号段收尾 */
function splitBeats(body) {
  const parts = body
    .split(/(?<=[。！？；])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

/** 用 ffmpeg silencedetect 量停顿（返回 [{start,end}]，按时间升序）
 *  注意：不捕获子进程管道（受限沙箱会 EPERM，见技能 references/pitfalls.md §9），
 *  改为把 stderr 落到临时文件再读。 */
function silences(file, noise = "-35dB", dur = 0.16) {
  const tmp = path.join(
    project,
    ".hyperframes",
    `_silence-${path.basename(file, ".wav")}.log`,
  );
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const fd = fs.openSync(tmp, "w");
  spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noise}:d=${dur}`, "-f", "null", "-"],
    { stdio: ["ignore", "ignore", fd] },
  );
  fs.closeSync(fd);
  const raw = fs.readFileSync(tmp, "utf8");
  fs.unlinkSync(tmp);

  const gaps = [];
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) cur = { start: Number(s[1]) };
    if (e && cur) {
      cur.end = Number(e[1]);
      if (cur.start < 0) cur.start = 0;
      if (cur.end - cur.start >= dur) gaps.push(cur);
      cur = null;
    }
  }
  return gaps.sort((a, b) => a.start - b.start);
}

const lines = parseLines(script);
if (lines.length === 0) {
  console.error("SCRIPT.md 解析出 0 行，检查格式");
  process.exit(2);
}

const result = {};
for (const item of lines) {
  const wav = path.join(project, ".media", "audio", "voice", item.wav);
  const rec = manifest.find((m) => m.wav === item.wav);
  const duration = rec ? rec.duration : null;
  const beats = splitBeats(item.body);
  const gaps = fs.existsSync(wav) ? silences(wav) : [];

  // 需要 N-1 个句间停顿；停顿比句子少就退回按字数正比
  let starts;
  if (beats.length === 1) {
    starts = [0];
  } else if (gaps.length >= beats.length - 1) {
    // 取"最长的 N-1 个停顿"，保持时间顺序，作为句子边界
    const idx = gaps
      .map((g, i) => ({ i, len: g.end - g.start }))
      .sort((a, b) => b.len - a.len)
      .slice(0, beats.length - 1)
      .map((x) => x.i)
      .sort((a, b) => a - b);
    starts = [0];
    for (const i of idx) starts.push(Number(gaps[i].end.toFixed(3)));
  } else {
    // 兜底：按字符数正比
    const total = beats.reduce((n, b) => n + b.length, 0);
    let acc = 0;
    starts = beats.map((b, i) => {
      const t = (duration ?? 0) * (acc / total);
      acc += b.length;
      return Number((i === 0 ? 0 : t).toFixed(3));
    });
  }

  const lineKey = String(item.line).padStart(2, "0");
  result[lineKey] = {
    wav: item.wav,
    duration,
    gapCount: gaps.length,
    beatCount: beats.length,
    method: gaps.length >= beats.length - 1 ? "silence-anchored" : "proportional",
    beats: beats.map((b, i) => ({ text: b, start: starts[i] })),
  };
}

const outPath = path.join(project, ".media", "beat-map.json");
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");

if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const [k, v] of Object.entries(result)) {
    console.log(
      `\n── Line ${k}  ${v.wav}  dur=${v.duration}s  gaps=${v.gapCount}  beats=${v.beatCount}  (${v.method})`,
    );
    for (const b of v.beats) {
      console.log(`   ${String(b.start).padStart(7)}s  ${b.text.slice(0, 44)}`);
    }
  }
  console.log(`\n-> ${outPath}`);
}
