/**
 * gen-index.mjs —— 装配主时间轴 index.html。
 *
 * 场景槽位数 = 项目帧数（12）；data-start 由 slots.mjs 累加得出；data-duration = 该帧槽位。
 * 旁白轨 track 10：data-start = 槽位起点 + 0.3，data-duration = wav 真实秒数。
 * 音效轨 track 11：稀疏标点，只在"画面发生了一件事"的位置出现，不铺床。
 *
 * ⚠️ 本文件从 `freetoken-v013-vox` 提升而来，含**上一项目的示例值**，新项目必须改两处：
 *   1. `TITLES` —— slug 表（NN -> slug），要与 `frames-data.mjs` 的 slug 一一对应；
 *   2. `SFX` —— 音效清单与入点（本项目是 7 个 ffmpeg 确定性合成的标点，见 `_contract.md` §3）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SLOTS, STARTS, TOTAL, VOICE } from "./slots.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TITLES = {
  "01": "hook", "02": "problem", "03": "what-is", "04": "mech-image-in", "05": "mech-encoder-host",
  "06": "mech-quant-path", "07": "mech-kernel-switch", "08": "toolbox", "09": "pitfall",
  "10": "demo-agent-vision", "11": "demo-repair-ftw", "12": "limits-and-start",
};

// 稀疏音效标点：(文件, 全局秒, 为什么在这里)
const SFX = [
  ["sfx_001", 0.05, "冷开场一记重击"],
  ["sfx_002", STARTS["02"] + 0.1, "问题段起手（三张卡落下）"],
  ["sfx_003", STARTS["05"] + 0.1, "机制②起手（两块权重流转）"],
  ["sfx_004", STARTS["07"] + 3.7, "机制④旋钮咔哒"],
  ["sfx_005", STARTS["09"] + 0.5, "坑段警告条滑入"],
  ["sfx_006", STARTS["10"] + 0.1, "演示①起手（命令打出）"],
  ["sfx_007", STARTS["12"] + 25.0, "收尾红勾落下"],
];

const f = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

const scenes = Object.keys(SLOTS)
  .map((nn) => {
    const slug = TITLES[nn];
    return `      <div id="f${nn}" class="clip"
           data-composition-id="frame-${nn}-${slug}"
           data-composition-src="compositions/frames/${nn}-${slug}.html"
           data-start="${f(STARTS[nn])}" data-duration="${f(SLOTS[nn])}"
           data-track-index="1" data-width="1920" data-height="1080"></div>`;
  })
  .join("\n");

let cursor = 0;
const voices = VOICE.map((l) => {
  const start = cursor + 0.3;
  cursor += SLOTS[l.frame];
  return `      <audio id="vo-${l.frame}" src="${l.wav}"
             data-start="${f(start)}" data-duration="${l.seconds}" data-track-index="10"></audio>`;
}).join("\n");

const sfx = SFX.map(
  ([name, at, why], i) =>
    `      <audio id="sfx-${String(i + 1).padStart(2, "0")}" src=".media/audio/sfx/${name}.mp3"
             data-start="${f(at)}" data-duration="${[0.7, 0.28, 0.42, 0.09, 0.5, 0.05, 0.8][i]}" data-track-index="11"></audio>`,
).join("\n");

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-resolution="landscape">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <title>FreeToken v0.1.3 拆解：一次结构重构与能力扩张</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html,
      body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #f1ede4; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #f1ede4; }
      .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <!-- 主时间轴。data-duration = 全部槽位之和（由 tools/slots.mjs 算出，不要手算）。 -->
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${f(TOTAL)}">
      <!-- ══ 场景槽位（${Object.keys(SLOTS).length} 个 = 项目帧数）══ -->
${scenes}

      <!-- ══ 旁白轨（track 10）：data-start = 槽位起点 + 0.3，data-duration = wav 真实秒数 ══ -->
${voices}

      <!-- ══ 音效轨（track 11）：稀疏标点，不是垫床 ══
           ${SFX.map(([n, a, w]) => `${n}@${f(a)}s ${w}`).join(" · ")} -->
${sfx}
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

writeFileSync(join(ROOT, "index.html"), html, "utf8");
console.log(`index.html 写好：${Object.keys(SLOTS).length} 槽位 / 旁白 ${VOICE.length} 条 / 音效 ${SFX.length} 个`);
console.log(`总长 ${TOTAL}s（旁白合计 ${VOICE.reduce((a, b) => a + b.seconds, 0).toFixed(3)}s）`);
