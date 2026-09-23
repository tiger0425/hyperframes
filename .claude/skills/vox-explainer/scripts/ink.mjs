/** ink.mjs — 确定性手绘路径生成器（无随机源，seed 固定 → 每次生成同一条线）。 */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmull(pts, open) {
  const p = open ? pts : pts.concat([pts[0]]);
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i += 1) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** 手绘圈注：围绕 (cx,cy)、半径 (rx,ry) 的不闭合椭圆，带自然抖动。 */
export function inkCircle(cx, cy, rx, ry, seed = 7, jitter = 0.05) {
  const r = rng(seed);
  const n = 16;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2 * 1.06 - 0.25;
    const k = 1 + (r() - 0.5) * 2 * jitter;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return catmull(pts, false);
}

/** 手绘下划线：(x,y) 起、宽 w、双笔微弯。 */
export function inkUnderline(x, y, w, seed = 11, amp = 7) {
  const r = rng(seed);
  const n = 10;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push([x + w * t, y + (r() - 0.5) * 2 * amp + Math.sin(t * 4.1) * amp * 0.5]);
  }
  return catmull(pts, true);
}

/** 手绘箭头：(x1,y1) → (x2,y2) 带末端两笔。 */
export function inkArrow(x1, y1, x2, y2, seed = 3) {
  const r = rng(seed);
  const mx = (x1 + x2) / 2 + (r() - 0.5) * 26;
  const my = (y1 + y2) / 2 + (r() - 0.5) * 26;
  const body = catmull(
    [
      [x1, y1],
      [mx, my],
      [x2, y2],
    ],
    true,
  );
  const ang = Math.atan2(y2 - my, x2 - mx);
  const L = 34;
  return (
    body +
    ` M ${x2} ${y2} L ${(x2 - Math.cos(ang - 0.5) * L).toFixed(1)} ${(y2 - Math.sin(ang - 0.5) * L).toFixed(1)}` +
    ` M ${x2} ${y2} L ${(x2 - Math.cos(ang + 0.5) * L).toFixed(1)} ${(y2 - Math.sin(ang + 0.5) * L).toFixed(1)}`
  );
}

/** 手绘勾：(x,y) 起笔，尺寸 s。 */
export function inkCheck(x, y, s = 60, seed = 5) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * 6;
  return `M ${x} ${y} L ${(x + s * 0.34 + j()).toFixed(1)} ${(y + s * 0.46 + j()).toFixed(1)} L ${(x + s + j()).toFixed(1)} ${(y - s * 0.62 + j()).toFixed(1)}`;
}

/** 手绘斜杠（划掉）：(x1,y1) → (x2,y2)。 */
export function inkSlash(x1, y1, x2, y2) {
  return inkUnderline(x1, y1, x2 - x1, 23, 5) + ` M ${x1} ${y2} L ${x2} ${y1}`;
}

/** 手绘矩形框（四个角各留缺口，像手画的方框）。 */
export function inkRect(x, y, w, h, seed = 13, jitter = 6) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * 2 * jitter;
  const x2 = x + w;
  const y2 = y + h;
  const gap = 0.12;
  return [
    `M ${x + w * gap + j()} ${y + j()} L ${x2 - w * gap + j()} ${y + j()}`,
    `M ${x2 + j()} ${y + h * gap + j()} L ${x2 + j()} ${y2 - h * gap + j()}`,
    `M ${x2 - w * gap + j()} ${y2 + j()} L ${x + w * gap + j()} ${y2 + j()}`,
    `M ${x + j()} ${y2 - h * gap + j()} L ${x + j()} ${y + h * gap + j()}`,
  ].join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// 笔触物理性（issues/09）—— 两档笔法。**Node 纯函数，无 DOM**（不调 getPointAtLength）。
