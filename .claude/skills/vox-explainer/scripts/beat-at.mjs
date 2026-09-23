/**
 * beat-at.mjs — 把「旁白里的某句话」换算成帧内秒数。
 *
 * 输入：.media/beat-map.json（由 beat-timeline.mjs 用真实停顿量出）
 *       + 一个 spec JSON：{ "11": ["然后我们用 TypeScript 做同样的事", "项目里装的是", ...], ... }
 * 输出：每句话在**该帧自己的时间轴**上的应到点 = 0.3（旁白入点） + 句内字符位置插值时间
 *
 * 句内插值：在 beat 区间内按字符数线性分配，beats 之间用真实停顿定界。
 * 帧内出画时刻还会再减一个 lead（默认 0.35s），让元素**在说到之前一点点**到位。
 *
 * 用法：node tools/beat-at.mjs <spec.json> [--lead 0.35] [--json]
 */
import fs from "node:fs";
import path from "node:path";
// 旁白入点的单一来源（issues/11 Q1）。本脚本的 `lead` 默认保持 0.35（jev 链自洽，Q8 不动）。
import { NARRATION_LEAD } from "./motion-const.mjs";

const args = process.argv.slice(2);
const specPath = args[0];
const project = path.resolve(
  args.includes("--project") ? args[args.indexOf("--project") + 1] : process.cwd(),
);
const lead = args.includes("--lead") ? Number(args[args.indexOf("--lead") + 1]) : 0.35;

const beatMap = JSON.parse(fs.readFileSync(path.join(project, ".media", "beat-map.json"), "utf8"));
const script = fs.readFileSync(path.join(project, "SCRIPT.md"), "utf8");

/** 从 SCRIPT.md 抠出每行正文原文（按 `---` 分块，避免 JS 里不存在的 `\Z` 锚点） */
const bodies = {};
{
  for (const chunk of script.split(/\r?\n---\r?\n/)) {
    const head = chunk.match(/## Line (\d+)\s*—/);
    const bodyM = chunk.match(/\*\*Delivery:\*\*[^\n]*\n\n([\s\S]+)/);
    if (!head || !bodyM) continue;
    bodies[String(Number(head[1])).padStart(2, "0")] = bodyM[1].replace(/\s+/g, " ").trim();
  }
}

/** 把 offset（整行字符位置）换算成秒：在 beat 区间内线性插值 */
function timeOfOffset(lineKey, offset) {
  const rec = beatMap[lineKey];
  const body = bodies[lineKey];
  const total = body.length;
  // （删掉了旧的 `pts` 映射：那段是死代码，偏移单调由下面的 `beats` 递进保证。）
  // 用「逐句 indexOf 递进」确保偏移单调
  let cursor = 0;
  const beats = rec.beats.map((b) => {
    let off = body.indexOf(b.text, Math.max(0, cursor - 8));
    if (off < 0) off = cursor;
    cursor = off + b.text.length;
    return { off, t: b.start, len: b.text.length };
  });
  for (let i = 0; i < beats.length; i += 1) {
    const cur = beats[i];
    const nxt = beats[i + 1];
    const tEnd = nxt ? nxt.t : rec.duration;
    if (offset >= cur.off && (!nxt || offset < nxt.off)) {
      const span = nxt ? nxt.off - cur.off : total - cur.off;
      const frac = span > 0 ? (offset - cur.off) / span : 0;
      return cur.t + frac * (tEnd - cur.t);
    }
  }
  return rec.duration;
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const out = {};
for (const [lineKey0, phrases] of Object.entries(spec)) {
  const lineKey = String(lineKey0).padStart(2, "0");
  const body = bodies[lineKey];
  if (!body) {
    console.error(`no body for line ${lineKey}`);
    continue;
  }
  const rows = [];
  let searchFrom = 0;
  for (const p of phrases) {
    const off = body.indexOf(p, searchFrom);
    const useOff = off >= 0 ? off : body.indexOf(p);
    if (useOff >= 0) searchFrom = useOff + p.length;
    const t = useOff >= 0 ? timeOfOffset(lineKey, useOff) : null;
    rows.push({
      phrase: p,
      offset: useOff,
      narration: t === null ? null : Number(t.toFixed(3)),
      frameAt: t === null ? null : Number(Math.max(0.2, NARRATION_LEAD + t - lead).toFixed(2)),
      spokenFor: t === null ? null : Number((NARRATION_LEAD + t).toFixed(3)),
    });
  }
  out[lineKey] = { wav: beatMap[lineKey].wav, duration: beatMap[lineKey].duration, rows };
}

if (args.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const [k, v] of Object.entries(out)) {
    console.log(`\n── Line ${k}  ${v.wav}  dur=${v.duration}s`);
    for (const r of v.rows) {
      console.log(
        `   beat@${String(r.narration).padStart(7)}s  frame@${String(r.frameAt).padStart(6)}s   ${r.phrase.slice(0, 40)}`,
      );
    }
  }
}
