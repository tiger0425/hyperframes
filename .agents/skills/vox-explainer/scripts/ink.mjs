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
  const body = catmull([[x1, y1], [mx, my], [x2, y2]], true);
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

