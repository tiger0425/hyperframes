/**
 * slots.mjs —— 槽位表的唯一计算处（时间闭环的落地）。
 *
 * 契约（references/_contract.md §2）：槽位 = 旁白入点 + 旁白真实秒数 + 帧内呼吸；末帧额外定格。
 * 三个常量与 `gen-index.mjs` / `gen-frames.mjs` **同源**（`motion-const.mjs`，issues/11 Q1）——
 * `NARRATION_LEAD` 曾经在两处裸写成 `0.3`，是"线索全早 0.3s"那个 bug 的根。
 * 真实秒数一律读 .media/voice-manifest.json（它由 synthesize_voice.py 读 wav 头产出）。
 * 用"十分之一秒整数"累加，避免浮点误差把 data-start 写成 61.400000000000006。
 */
import { readFileSync } from "node:fs";
import { FRAME_BREATH, LAST_FRAME_HOLD, NARRATION_LEAD } from "./motion-const.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("../.media/voice-manifest.json", import.meta.url), "utf8"),
);

export const VOICE = manifest.lines;
export const NARRATION_TOTAL = manifest.total_seconds;

// 末帧是**由清单决定的**，不是写死的 "12"（帧数是参数 —— issues/22 rule 26 同族）。
const LAST_FRAME = VOICE.length ? VOICE[VOICE.length - 1].frame : null;

export const SLOTS = {};
export const STARTS = {};
let tenths = 0;
for (const line of VOICE) {
  const extra = line.frame === LAST_FRAME ? LAST_FRAME_HOLD : 0;
  const slot = Math.round((NARRATION_LEAD + line.seconds + FRAME_BREATH + extra) * 10) / 10;
  STARTS[line.frame] = tenths / 10;
  SLOTS[line.frame] = slot;
  tenths += Math.round(slot * 10);
}
export const TOTAL = tenths / 10;
