#!/usr/bin/env node
/**
 * draft-voice-timeline.mjs — 前置文案时序估算与节奏打样工具。
 *
 * 为什么需要它：过去必须等到阶段④（真实 TTS 合成 wav）才能计算槽位，如果在故事板阶段
 * 文案过长或过短，只有到后期才能发现，导致返工成本极高。
 * 本工具通过“智能音节规约 + 语速基准调节 + 可选极速草稿 TTS 打样”，在阶段②/③
 * 即可前置推导各帧槽位，输出节奏预警，并支持一键更新 STORYBOARD.md 的 duration 意图值。
 *
 * 用法：
 *   node draft-voice-timeline.mjs [--project .] [--speed normal|slow|fast] [--rate 4.6]
 *   node draft-voice-timeline.mjs [--project .] [--draft-tts] [--voice zh-CN-XiaoxiaoNeural]
 *   node draft-voice-timeline.mjs [--project .] [--update-storyboard]
 *
 * 参数：
 *   --project <dir>        项目根目录（默认当前目录）
 *   --file <path>          指定 SCRIPT.md 或 STORYBOARD.md 路径
 *   --speed                语速基准：slow (3.8字/s), normal (4.6字/s, 默认), fast (5.4字/s)
 *   --rate <num>           自定义发音音节/秒速率（覆盖 --speed）
 *   --draft-tts            启用极速 TTS 真实音频打样（若本地安装了 edge-tts，直接生成草稿 wav/mp3 并测量物理真实时长）
 *   --voice <name>         draft-tts 使用的声音（默认 zh-CN-XiaoxiaoNeural）
 *   --update-storyboard    自动将计算出的槽位回写至 STORYBOARD.md 中的 duration 意图值
 *   --json                 输出 JSON 格式
 *
 * 退出码：0 = 正常，1 = 存在严重节奏警告，2 = 参数或文件错误
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const SPEED_PROFILES = {
  slow: 4.2,
  normal: 5.0,
  fast: 5.8,
};

function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    file: null,
    speed: "normal",
    rate: null,
    draftTts: false,
    voice: "zh-CN-XiaoxiaoNeural",
    updateStoryboard: false,
    force: false,
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project") out.project = argv[++i];
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--speed") out.speed = argv[++i]?.toLowerCase();
    else if (a === "--rate") out.rate = Number(argv[++i]);
    else if (a === "--draft-tts") out.draftTts = true;
    else if (a === "--voice") out.voice = argv[++i];
    else if (a === "--update-storyboard") out.updateStoryboard = true;
    else if (a === "--force") out.force = true;
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) out.project = a;
    else {
      console.error(`[draft-voice-timeline] 未知参数: ${a}`);
      process.exit(2);
    }
  }

  if (!out.rate) {
    out.rate = SPEED_PROFILES[out.speed] || SPEED_PROFILES.normal;
  }
  return out;
}

/** 智能文本音节与停顿权重测算 (Text Normalization & Syllable Estimation) */
function analyzeSpeechPacing(rawText) {
  if (!rawText) return { syllables: 0, majorPunc: 0, minorPunc: 0, cleanText: "" };

  // 1. 去除 Markdown 格式标记
  let text = rawText
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*>\s*/gm, "")
    .trim();

  // 2. 统计停顿符号
  const majorPuncMatches = text.match(/[。！？!?…\n]/g);
  const minorPuncMatches = text.match(/[，、；;:—]/g);
  const majorPunc = majorPuncMatches ? majorPuncMatches.length : 0;
  const minorPunc = minorPuncMatches ? minorPuncMatches.length : 0;

  // 3. 数字规约：将连续数字估算为音节（例如 2026 -> 4音节，244.1 -> 7音节）
  let syllableCount = 0;
  const numMatches = text.match(/\d+(?:\.\d+)?/g) || [];
  for (const num of numMatches) {
    // 粗略折算：纯数字每个字符1音节，小数点+2音节（“点”）
    syllableCount += num.replace(".", "点").length;
  }

  // 移除已统计的数字
  const noNumText = text.replace(/\d+(?:\.\d+)?/g, "");

  // 4. 统计中文字符
  const chineseChars = noNumText.match(/[\u4e00-\u9fa5]/g) || [];
  syllableCount += chineseChars.length;

  // 5. 英文单词/缩写音节规约
  const englishWords = noNumText.match(/[a-zA-Z]+/g) || [];
  for (const word of englishWords) {
    if (word === word.toUpperCase() && word.length <= 5) {
      // 大写缩写（如 DSH, API, UI, CLI）逐字朗读
      syllableCount += word.length;
    } else {
      // 常见英文单词：按元音群或词长估算音节
      const vowels = word.match(/[aeiouy]{1,2}/gi) || [];
      syllableCount += Math.max(1, vowels.length);
    }
  }

  return {
    syllables: syllableCount,
    majorPunc,
    minorPunc,
    cleanText: text.replace(/\s+/g, " "),
  };
}

