#!/usr/bin/env node
/**
 * gen-vox-annotation.mjs — 自动生成 VOX 风格的手绘 SVG 标注与 GSAP 动效代码。
 *
 * 为什么需要它：过去在 3788×1960 材料图上手绘红笔圈注或箭头，需要写临时脚本
 * （如 _png_geom.mjs）手动计算像素并盲调贝塞尔曲线。本工具输入目标矩形区域，
 * 即可自动生成带有自然手绘抖动曲线、平滑贝塞尔控制点的 SVG path 及配套 GSAP 描线动效。
 *
 * 用法：
 *   node gen-vox-annotation.mjs --rect "x,y,w,h" [--shape box|circle|underline|arrow|strike]
 *   node gen-vox-annotation.mjs --from "x1,y1" --to "x2,y2" --shape arrow
 *
 * 参数：
 *   --rect "x,y,w,h"     目标像素区域（支持逗号或空格分隔）
 *   --shape              图形类型：box（默认矩形框）、circle（圈注/椭圆）、underline（下划线）、arrow（箭头）、strike（删除线）
 *   --color              笔触颜色（默认 #e23a2e，暗底建议 #f1ede4）
 *   --stroke-width       线条宽度（默认 6）
 *   --jitter             抖动强度（默认 1.0）
 *   --viewbox            SVG viewBox（默认 "0 0 3788 1960"）
 *   --fit                使用 preserveAspectRatio="xMinYMin meet" 等比缩放（默认保持 "none" 绝对贴合）
 *   --id                 动效类名后缀（默认基于几何特征生成确定性哈希）
 *   --json               以 JSON 格式输出
 *
 * 退出码：0 = 成功，2 = 参数错误
 */

function stringHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).slice(0, 6);
}

function parseArgs(argv) {
  const out = {
    rect: null,
    from: null,
    to: null,
    shape: "box",
    color: "#e23a2e",
    strokeWidth: 6,
    jitter: 1.0,
    viewBox: "0 0 3788 1960",
    fit: false,
    id: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--rect") out.rect = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--shape") out.shape = argv[++i]?.toLowerCase();
    else if (a === "--color") out.color = argv[++i];
    else if (a === "--stroke-width") out.strokeWidth = Number(argv[++i]);
    else if (a === "--jitter") out.jitter = Number(argv[++i]);
    else if (a === "--viewbox") out.viewBox = argv[++i];
    else if (a === "--fit") out.fit = true;
    else if (a === "--id") out.id = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      console.error(`[gen-vox-annotation] 未知参数: ${a}`);
      process.exit(2);
    }
  }

  if (!out.id) {
    const seedStr = `${out.shape}_${out.rect || ""}_${out.from || ""}_${out.to || ""}_${out.viewBox}`;
    out.id = `anno_${stringHash(seedStr)}`;
  }
  return out;
}

// 伪随机数生成器（带微调抗拟合）
function pseudoRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function parseCoords(str) {
  if (!str) return null;
  const parts = str
    .split(/[\s,]+/)
    .map((n) => Number.parseFloat(n.trim()))
    .filter((n) => !Number.isNaN(n));
  return parts;
}

/** 生成自然手绘矩形框路径（四段带微弯与轻微交叉的贝塞尔曲线） */
function generateHandDrawnBox(x, y, w, h, jitter) {
  const pad = 12 * jitter;
  const x0 = x - pad;
  const y0 = y - pad;
  const x1 = x + w + pad;
  const y1 = y + h + pad;

  const j = (seed) => (pseudoRandom(seed) - 0.5) * 8 * jitter;

  // 上边（左到右，轻微向下弧度）
  const top =
    `M ${round(x0 - 4 + j(1))} ${round(y0 + j(2))} ` +
    `C ${round(x0 + w * 0.3 + j(3))} ${round(y0 - 4 + j(4))}, ` +
    `${round(x0 + w * 0.7 + j(5))} ${round(y0 + 2 + j(6))}, ` +
    `${round(x1 + 6 + j(7))} ${round(y0 + j(8))}`;

  // 右边（上到下，轻微向右凸）
  const right =
    `C ${round(x1 + 4 + j(9))} ${round(y0 + h * 0.3 + j(10))}, ` +
    `${round(x1 - 2 + j(11))} ${round(y0 + h * 0.7 + j(12))}, ` +
    `${round(x1 + j(13))} ${round(y1 + 6 + j(14))}`;

  // 下边（右到左，轻微向上翘）
  const bottom =
    `C ${round(x0 + w * 0.7 + j(15))} ${round(y1 + 4 + j(16))}, ` +
    `${round(x0 + w * 0.3 + j(17))} ${round(y1 - 2 + j(18))}, ` +
    `${round(x0 - 6 + j(19))} ${round(y1 + j(20))}`;

  // 左边（下到上，回扣并轻微闭合越过起点）
  const left =
    `C ${round(x0 - 4 + j(21))} ${round(y0 + h * 0.7 + j(22))}, ` +
    `${round(x0 + 2 + j(23))} ${round(y0 + h * 0.3 + j(24))}, ` +
    `${round(x0 + 2 + j(25))} ${round(y0 - 6 + j(26))}`;

  return `${top} ${right} ${bottom} ${left}`;
}

