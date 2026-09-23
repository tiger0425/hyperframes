/** torn.mjs — 低频撕边 `clip-path` 生成器（确定性；Node 纯函数，无 DOM）。
 *
 * 【为什么低频】高频锯齿（左右各 8 段 × 3%）读起来是「撕碎的纸屑」不是「手撕的纸边」。
 * 每边 **3–4 个顶点**、切幅 **1–6% 深浅不一**、含 **1–2 处长裂口** 才像纸（issues/15 二轮）。
 *
 * 【振幅随尺寸缩放】同一个 1.4% 在 880px 卡上是 12px（对），在 1730px 长条上就是 24px+（成锯齿相框）。
 * 故按元素宽度分档：`>1000px` 用浅档 `wide`（issues/15 本轮）。
 *
 * 坐标一律输出 **%**（相对元素自身盒），便于静态门禁直接量测切幅。
 * 零 `Math.random()`：全部走 seeded hash（立场 #1 确定性）。
 */

/** 每边顶点数（低频：3–4）。 */
export const TORN_FREQ = Object.freeze({ min: 3, max: 4 });
/** 切幅档（% 画幅）：垫纸最深、卡片适中、宽条最浅。 */
export const TORN_AMP = Object.freeze({ soft: 1.4, mat: 3.2, wide: 0.9 });
/** 「长裂口」阈值（%）：≥ 它的点算一处长裂口（整框 1–2 处）。 */
export const TORN_CRACK_PCT = 2.2;
/** 宽度分档阈值（px）。 */
export const TORN_WIDE_WIDTH = 1000;

/** 按元素宽度选档：>1000px → `wide`（浅），否则 `soft`。 */
export function tornTier(width) {
  return Number(width) > TORN_WIDE_WIDTH ? "wide" : "soft";
}

function hash(n, seed) {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const r1 = (v) => Number(v.toFixed(1));

/** 一条边上的顶点（t 沿边 0→1，d 垂直切幅 %）。含至多 1 处长裂口，切幅随 `ampPct` 缩放。 */
function edgePoints(edge, seed, ampPct) {
  const n = TORN_FREQ.min + (Math.abs(hash(edge * 17 + 1, seed)) > 0.5 ? 1 : 0); // 3 or 4
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i + 0.5) / n;
    const d = ampPct * (0.45 + 0.85 * Math.abs(hash(edge * 100 + i, seed))); // 0.45–1.30 × ampPct
    pts.push({ t, d });
  }
  // 1 处长裂口（seed 决定落在哪个点）
  const k = Math.min(n - 1, Math.floor(Math.abs(hash(edge * 31 + 5, seed)) * n));
  pts[k].d = Math.min(6, TORN_CRACK_PCT + ampPct * 0.4);
  return pts;
}

function toXY(edge, t, d) {
  if (edge === 0) return [t * 100, d]; // top: L→R, y=d
  if (edge === 1) return [100 - d, t * 100]; // right: T→B, x=100-d
  if (edge === 2) return [(1 - t) * 100, 100 - d]; // bottom: R→L
  return [d, (1 - t) * 100]; // left: B→T
}

/**
 * 生成一条撕边 `clip-path: polygon(...)`。
 * @param {number} width  元素宽度（px，用于选档）
 * @param {object} [opts] { seed, tier, ampPct }
 * @returns {{tier:string, ampPct:number, freq:number[], points:number[][], clipPath:string}}
 */
export function torn(width = 880, opts = {}) {
  const seed = opts.seed ?? 7;
  const tier = opts.tier ?? tornTier(width);
  const ampPct = opts.ampPct ?? TORN_AMP[tier] ?? TORN_AMP.soft;
  const points = [];
  const freq = [];
  for (let e = 0; e < 4; e += 1) {
    const pts = edgePoints(e, seed, ampPct);
    freq.push(pts.length);
    for (const { t, d } of pts) {
      const [x, y] = toXY(e, t, d);
      points.push([r1(x), r1(y)]);
    }
  }
  const clipPath = `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;
  return { tier, ampPct, freq, points, clipPath };
}

/** 便于作者直接嵌进 `style`：`style="clip-path:${tornClip(w,{seed})}"`。 */
export function tornClip(width, opts = {}) {
  return torn(width, opts).clipPath;
}