//
// 心法：SVG 的 `stroke-width` 是整条路径统一的，真「收锋」只能**切片**（每段独立线宽）。
// 本模块只用我们生成器自己的 `M/L/C` 子集做**弧长重采样**，故可在构建期（Node）算出全部
// `<path>`/`<circle>` 描述符，交给作者放进**同一个 `<g data-ink=…>`**（issues/09 的 ⑥ 纪律）。
//
// 两档（值取 issues/09 原文）：
//   normal    —— 多描 ×3（线宽 6.4/4.4/7.4，seeded 错位 ±1.5px / 微旋 ±0.28°）。默认笔。
//   highlight —— 多描 ×3 + 收锋 24 段（w(t)=2.2+3.4·sin(π·t^0.62)）+ 起笔顿点 + 收笔细尾
//                + 干笔（dash 3.0w/1.55w）≈ 31 元素。**只在 2–3 处高光用**（门禁 ≤3/屏）。
//
// 确定性：错位 / 微旋走 `hwHash`（同 hw-boil），零 `Math.random()`。
// 旧 6 个生成器**签名不变**（仍返回 `d` 字符串，`frames-data.mjs` 照旧用）；
// `inkStroke` 是**新增的包装**：吃一条 `d`，吐 `{ kind, layers }` 描述符。
// ─────────────────────────────────────────────────────────────────────────────

