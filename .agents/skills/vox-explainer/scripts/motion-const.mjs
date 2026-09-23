/**
 * motion-const.mjs — 动效契约常量的**单一来源**（issues/10 · 11 · 22）。
 *
 * 作者**不 import** 本文件：`gen-frames.mjs` 把 11 个常量注入每帧为 `MC`，把
 * `NARRATION_LEAD` / `DEFAULT_LEAD` 注入为同名常量，`at()` 由注入的函数使用。
 *
 * 需要**同一值**的生成器（`slots.mjs` / `gen-index.mjs` / `beat-at.mjs`）import 本文件 ——
 * 这样 `0.3` 只有一处定义，不会再漂（issues/11 Q1）。
 */

/** 旁白在槽位内的入点（秒）。**必须与 `gen-index.mjs` 的 `cursor + NARRATION_LEAD` 同源。** */
export const NARRATION_LEAD = 0.3;

/** 出画默认提前量；净效果 = 画面早于旁白 `NARRATION_LEAD - DEFAULT_LEAD` 秒。 */
export const DEFAULT_LEAD = 0.2;

/** 成片渲染帧率（装配表里 `fps` 字段）。与停格的 `FPS_QUANT` 不是一回事。 */
export const RENDER_FPS = 30;

/** 槽位公式的帧内呼吸与末帧定格（`slots.mjs` 消费）。 */
export const FRAME_BREATH = 2.4;
export const LAST_FRAME_HOLD = 1.6;

/** 11 个动效契约常量（issues/22 §2）。 */
export const MOTION_CONST = Object.freeze({
  FPS_QUANT: 12, // 停格频率（cutting on twos）
  SETTLE_FRAMES: 2, // 落定后保持帧数
  BOUNCE_PEAK: 1.06, // 落定后小回弹峰值
  LAYERS: Object.freeze({
    ground: Object.freeze({ from: Object.freeze({}), dur: 0.4 }),
    fact: Object.freeze({ from: Object.freeze({ x: -42, y: -18 }), dur: 0.5 }),
    trim: Object.freeze({ from: Object.freeze({ y: -26, rotation: -3 }), dur: 0.4 }),
  }),
  QUANTIZE_PROPS: Object.freeze(["x", "y", "rotation", "scale"]), // 不含 opacity
  HOLD_MAX_PX: 2, // 驻留材质动效的位移上限
  HALFTONE_SWING: 0.03, // 半调微闪幅度
  FOCUS_TRIGGER: Object.freeze({ fontSizePxLt: 24, cueMentionsGte: 2, onScreenSecGte: 3.0 }),
  FOCUS_MODE: Object.freeze(["push", "window"]),
  FOCUS_TIMING: Object.freeze({ in: 0.8, hold: 2.0, out: 0.6 }),
  CLOSER: Object.freeze(["stamp", "taut-string", "pull-mat"]),
});

/** `at(k)` 的纯计算（Node 侧复用；浏览器侧由 gen-frames 注入同式）。 */
export function cueFrameTime(cueSeconds, lead = DEFAULT_LEAD) {
  return Math.max(0, (cueSeconds ?? 0) + NARRATION_LEAD - lead);
}
