#!/usr/bin/env node
/**
 * verify-film-audio.mjs — 判别一段音轨是**语音**还是**杂音**（而不是静音）。
 *
 * 为什么需要它：TTS 引擎加载错权重版本时**会成功产出音频文件**——只是内容是杂音。
 * 文件在、时长对、能播放，一切看起来正常。本项目实测过一次：旧的 bridge 用 2.0 结构
 * 加载 2.5 权重（日志 missing keys (212) / skipping spk_emb_proj），产出的 12 条 wav
 * 全是杂音，而它们在文件系统里"看起来完全正常"。
 *
 * 判别特征（实测）：
 *   正常语音 → 帧 RMS 变异系数 CV ≥ 0.9，静音帧占比 25–48%（有停顿、有起伏）
 *   杂音     → CV ≈ 0.36，静音帧 ≈ 2%（持续噪声，无停顿、无起伏）
 *   静音     → peak RMS ≈ 0，静音帧 100%
 *
 * 关于那两个参考值：**它们取自一次真实的坏 TTS 产物**（权重版本不匹配的 IndexTTS 输出），
 * 不是人造白噪声。人造白噪声的 CV 会低到 ≈ 0.02 —— 同样会被判为杂音，只是别拿 0.36 当"典型杂音"。
 * 判据是**阈值**（CV ≥ 0.9 且静音帧在区间内），参考值只用来解释阈值为什么这么定。
 *
 * 特征的精确定义（可复现）：
 *   把目标区间解成 mono / 22050Hz / s16le，按 **20ms 一帧**算 RMS；
 *   CV = 帧 RMS 的标准差 / 均值；静音帧 = RMS < 全段峰值 RMS 的 10%（下限 -60dBFS）。
 *   换参数会换数值，所以判据与阈值一起固定在这里，不要各算各的。
 *
 * 用法：
 *   node verify-film-audio.mjs <media> <start秒> <时长秒> [--json]
 *   media 可以是 wav / mp3 / mp4（mp4 会取音轨）
 * 退出码：0 = 判定为语音，1 = 不是语音（杂音/静音/特征可疑），2 = 用法或环境错误
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SAMPLE_RATE = 22050;
const FRAME_MS = 20;
const SPEECH_CV_MIN = 0.9;
const SPEECH_SILENCE_MIN = 0.25;
const SPEECH_SILENCE_MAX = 0.48;

function parseArgs(argv) {
  const out = { json: false, media: null, start: null, dur: null };
  const rest = [];
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else rest.push(a);
  }
  out.media = rest[0] ?? null;
  out.start = rest[1] === undefined ? null : Number(rest[1]);
  out.dur = rest[2] === undefined ? null : Number(rest[2]);
  return out;
}

function which(bin) {
  const r = spawnSync(bin, ["-version"], { stdio: "ignore", shell: process.platform === "win32" });
  return r.status === 0;
}

/** 用 ffmpeg 解成 raw s16le mono PCM */
function decodeWithFfmpeg(media, start, dur, outFile) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(start),
      "-t",
      String(dur),
      "-i",
      media,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-y",
      outFile,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (r.status !== 0 || !existsSync(outFile)) return null;
  const buf = readFileSync(outFile);
  return buf.length >= 2 ? buf : null;
}

/** 手写解析 PCM wav（不依赖 ffmpeg）；只支持 16bit，其它位深回退 ffmpeg */
function decodeWavDirect(media, start, dur) {
  const b = readFileSync(media);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return null;
  let rate = null;
  let channels = null;
  let bits = null;
  let dataOff = null;
  let dataLen = null;
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(i + 8 + 2);
      rate = b.readUInt32LE(i + 8 + 4);
      bits = b.readUInt16LE(i + 8 + 14);
    } else if (id === "data") {
      dataOff = i + 8;
      dataLen = Math.min(size, b.length - dataOff);
      break;
    }
    i += 8 + size + (size % 2);
  }
  if (!rate || !channels || bits !== 16 || dataOff === null) return null;

  const bytesPerFrame = channels * 2;
  const from = dataOff + Math.floor(start * rate) * bytesPerFrame;
  const to = Math.min(dataOff + dataLen, from + Math.floor(dur * rate) * bytesPerFrame);
  if (to <= from) return null;

  // 下混为 mono，重采样交给调用方按 rate 处理（这里保留原 rate，帧长按 rate 计算）
  const frames = Math.floor((to - from) / bytesPerFrame);
  const out = Buffer.alloc(frames * 2);
  for (let f = 0; f < frames; f += 1) {
    let acc = 0;
    for (let c = 0; c < channels; c += 1) {
      acc += b.readInt16LE(from + f * bytesPerFrame + c * 2);
    }
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(acc / channels))), f * 2);
  }
  return { pcm: out, rate };
}

/** 按 20ms 一帧算 RMS */
function frameRms(pcm, rate) {
  const samplesPerFrame = Math.max(1, Math.round((FRAME_MS / 1000) * rate));
  const total = Math.floor(pcm.length / 2 / samplesPerFrame);
  const rms = new Float64Array(total);
  for (let f = 0; f < total; f += 1) {
    let sum = 0;
    const base = f * samplesPerFrame * 2;
    for (let s = 0; s < samplesPerFrame; s += 1) {
      const v = pcm.readInt16LE(base + s * 2) / 32768;
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / samplesPerFrame);
  }
  return rms;
}