/** 生成手绘圈注/椭圆路径（带起点闭合重叠的手绘感） */
function generateHandDrawnCircle(x, y, w, h, jitter) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2 + 16 * jitter;
  const ry = h / 2 + 14 * jitter;

  const j = (seed) => (pseudoRandom(seed) - 0.5) * 6 * jitter;

  // 4 个象限点 + 起点末尾重合越界 15% 模拟手绘笔迹收尾
  const p0 = { x: cx - rx + j(1), y: cy + j(2) };
  const p1 = { x: cx + j(3), y: cy - ry + j(4) };
  const p2 = { x: cx + rx + j(5), y: cy + j(6) };
  const p3 = { x: cx + j(7), y: cy + ry + j(8) };
  const pEnd = { x: cx - rx + 14 + j(9), y: cy - 8 + j(10) };

  const kappa = 0.5522847498;
  const ox = rx * kappa;
  const oy = ry * kappa;

  const d =
    `M ${round(p0.x)} ${round(p0.y)} ` +
    `C ${round(p0.x)} ${round(p0.y - oy)}, ${round(p1.x - ox)} ${round(p1.y)}, ${round(p1.x)} ${round(p1.y)} ` +
    `C ${round(p1.x + ox)} ${round(p1.y)}, ${round(p2.x)} ${round(p2.y - oy)}, ${round(p2.x)} ${round(p2.y)} ` +
    `C ${round(p2.x)} ${round(p2.y + oy)}, ${round(p3.x + ox)} ${round(p3.y)}, ${round(p3.x)} ${round(p3.y)} ` +
    `C ${round(p3.x - ox)} ${round(p3.y)}, ${round(p0.x - 4)} ${round(p0.y + oy)}, ${round(pEnd.x)} ${round(pEnd.y)}`;

  return d;
}

/** 生成手绘下划线 */
function generateHandDrawnUnderline(x, y, w, h, jitter) {
  const yBase = y + h + 12 * jitter;
  const x0 = x - 6;
  const x1 = x + w + 10;
  const j = (seed) => (pseudoRandom(seed) - 0.5) * 6 * jitter;

  return (
    `M ${round(x0 + j(1))} ${round(yBase + j(2))} ` +
    `C ${round(x0 + w * 0.35 + j(3))} ${round(yBase + 5 + j(4))}, ` +
    `${round(x0 + w * 0.75 + j(5))} ${round(yBase - 3 + j(6))}, ` +
    `${round(x1 + j(7))} ${round(yBase + 2 + j(8))}`
  );
}

/** 生成手绘删除线 */
function generateHandDrawnStrike(x, y, w, h, jitter) {
  const yMid = y + h / 2;
  const x0 = x - 12;
  const x1 = x + w + 14;
  const j = (seed) => (pseudoRandom(seed) - 0.5) * 4 * jitter;

  return (
    `M ${round(x0 + j(1))} ${round(yMid - 2 + j(2))} ` +
    `C ${round(x0 + w * 0.4 + j(3))} ${round(yMid + 4 + j(4))}, ` +
    `${round(x0 + w * 0.8 + j(5))} ${round(yMid - 3 + j(6))}, ` +
    `${round(x1 + j(7))} ${round(yMid + 1 + j(8))}`
  );
}

