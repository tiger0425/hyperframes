#!/usr/bin/env node
/**
 * gen-asmr.mjs —— 纸 ASMR 素材生成器（**通道 C：ffmpeg 确定性合成**）。
 *
 * 为什么需要它：`issues/09` / `issues/19` §4 定了 ASMR 的落地规格，但素材必须**冻结**（不许渲染时随机）。
 * 本脚本用 `lavfi` 源 + 固定 `seed` 生成**确定性** WAV：同一个 ffmpeg 版本、同一份代码 = 同一批字节。
 *
 * 通道分工（`issues/19` §4，线嘶经 `issues/09` 盲听修订）：
 *   · 本脚本 = **通道 C**：敲击类（卡纸敲 / 胶带压 / 章砰 / 橡皮章落 / 钉咔）+ **线嘶**（窄带噪声"嘶"）。
 *     线嘶 走 C 是**盲听结论**：拉来的 CC0「绳张力 / 绳扭」听感不对，合成更像"红线拉直"。
 *   · 纸滑 / 房间底噪（"纤维感"合成做不过录音）**不默认生成**：由通道 G（CC0 真实录音）按项目入库
 *     （`.media/audio/asmr/`）。若拿不到录音，用 `--with-fallbacks` 出 C 近似版顶上（会偏"雪花声"）。
 *
 * 规格（`_contract.md` §1 / `issues/19` §4）：
 *   PCM s16le WAV · 48000 Hz · mono · ≤2.5s · 成品峰值 **−18 ~ −14 dBFS**；每种 **≥2 变体**；
 *   **绝不写 `.media/audio/voice/`**（会被 `verify-timeline` 当旁白）。
 *
 * 用法：
 *   node tools/gen-asmr.mjs [--project .] [--out .media/audio/asmr] [--with-fallbacks] [--only <slug,…>] [--write-manifest] [--force] [--json]
 * 退出码：0 = 全部就位（已存在且合法则跳过），1 = 有文件生成失败，2 = 用法/环境错误
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const ENC = ["-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le"];

/** `inputs(seed)` 给 `[源名, 参数]` 列表；`filter` 是 `-filter_complex`（多源）或 `-af`（单源）。 */
const RECIPES = {
  "card-knock": {
    maxDur: 0.3,
    target: -16,
    complex: true,
    inputs: (s) => [
      ["sine", "f=110:d=0.25"],
      ["anoisesrc", `c=pink:d=0.06:seed=${100 + s}`],
    ],
    filter:
      "[0:a]afade=t=out:st=0.02:d=0.23,volume=0.9[a0];[1:a]highpass=f=300,lowpass=f=6000,afade=t=out:st=0.005:d=0.055,volume=0.5[a1];[a0][a1]amix=inputs=2:normalize=0",
  },
  "tape-press": {
    maxDur: 0.35,
    target: -16,
    complex: true,
    inputs: (s) => [
      ["anoisesrc", `c=pink:d=0.30:seed=${200 + s}`],
      ["sine", "f=90:d=0.12"],
    ],
    filter:
      "[0:a]highpass=f=500,lowpass=f=4500,afade=t=in:st=0:d=0.008,afade=t=out:st=0.10:d=0.20,volume=0.9[a0];[1:a]afade=t=out:st=0.015:d=0.105,volume=0.5[a1];[a0][a1]amix=inputs=2:normalize=0",
  },
  "stamp-thump": {
    maxDur: 0.5,
    target: -16,
    complex: true,
    inputs: (s) => [
      ["sine", "f=70:d=0.40"],
      ["anoisesrc", `c=white:d=0.05:seed=${300 + s}`],
    ],
    filter:
      "[0:a]afade=t=out:st=0.03:d=0.37,volume=1.0[a0];[1:a]highpass=f=200,lowpass=f=5000,afade=t=out:st=0.005:d=0.045,volume=0.7[a1];[a0][a1]amix=inputs=2:normalize=0",
  },
  "stamp-squash": {
    maxDur: 0.25,
    target: -16,
    complex: true,
    inputs: (s) => [
      ["sine", "f=150:d=0.20"],
      ["anoisesrc", `c=pink:d=0.04:seed=${400 + s}`],
    ],
    filter:
      "[0:a]afade=t=out:st=0.02:d=0.18,volume=0.8[a0];[1:a]highpass=f=800,lowpass=f=7000,afade=t=out:st=0.004:d=0.036,volume=0.5[a1];[a0][a1]amix=inputs=2:normalize=0",
  },
  "pin-tick": {
    maxDur: 0.12,
    target: -16,
    inputs: (s) => [["anoisesrc", `c=white:d=0.06:seed=${500 + s}`]],
    filter: "highpass=f=2500,lowpass=f=12000,afade=t=out:st=0.006:d=0.054,volume=0.9",
  },
  "string-zip": {
    maxDur: 0.8,
    target: -16,
    inputs: (s) => [["anoisesrc", `c=pink:d=0.6:seed=${700 + s}`]],
    filter:
      "highpass=f=1500,lowpass=f=7000,afade=t=in:st=0:d=0.35,afade=t=out:st=0.4:d=0.2,volume=0.7",
  },
};