/** 从 SCRIPT.md 解析各行 */
function parseScriptMd(content) {
  const lines = [];
  const sections = content.split(/^##\s+Line\s+(\d+)/m);
  if (sections.length > 1) {
    for (let i = 1; i < sections.length; i += 2) {
      const lineNum = Number.parseInt(sections[i], 10);
      const body = sections[i + 1] || "";
      const textMatch =
        body.match(/(?:^|\n)(?: {4}|\t|> )([^\n]+(?:\n(?: {4}|\t|> )[^\n]+)*)/) ||
        body.match(/(?:\*\*正文\*\*|\*\*逐字正文\*\*|文案)[：:]\s*([^\n]+)/);

      let text = "";
      if (textMatch) {
        text = textMatch[1].replace(/^(?: {4}|\t|> )/gm, "").trim();
      } else {
        // 兜底：提取非 **Time** / **Delivery** 开头的正文段落
        const paras = body
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(
            (p) =>
              p && !p.startsWith("**Time") && !p.startsWith("**Delivery") && !p.startsWith("---"),
          );
        text = paras[0] || "";
      }

      lines.push({
        frameNumber: lineNum,
        title: `Frame ${lineNum}`,
        text,
      });
    }
  }
  return lines;
}

/** 从 STORYBOARD.md 解析各帧 */
function parseStoryboardMd(content) {
  const frames = [];
  const frameBlocks = content.split(/^##\s+Frame\s+(\d+)/m);
  if (frameBlocks.length > 1) {
    for (let i = 1; i < frameBlocks.length; i += 2) {
      const frameNum = Number.parseInt(frameBlocks[i], 10);
      const body = frameBlocks[i + 1] || "";
      const roleMatch = body.match(/^[^\n—]*—\s*([^\n]+)/);
      const role = roleMatch ? roleMatch[1].trim() : `Frame ${frameNum}`;
      const voMatch = body.match(/-\s*voiceover\s*:\s*([^\n]+)/);
      const text = voMatch ? voMatch[1].trim() : "";
      frames.push({
        frameNumber: frameNum,
        title: `Frame ${frameNum} — ${role}`,
        text,
      });
    }
  }
  return frames;
}

/** 尝试使用 edge-tts 进行物理音频打样并测量时长 */
function runDraftTts(textList, voice, projectDir) {
  const draftDir = join(projectDir, ".media", "_draft_tts");
  if (!existsSync(draftDir)) mkdirSync(draftDir, { recursive: true });

  const durations = [];
  console.log(`[draft-tts] 正在使用 edge-tts (音色: ${voice}) 进行真实音频试跑测距...`);

  for (let idx = 0; idx < textList.length; idx += 1) {
    const text = textList[idx];
    const outAudio = join(draftDir, `draft_${String(idx + 1).padStart(3, "0")}.mp3`);
    try {
      execFileSync("edge-tts", ["--voice", voice, "--text", text, "--write-media", outAudio], {
        stdio: "ignore",
        windowsHide: true,
      });

      // 快速利用 ffprobe 或 powershell 提取实际时长
      let durSec = 0;
      const psRes = spawnSync(
        "powershell",
        [
          "-Command",
          `$shell = New-Object -COMObject Shell.Application;
         $folder = $shell.Namespace('${dirname(outAudio)}');
         $file = $folder.ParseName('${basename(outAudio)}');
         $lenStr = $folder.GetDetailsOf($file, 27);
         if (-not $lenStr) { $lenStr = $folder.GetDetailsOf($file, 28); }
         $lenStr`,
        ],
        { encoding: "utf8" },
      );

      const timeStr = psRes.stdout?.trim();
      if (timeStr && timeStr.includes(":")) {
        const parts = timeStr.split(":").map(Number.parseFloat);
        if (parts.length === 3) durSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) durSec = parts[0] * 60 + parts[1];
      }

      if (!durSec || durSec === 0) {
        // 兜底：按文件大小粗略比对 (MP3 ~128kbps = 16KB/s)
        const stat = readFileSync(outAudio);
        durSec = Math.max(1, Math.round((stat.length / 16000) * 10) / 10);
      }

      durations.push(Math.round(durSec * 10) / 10);
    } catch (err) {
      console.warn(`[draft-tts] edge-tts 生成失败，降级为文本估算: ${err.message}`);
      return null;
    }
  }
  return durations;
}

function updateStoryboardDurations(storyboardPath, slotList) {
  let content = readFileSync(storyboardPath, "utf8");
  let updated = false;

  for (const item of slotList) {
    const frameRegex = new RegExp(
      `(##\\s+Frame\\s+${item.frameNumber}[\\s\\S]*?-\\s*duration\\s*:\\s*)([^\\n]+)`,
      "m",
    );
    if (frameRegex.test(content)) {
      content = content.replace(frameRegex, `$1${item.slotDuration}`);
      updated = true;
    }
  }

  if (updated) {
    writeFileSync(storyboardPath, content, "utf8");
    console.log(`[draft-voice-timeline] 已将估算槽位回写至: ${storyboardPath}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = resolve(args.project);

  let sourceFile = args.file ? resolve(args.file) : null;
  let isScript = false;

  if (!sourceFile) {
    const scriptPath = join(project, "SCRIPT.md");
    const sbPath = join(project, "STORYBOARD.md");
    if (existsSync(scriptPath)) {
      sourceFile = scriptPath;
      isScript = true;
    } else if (existsSync(sbPath)) {
      sourceFile = sbPath;
      isScript = false;
    } else {
      console.error(`[draft-voice-timeline] 错误: 在 ${project} 未找到 SCRIPT.md 或 STORYBOARD.md`);
      process.exit(2);
    }
  } else {
    isScript = basename(sourceFile).toLowerCase().includes("script");
  }

  const rawContent = readFileSync(sourceFile, "utf8");
  const items = isScript ? parseScriptMd(rawContent) : parseStoryboardMd(rawContent);

  if (items.length === 0) {
    console.error(
      `[draft-voice-timeline] 未能从 ${basename(sourceFile)} 中解析出任何帧或行。请检查文件格式。`,
    );
    process.exit(2);
  }

  // 物理打样 (可选)
  let physicalDurations = null;
  if (args.draftTts) {
    const textList = items.map((i) => i.text);
    physicalDurations = runDraftTts(textList, args.voice, project);
  }

  const results = [];
  let cumulativeStart = 0;
  let hasWarnings = false;

  for (let idx = 0; idx < items.length; idx += 1) {
    const it = items[idx];
    const isLast = idx === items.length - 1;
    const { syllables, majorPunc, minorPunc, cleanText } = analyzeSpeechPacing(it.text);

    let voiceDur = 0;
    let isPhysical = false;

    if (physicalDurations && physicalDurations[idx]) {
      voiceDur = physicalDurations[idx];
      isPhysical = true;
    } else {
      // 声学公式估算：音节时长 + 标点停顿 (基于实测真值：长停顿 0.15s，短停顿 0.08s)
      const speechSec = syllables / args.rate;
      const pauseSec = majorPunc * 0.15 + minorPunc * 0.08;
      voiceDur = Math.max(1.0, Math.round((speechSec + pauseSec) * 10) / 10);
    }

    // VOX 槽位公式：0.3 (入场) + 旁白时长 + 2.4 (呼吸留白)，末帧 +1.6s 定格
    let slotDur = 0.3 + voiceDur + 2.4;
    if (isLast) slotDur += 1.6;
    slotDur = Math.round(slotDur * 10) / 10;

    results.push({
      frameNumber: it.frameNumber,
      title: it.title,
      textPreview: cleanText.length > 32 ? `${cleanText.slice(0, 30)}...` : cleanText,
      syllables,
      voiceDuration: voiceDur,
      isPhysical,
      slotDuration: slotDur,
    });
  }

  // 相对统计预警：以全片中位数槽位为基准
  const sortedSlots = [...results.map((r) => r.slotDuration)].sort((a, b) => a - b);
  const mid = Math.floor(sortedSlots.length / 2);
  const medianSlot =
    sortedSlots.length % 2 === 0 ? (sortedSlots[mid - 1] + sortedSlots[mid]) / 2 : sortedSlots[mid];

  for (const r of results) {
    let warning = null;
    if (r.slotDuration > 1.4 * medianSlot || r.voiceDuration > 24.0) {
      warning = `偏长 (>${r.slotDuration}s，超中位数1.4倍或旁白>24s)`;
      hasWarnings = true;
    } else if (r.slotDuration < 0.6 * medianSlot && r.slotDuration < 6.0) {
      warning = `偏短 (<${r.slotDuration}s，低中位数0.6倍且<6s)`;
      hasWarnings = true;
    }
    r.warning = warning;
    r.startAt = Math.round(cumulativeStart * 10) / 10;
    cumulativeStart += r.slotDuration;
  }

  const totalVoice = Math.round(results.reduce((acc, r) => acc + r.voiceDuration, 0) * 10) / 10;
  const totalSlot = Math.round(cumulativeStart * 10) / 10;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          sourceFile: basename(sourceFile),
          mode: physicalDurations ? "physical_tts_probe" : "formula_estimation",
          speedRate: args.rate,
          medianSlotDuration: medianSlot,
          totalFrames: results.length,
          totalVoiceDuration: totalVoice,
          totalSlotDuration: totalSlot,
          frames: results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`\n=== VOX 前置文案时序推导表 (${basename(sourceFile)}) ===`);
    console.log(
      `测算模式: ${physicalDurations ? "物理极速TTS真实打样" : `声学公式估算 (速率: ${args.rate} 音节/秒)`}`,
    );
    console.log(
      `总帧数: ${results.length} | 槽位中位数: ${medianSlot}s | 预估旁白总长: ${totalVoice}s | 预估成片总长: ${totalSlot}s\n`,
    );

    console.log(
      "帧号 | 标题/预览                        | 音节 | 旁白(s) | 槽位(s) | 起点(s) | 节奏诊断",
    );
    console.log(
      "-----+----------------------------------+------+---------+---------+---------+-----------",
    );
    for (const r of results) {
      const fNum = String(r.frameNumber).padStart(2, "0");
      const titleP = (r.textPreview || r.title).padEnd(32).slice(0, 32);
      const syl = String(r.syllables).padStart(4);
      const vd = String(r.voiceDuration).padStart(7);
      const sd = String(r.slotDuration).padStart(7);
      const st = String(r.startAt).padStart(7);
      const diag = r.warning ? `⚠️ ${r.warning}` : "✅ 良好";
      console.log(`${fNum}   | ${titleP} | ${syl} | ${vd} | ${sd} | ${st} | ${diag}`);
    }
    if (hasWarnings) {
      console.log(
        "提示: 检测到单帧偏长或偏短的节奏预警，建议在进入正式配音前按提示拆帧或补充文案。",
      );
    }
    console.log("");
  }

  if (args.updateStoryboard) {
    if (!args.force) {
      console.error(
        "[draft-voice-timeline] 拒绝覆盖: --update-storyboard 属于高风险破坏性写回操作，请附加 --force 确认覆盖 STORYBOARD.md 中的 duration 设定。",
      );
      process.exit(2);
    }
    const sbPath = join(project, "STORYBOARD.md");
    if (existsSync(sbPath)) {
      updateStoryboardDurations(sbPath, results);
    } else {
      console.warn(`[draft-voice-timeline] 未找到 STORYBOARD.md，跳过回写。`);
    }
  }

  if (args.strict && hasWarnings) {
    process.exit(1);
  }
  process.exit(0);
}

main();