/** 生成手绘指向箭头 */
function generateHandDrawnArrow(x1, y1, x2, y2, jitter) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLen = 28 * jitter;
  const angleWing1 = angle - Math.PI / 6;
  const angleWing2 = angle + Math.PI / 6;

  // 箭身（微弧）
  const midX = (x1 + x2) / 2 + Math.cos(angle + Math.PI / 2) * 16 * jitter;
  const midY = (y1 + y2) / 2 + Math.sin(angle + Math.PI / 2) * 16 * jitter;

  const w1X = x2 - Math.cos(angleWing1) * headLen;
  const w1Y = y2 - Math.sin(angleWing1) * headLen;
  const w2X = x2 - Math.cos(angleWing2) * headLen;
  const w2Y = y2 - Math.sin(angleWing2) * headLen;

  return (
    `M ${round(x1)} ${round(y1)} ` +
    `Q ${round(midX)} ${round(midY)} ${round(x2)} ${round(y2)} ` +
    `M ${round(w1X)} ${round(w1Y)} L ${round(x2)} ${round(y2)} L ${round(w2X)} ${round(w2Y)}`
  );
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`VOX 手绘标注 SVG 生成工具:
  用法: node gen-vox-annotation.mjs --rect "x,y,w,h" [--shape box|circle|underline|arrow|strike]
  示例: node gen-vox-annotation.mjs --rect "812,640,428,120" --shape circle --color "#e23a2e"`);
    process.exit(0);
  }

  let pathD = "";
  if (args.shape === "arrow") {
    let x1 = 0;
    let y1 = 0;
    let x2 = 100;
    let y2 = 100;
    if (args.from && args.to) {
      const from = parseCoords(args.from);
      const to = parseCoords(args.to);
      if (from.length >= 2 && to.length >= 2) {
        [x1, y1] = from;
        [x2, y2] = to;
      }
    } else if (args.rect) {
      const r = parseCoords(args.rect);
      if (r.length >= 4) {
        x1 = r[0] - 60;
        y1 = r[1] - 40;
        x2 = r[0];
        y2 = r[1] + r[3] / 2;
      }
    }
    pathD = generateHandDrawnArrow(x1, y1, x2, y2, args.jitter);
  } else {
    if (!args.rect) {
      console.error('[gen-vox-annotation] 错误: 请指定 --rect "x,y,w,h"');
      process.exit(2);
    }
    const r = parseCoords(args.rect);
    if (r.length < 4) {
      console.error("[gen-vox-annotation] 错误: --rect 需要 4 个数值 (x, y, w, h)");
      process.exit(2);
    }
    const [x, y, w, h] = r;

    switch (args.shape) {
      case "circle":
      case "ellipse":
        pathD = generateHandDrawnCircle(x, y, w, h, args.jitter);
        break;
      case "underline":
        pathD = generateHandDrawnUnderline(x, y, w, h, args.jitter);
        break;
      case "strike":
        pathD = generateHandDrawnStrike(x, y, w, h, args.jitter);
        break;
      case "box":
      default:
        pathD = generateHandDrawnBox(x, y, w, h, args.jitter);
        break;
    }
  }

  const preserveAspect = args.fit ? "xMinYMin meet" : "none";
  const svgSnippet = `<svg class="mat-anno ${args.id}" viewBox="${args.viewBox}" preserveAspectRatio="${preserveAspect}">
  <path class="${args.id}-path" d="${pathD}" style="fill:none;stroke:${args.color};stroke-width:${args.strokeWidth};stroke-linecap:round;stroke-linejoin:round;"/>
</svg>`;

  const gsapSnippet = `// GSAP 手绘描线动效 (建议放置在 tl 对应入场时间点 at)
document.querySelectorAll(".${args.id}-path").forEach((p) => {
  const len = p.getTotalLength();
  gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
  tl.to(p, { strokeDashoffset: 0, duration: 0.75, ease: "power2.out" }, at);
});`;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          shape: args.shape,
          color: args.color,
          strokeWidth: args.strokeWidth,
          pathD,
          svgSnippet,
          gsapSnippet,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("\n── 1. SVG 标注片段 (粘贴到 .mat-stage 内部与 <img> 同级) ──");
    console.log(svgSnippet);
    console.log("\n── 2. GSAP 描线动效片段 (粘贴到帧脚本 tl 时间线上) ──");
    console.log(gsapSnippet);
    console.log("");
  }
}

main();