/** 通道 G 的槽位：默认**不生成**，`--with-fallbacks` 才出 C 近似版。 */
/** 通道 G 的槽位：默认**不生成**，`--with-fallbacks` 才出 C 近似版（"纤维感"合成做不过录音）。 */
const FALLBACKS = {
  "paper-slide": {
    maxDur: 1.2,
    target: -16,
    inputs: (s) => [["anoisesrc", `c=pink:d=0.9:seed=${600 + s}`]],
    filter:
      "highpass=f=1200,lowpass=f=9000,tremolo=f=14:d=0.5,afade=t=in:st=0:d=0.25,afade=t=out:st=0.45:d=0.45,volume=0.7",
  },
  "room-tone": {
    maxDur: 2.5,
    target: -18,
    variants: 1,
    inputs: () => [["anoisesrc", "c=brown:d=2.5:seed=808"]],
    filter: "lowpass=f=600,volume=0.08",
  },
};

function genArgs(spec, seed) {
  const args = [];
  for (const [src, opt] of spec.inputs(seed)) args.push("-f", "lavfi", "-i", `${src}=${opt}`);
  args.push(spec.complex ? "-filter_complex" : "-af", spec.filter);
  return args;
}

function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    out: null,
    withFallbacks: false,
    writeManifest: false,
    force: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project") out.project = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--with-fallbacks") out.withFallbacks = true;
    else if (a === "--write-manifest") out.writeManifest = true;
    else if (a === "--force") out.force = true;
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--json") out.json = true;
    else if (!a.startsWith("-")) out.project = a;
    else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function ffmpeg(args) {
  return spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
}

/** volumedetect 的摘要走 info 级 —— 这次**不能**加 `-loglevel error`（会被吞掉）。 */
function measurePeak(tmp) {
  const devNull = process.platform === "win32" ? "NUL" : "/dev/null";
  const m = spawnSync(
    FFMPEG,
    ["-hide_banner", "-i", tmp, "-af", "volumedetect", "-f", "null", devNull],
    {
      encoding: "utf8",
    },
  );
  return (m.stderr || "").match(/max_volume:\s*(-?[\d.]+) dB/)?.[1] ?? null;
}