function analyse(rms) {
  let sum = 0;
  let peak = 0;
  for (const v of rms) {
    sum += v;
    if (v > peak) peak = v;
  }
  const mean = sum / rms.length;
  let varSum = 0;
  for (const v of rms) varSum += (v - mean) * (v - mean);
  const sd = Math.sqrt(varSum / rms.length);
  const cv = mean > 0 ? sd / mean : 0;
  // 静音阈值：全段峰值 RMS 的 10%，但不低于 -60dBFS（0.001）
  const thresh = Math.max(peak * 0.1, 0.001);
  const silent = [...rms].filter((v) => v < thresh).length;
  const silenceRatio = rms.length ? silent / rms.length : 0;
  return { frames: rms.length, meanRms: mean, sd, cv, peak, thresh, silenceRatio };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.media ||
    args.start === null ||
    args.dur === null ||
    !Number.isFinite(args.start) ||
    !Number.isFinite(args.dur)
  ) {
    console.error("usage: node verify-film-audio.mjs <media> <start秒> <时长秒> [--json]");
    return 2;
  }
  const media = resolve(args.media);
  if (!existsSync(media)) {
    console.error(`[usage] media not found: ${media}`);
    return 2;
  }

  // 先试直接解 wav（不依赖 ffmpeg），失败再走 ffmpeg
  let pcm = null;
  let rate = SAMPLE_RATE;
  let method = null;
  const direct = /\.wav$/i.test(media) ? decodeWavDirect(media, args.start, args.dur) : null;
  if (direct) {
    pcm = direct.pcm;
    rate = direct.rate;
    method = "wav-direct";
  } else {
    if (!which("ffmpeg")) {
      console.error("[env] 需要 ffmpeg（用来解非 wav 媒体），但 PATH 里找不到。");
      console.error("      只测 wav 时可直接传 .wav，本脚本会手写解析、不需要 ffmpeg。");
      return 2;
    }
    const dir = mkdtempSync(join(tmpdir(), "vox-audio-"));
    const outFile = join(dir, "pcm.s16le");
    try {
      pcm = decodeWithFfmpeg(media, args.start, args.dur, outFile);
      method = "ffmpeg";
    } finally {
      // 保留到读完再删
    }
    if (!pcm) {
      rmSync(dir, { recursive: true, force: true });
      console.error("[env] ffmpeg 解码失败（区间可能超出媒体长度？）");
      return 2;
    }
    const buf = pcm;
    rmSync(dir, { recursive: true, force: true });
    pcm = buf;
  }
  if (!pcm || pcm.length < 2) {
    console.error("[env] 解出的 PCM 为空");
    return 2;
  }

  const rms = frameRms(pcm, rate);
  if (rms.length === 0) {
    console.error("[env] 帧数为 0，区间太短");
    return 2;
  }
  const m = analyse(rms);

  const looksSpeech =
    m.cv >= SPEECH_CV_MIN &&
    m.silenceRatio >= SPEECH_SILENCE_MIN &&
    m.silenceRatio <= SPEECH_SILENCE_MAX;
  const looksNoise = m.cv < 0.6 && m.silenceRatio < 0.1;
  const looksSilent = m.peak < 0.005 || m.silenceRatio > 0.95;
  const verdict = looksSilent
    ? "silent"
    : looksSpeech
      ? "speech"
      : looksNoise
        ? "noise"
        : "ambiguous";

  const out = {
    media,
    start: args.start,
    duration: args.dur,
    method,
    sampleRate: rate,
    frameMs: FRAME_MS,
    cv: Number(m.cv.toFixed(3)),
    silenceRatio: Number(m.silenceRatio.toFixed(3)),
    meanRms: Number(m.meanRms.toFixed(5)),
    peakRms: Number(m.peak.toFixed(5)),
    frames: m.frames,
    verdict,
    ok: verdict === "speech",
    thresholds: {
      speechCvMin: SPEECH_CV_MIN,
      speechSilence: [SPEECH_SILENCE_MIN, SPEECH_SILENCE_MAX],
    },
  };

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`${media}  [${args.start}s +${args.dur}s]  解码=${method} @${rate}Hz`);
    console.log(`  帧数 ${m.frames}（${FRAME_MS}ms/帧）`);
    console.log(`  CV          = ${out.cv}      (语音 ≥ ${SPEECH_CV_MIN}；杂音 ≈ 0.36)`);
    console.log(
      `  静音帧占比  = ${(out.silenceRatio * 100).toFixed(1)}%   (语音 ${SPEECH_SILENCE_MIN * 100}–${SPEECH_SILENCE_MAX * 100}%；杂音 ≈ 2%)`,
    );
    console.log(`  峰值 RMS    = ${out.peakRms}`);
    console.log(
      `\n判定：${
        verdict === "speech"
          ? "语音 ✓"
          : verdict === "noise"
            ? "杂音 ✗（检查 TTS 引擎的模型结构与权重版本是否匹配）"
            : verdict === "silent"
              ? "静音 ✗（旁白根本没合出来，或取错了区间）"
              : "可疑 —— 人工听一遍"
      }`,
    );
  }
  return out.ok ? 0 : 1;
}

process.exit(main());
