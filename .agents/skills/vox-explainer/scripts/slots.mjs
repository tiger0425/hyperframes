/**
 * slots.mjs —— 槽位表的唯一计算处（时间闭环的落地）。
 *
 * 契约（references/_contract.md §2）：槽位 = 0.3（帧首入点） + 旁白真实秒数 + 2.4（帧内呼吸）；
 * 末帧额外 +1.6s 定格。真实秒数一律读 .media/voice-manifest.json（它由 synthesize_voice.py 读 wav 头产出）。
 * 用"十分之一秒整数"累加，避免浮点误差把 data-start 写成 61.400000000000006。
 */
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../.media/voice-manifest.json", import.meta.url), "utf8"),
);

export const VOICE = manifest.lines;
export const NARRATION_TOTAL = manifest.total_seconds;

export const SLOTS = {};
export const STARTS = {};
let tenths = 0;
for (const line of VOICE) {
  const extra = line.frame === "12" ? 1.6 : 0;
  const slot = Math.round((0.3 + line.seconds + 2.4 + extra) * 10) / 10;
  STARTS[line.frame] = tenths / 10;
  SLOTS[line.frame] = slot;
  tenths += Math.round(slot * 10);
}
export const TOTAL = tenths / 10;