/** 两 pass：先量峰值，再按增益重编码到目标峰值。返回实测 {before, after}。 */
function normalizeTo(tmp, dest, targetDb) {
  const max = measurePeak(tmp);
  if (max === null) throw new Error(`volumedetect 读不到 max_volume`);
  const before = Number(max);
  const gain = Number((targetDb - before).toFixed(2));
  const r = ffmpeg(["-y", "-i", tmp, "-af", `volume=${gain}dB`, ...ENC, dest]);
  if (r.status !== 0) throw new Error(`重编码失败:\n${r.stderr}`);
  return { before, after: targetDb };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = resolve(args.project);
  if (!existsSync(join(project, ".media"))) {
    console.error(`[usage] ${project} 不是 vox 项目（缺 .media/）—— 传 --project <dir>`);
    return 2;
  }
  const outDir = resolve(args.out ?? join(project, ".media", "audio", "asmr"));
  mkdirSync(outDir, { recursive: true });

  if (spawnSync(FFMPEG, ["-version"], { encoding: "utf8" }).status !== 0) {
    console.error(`[env] 找不到 ffmpeg（设 FFMPEG=<path>）`);
    return 2;
  }

  const recipes = args.withFallbacks ? { ...RECIPES, ...FALLBACKS } : RECIPES;
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
  const scratch = mkdtempSync(join(tmpdir(), "vox-asmr-"));
  const report = [];
  let failed = 0;
  try {
    for (const [slug, spec] of Object.entries(recipes)) {
      if (only && !only.has(slug)) continue;
      const variants = spec.variants ?? 2;
      for (let v = 0; v < variants; v += 1) {
        const name = `asmr-${slug}-${String(v + 1).padStart(2, "0")}.wav`;
        const dest = join(outDir, name);
        if (existsSync(dest) && !args.force) {
          report.push({ file: name, status: "exists" });
          continue;
        }
        const tmp = join(scratch, name);
        const gen = ffmpeg(["-y", ...genArgs(spec, v), ...ENC, tmp]);
        if (gen.status !== 0) {
          failed += 1;
          report.push({
            file: name,
            status: "gen-failed",
            error: (gen.stderr || "").trim().slice(-200),
          });
          continue;
        }
        try {
          const lv = normalizeTo(tmp, dest, spec.target);
          report.push({
            file: name,
            status: "written",
            peakBefore: lv.before,
            peakAfter: lv.after,
          });
        } catch (e) {
          failed += 1;
          report.push({ file: name, status: "norm-failed", error: String(e.message).slice(-200) });
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // 账本行（通道 C = 合成音 → tier M5，见 visual-grammar §10 的 M 表；license:"self"）
  const rows = report
    .filter((r) => r.status === "written" || r.status === "exists")
    .map((r) => ({
      path: `.media/audio/asmr/${r.file}`,
      tier: "M5",
      origin: "ffmpeg lavfi synth (tools/gen-asmr.mjs)",
      license: "self",
      kind: "asmr",
      type: "audio",
    }));

  if (args.writeManifest && rows.length) {
    const mf = join(project, ".media", "manifest.jsonl");
    const existing = existsSync(mf) ? readFileSync(mf, "utf8") : "";
    const have = new Set(
      existing
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l).path;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
    const add = rows.filter((r) => !have.has(r.path));
    if (add.length) {
      const body = add.map((r) => JSON.stringify(r)).join("\n");
      writeFileSync(
        mf,
        existing.replace(/\s*$/, "") + (existing.trim() ? "\n" : "") + body + "\n",
        "utf8",
      );
    }
    if (args.json) report.push({ manifest: `+${add.length} 行` });
    else console.log(`账本 +${add.length} 行（tier M5 / license self）`);
  }

  const written = report.filter((r) => r.status === "written").length;
  const exists = report.filter((r) => r.status === "exists").length;
  if (args.json) {
    console.log(
      JSON.stringify({ ok: failed === 0, outDir, written, exists, failed, rows: report }, null, 2),
    );
  } else {
    for (const r of report) {
      if (r.status === "written")
        console.log(`+ ${r.file}  (peak ${r.peakBefore} → ${r.peakAfter} dBFS)`);
      else if (r.status === "exists") console.log(`= ${r.file}  (已存在，跳过)`);
      else console.log(`! ${r.file}  ${r.status}: ${r.error ?? ""}`);
    }
    console.log(`\n${written} 生成 · ${exists} 跳过 · ${failed} 失败 → ${outDir}`);
  }
  return failed === 0 ? 0 : 1;
}

process.exit(main());