/** seeded hash（抄自 hw-boil，保证确定性；-1..1）。 */
export function hwHash(n, seed = 1) {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const MULTI_WIDTHS = Object.freeze([6.4, 4.4, 7.4]);
const TAPER_N = 24;
/** 收锋剖面：非对称（起笔快起、收笔缓收）。 */
export const taperWidth = (t) => 2.2 + 3.4 * Math.sin(Math.PI * Math.pow(t, 0.62));

const round1 = (v) => Number(v.toFixed(1));
const round2 = (v) => Number(v.toFixed(2));

function cubicAt(p0, c1, c2, p1, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

/** 解析本模块生成器会产出的 `M/L/C`（绝对坐标）子集。 */
function parsePath(d) {
  const segs = [];
  const re = /([MLC])\s*([-\d.,\s]+?)(?=[MLC]|$)/g;
  let cur = null;
  let m = re.exec(d);
  while (m) {
    const v = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (m[1] === "M") cur = [v[0], v[1]];
    else if (m[1] === "L") {
      segs.push({ type: "L", p0: cur, p1: [v[0], v[1]] });
      cur = [v[0], v[1]];
    } else {
      segs.push({ type: "C", p0: cur, c1: [v[0], v[1]], c2: [v[2], v[3]], p1: [v[4], v[5]] });
      cur = [v[4], v[5]];
    }
    m = re.exec(d);
  }
  return segs;
}

/** 按**弧长**把一条 `d` 重采样成 n+1 个点（Node 纯几何）。 */
export function samplePath(d, n = TAPER_N) {
  const segs = parsePath(d);
  if (!segs.length) return [];
  const K = 16;
  const raw = [segs[0].p0];
  for (const s of segs) {
    if (s.type === "L") raw.push(s.p1);
    else {
      for (let i = 1; i <= K; i += 1) raw.push(cubicAt(s.p0, s.c1, s.c2, s.p1, i / K));
    }
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i += 1) {
    const dx = raw[i][0] - raw[i - 1][0];
    const dy = raw[i][1] - raw[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1] || 1;
  const out = [];
  for (let j = 0; j <= n; j += 1) {
    const target = (total * j) / n;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i += 1;
    const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    out.push([
      raw[i - 1][0] + (raw[i][0] - raw[i - 1][0]) * t,
      raw[i - 1][1] + (raw[i][1] - raw[i - 1][1]) * t,
    ]);
  }
  return out;
}

/** 路径包围盒中心（多描微旋的旋转锚）。 */
function bboxCenter(d) {
  const pts = samplePath(d, 16);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** 多描 ×3：同一条 d 画 3 遍，各自微错位 + 微旋。 */
function multiLayers(d, seed) {
  const [cx, cy] = bboxCenter(d);
  const layers = [];
  for (let k = 0; k < 3; k += 1) {
    const dx = hwHash(k * 31 + 3, seed) * 1.5;
    const dy = hwHash(k * 31 + 7, seed) * 1.5;
    const rot = hwHash(k * 31 + 11, seed) * 0.28;
    layers.push({
      type: "path",
      role: "multi",
      d,
      width: MULTI_WIDTHS[k],
      opacity: k === 2 ? 0.9 : 1,
      transform: `translate(${round2(dx)},${round2(dy)}) rotate(${round2(rot)} ${round1(cx)} ${round1(cy)})`,
    });
  }
  return layers;
}

/**
 * `normal` / `highlight` 两档笔法，返回**层描述符**（无颜色；颜色留给作者的 `<g>` CSS）。
 * @returns {{kind:string, layers:Array<object>}}
 */
export function inkStroke(d, kind = "normal", opts = {}) {
  const seed = opts.seed ?? 7;
  const w = opts.width ?? 6;
  if (kind === "normal") return { kind, layers: multiLayers(d, seed) };
  if (kind !== "highlight") throw new Error(`inkStroke: unknown kind "${kind}"`);

  const layers = multiLayers(d, seed);
  // 收锋 24 段
  const pts = samplePath(d, TAPER_N);
  for (let i = 0; i < TAPER_N; i += 1) {
    const t = i / (TAPER_N - 1);
    layers.push({
      type: "path",
      role: "taper",
      d: `M${round1(pts[i][0])} ${round1(pts[i][1])} L${round1(pts[i + 1][0])} ${round1(pts[i + 1][1])}`,
      width: round2(taperWidth(t)),
      linecap: "round",
    });
  }
  // 起笔顿点（实心圆，直径略大于线宽）+ 收笔细尾（最后 18%，半宽）
  const big = samplePath(d, 60);
  layers.push({
    type: "circle",
    role: "entry-dot",
    cx: round1(big[0][0]),
    cy: round1(big[0][1]),
    r: round2(w * 0.62),
  });
  const i0 = Math.round(59 * 0.82);
  let tail = `M${round1(big[i0][0])} ${round1(big[i0][1])}`;
  for (let i = i0 + 1; i <= 60; i += 1) tail += ` L${round1(big[i][0])} ${round1(big[i][1])}`;
  layers.push({ type: "path", role: "tail", d: tail, width: round2(w * 0.45), linecap: "butt" });
  // 干笔主体（butt 端 + 微断 dash，对齐 hw-boil 的 sharp）
  layers.push({
    type: "path",
    role: "dry",
    d,
    width: w,
    linecap: "butt",
    dasharray: `${round1(3.0 * w)} ${round1(1.55 * w)}`,
  });
  return { kind, layers };
}

/**
 * 把 `inkStroke` 的层渲染成**一个 `<g>`** 标记字符串（作者直接嵌进帧 markup）。
 * 颜色走 `attrs`（默认 `currentColor`，由外层 CSS 控）；保证 issues/09 的「多段共用一个 `<g>`」。
 */
export function inkMarkup(d, kind = "normal", opts = {}) {
  const { layers } = inkStroke(d, kind, opts);
  const color = opts.color ?? "currentColor";
  const body = layers
    .map((l) => {
      const paint = l.type === "circle" ? `fill="${color}"` : `fill="none" stroke="${color}"`;
      if (l.type === "circle") {
        return `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r}" ${paint}/>`;
      }
      const parts = [
        `d="${l.d}"`,
        paint,
        `stroke-width="${l.width}"`,
        `stroke-linecap="${l.linecap ?? "round"}"`,
        'stroke-linejoin="round"',
      ];
      if (l.dasharray) parts.push(`stroke-dasharray="${l.dasharray}"`);
      if (l.opacity !== undefined && l.opacity !== 1) parts.push(`stroke-opacity="${l.opacity}"`);
      if (l.transform) parts.push(`transform="${l.transform}"`);
      return `<path ${parts.join(" ")}/>`;
    })
    .join("");
  return `<g data-ink="${kind}">${body}</g>`;
}
