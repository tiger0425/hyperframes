// Local image generation AND editing through a running ComfyUI server.
//
// The sibling mflux provider is macOS/MLX-only; ComfyUI is the cross-platform
// local path. This provider drives the workflow pair the HyperFrames project
// standardised on — Qwen-Image-2.1 — with two graphs:
//   generate -> a text-to-image graph (optionally native RGBA transparency)
//   process  -> a multi-reference edit graph (1..10 reference images)
//
// It is opt-in and degrades to a clean miss (null) when ComfyUI is neither
// reachable nor launchable, so the registry falls through to mflux / the codex
// upsell exactly as before. media-use still holds no keys: ComfyUI owns its own
// models and lifecycle.
//
// Configuration (all optional; with none set the provider is a no-op):
//   COMFYUI_URL      base URL of a running server   (default http://127.0.0.1:8188)
//   COMFYUI_LAUNCH   launcher started cold          (e.g. ...\run_nvidia_gpu.bat)
//   COMFYUI_UNET / COMFYUI_CLIP / COMFYUI_VAE   override the Qwen-Image-2.1 weights
//
// Determinism: seed defaults to a fixed value (ctx.seed overrides), so the same
// request against the same weights resolves to the same image.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const COMFYUI_DEFAULT_URL = "http://127.0.0.1:8188";

// Qwen-Image-2.1 weights, as published under Comfy-Org/Qwen-Image-2.1.
const DEFAULT_WEIGHTS = {
  unet: "qwen_image_2.1_int8_convrot.safetensors",
  clip: "qwen3vl_8b_int8_convrot.safetensors",
  vae: "qwen_image_2.1_vae_bf16.safetensors",
};

// Qwen-Image-2.1's native transparency needs the prompt declared as RGBA, and
// the alpha survives only through a PNG save (see the official t2i template).
const RGBA_HEAD = "This is an RGBA format image with transparency.";
const RGBA_TAIL = "The image has an alpha channel and a transparent background.";

/** Wrap an intent in the RGBA declaration Qwen-Image-2.1 requires for alpha. */
export function wrapTransparentPrompt(intent) {
  return `${RGBA_HEAD} ${String(intent).trim()} ${RGBA_TAIL}`;
}

/** Snap a dimension to Qwen-Image-2.1's required multiple (VAE 16x, latent 2x). */
export function snapTo32(n, fallback = 1024) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(32, Math.round(v / 32) * 32);
}

export function normalizeModelSha256(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

// --- edit VRAM budget -------------------------------------------------------
//
// The edit path holds every reference AND the target latent in VRAM at once, and
// when their combined pixel count crosses the card's headroom the edit does NOT
// fail: it returns high-frequency noise, at a normal speed and with no error
// (issues/17 §7.2). Measured on a 24GB card: ~3.9MP passes, ~4.2MP breaks. The
// budget below sits between those two, and `planEditRefs` computes the
// reference down-scale that keeps a request under it. This is why "references
// pre-shrunk to ≤1024²" is the project's standing recipe (issues/17 §7.3).

/** Measured pass/fail boundary for "target + references" pixels (~3.9MP ok, ~4.2MP breaks). */
export const EDIT_PIXEL_BUDGET = 4_000_000;

/** Reference cap from the recipe: references are kept to ≤1024² (issues/17 §7.3). */
export const EDIT_REF_EDGE_CAP = 1024;

/** Plan against 90% of the cliff, not the cliff itself — the boundary is empirical. */
const EDIT_BUDGET_MARGIN = 0.9;

/**
 * Decide how to keep an edit inside the VRAM budget.
 *
 * Returns `{ over: false }` when it already fits; otherwise `{ over: true,
 * total, refPixels, scale }` where `scale` is the uniform factor to apply to
 * every reference (never >1, never under-capped at 1024²) — or `null` when the
 * target alone is over budget and shrinking references cannot help.
 */
export function planEditRefs({
  refSizes,
  targetPixels,
  budget = EDIT_PIXEL_BUDGET,
  edgeCap = EDIT_REF_EDGE_CAP,
  margin = EDIT_BUDGET_MARGIN,
} = {}) {
  const known = (refSizes || []).filter(Boolean);
  const refPixels = known.reduce((n, s) => n + s.width * s.height, 0);
  const total = targetPixels + refPixels;
  if (refPixels === 0 || total <= budget) return { over: false, total, refPixels };

  const allowed = budget * margin - targetPixels;
  if (allowed <= 0) return { over: true, total, refPixels, scale: null };

  const byBudget = Math.sqrt(allowed / refPixels);
  const byEdge = Math.min(...known.map((s) => edgeCap / Math.max(s.width, s.height)));
  const scale = Math.min(byEdge, byBudget);
  return { over: true, total, refPixels, scale: scale < 1 ? scale : null };
}

/** Scale a pixel size, rounded to even dimensions so chroma survives the resize. */
export function scaledSize({ width, height }, scale) {
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Write a down-scaled copy of `srcPath` through ffmpeg and return its path. The
 * copy lands beside the original so the caller's reference is left untouched.
 */
export function downscaleReference(srcPath, size, deps = {}) {
  const { execFn = execFileSync, ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg" } = deps;
  const dest = `${srcPath}.ref-${size.width}x${size.height}.png`;
  execFn(
    ffmpegPath,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      srcPath,
      "-vf",
      `scale=${size.width}:${size.height}`,
      "-frames:v",
      "1",
      dest,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  return dest;
}

function weights(ctx) {
  return {
    unet: ctx?.comfyuiUnet || process.env.COMFYUI_UNET || DEFAULT_WEIGHTS.unet,
    clip: ctx?.comfyuiClip || process.env.COMFYUI_CLIP || DEFAULT_WEIGHTS.clip,
    vae: ctx?.comfyuiVae || process.env.COMFYUI_VAE || DEFAULT_WEIGHTS.vae,
  };
}

function baseUrl(ctx) {
  const raw = ctx?.comfyuiUrl || process.env.COMFYUI_URL || COMFYUI_DEFAULT_URL;
  return String(raw).replace(/\/+$/, "");
}

// --- graph builders (pure: no I/O, unit-tested directly) ---------------------

function modelNodes(w) {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: w.unet, weight_dtype: "default" } },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: w.clip, type: "qwen_image", device: "default" },
    },
    vae: { class_type: "VAELoader", inputs: { vae_name: w.vae } },
  };
}

function samplerAndSave({ seed, steps, width, height, prefix }) {
  return {
    latent: {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    sampler: {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["unet", 0],
        positive: ["text", 0],
        negative: ["text", 1],
        latent_image: ["latent", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
    save: {
      class_type: "SaveImageAdvanced",
      inputs: {
        images: ["decode", 0],
        filename_prefix: prefix,
        format: "png",
        "format.bit_depth": "8-bit",
        "format.input_color_space": "sRGB",
      },
    },
  };
}

/**
 * Text-to-image graph. `transparent` wraps the prompt so the model writes an
 * alpha channel; everything else mirrors the official Qwen-Image-2.1 template.
 */
export function buildT2IGraph({ prompt, width, height, steps, seed, transparent, w, prefix }) {
  const text = transparent ? wrapTransparentPrompt(prompt) : String(prompt).trim();
  return {
    ...modelNodes(w),
    text: {
      class_type: "TextEncodeQwenImage21",
      inputs: { prompt: text, negative_prompt: "", resolution: 1024, clip: ["clip", 0] },
    },
    ...samplerAndSave({ seed, steps, width, height, prefix }),
  };
}

/**
 * Multi-reference edit graph. `refs` is a list of ComfyUI input filenames (the
 * caller uploads first); they bind to the autogrow inputs images.image_1..N.
 * The VAE rides along on the encoder so an image-derived latent is available,
 * matching the official image-edit template.
 */
export function buildEditGraph({
  prompt,
  refs,
  width,
  height,
  steps,
  seed,
  w,
  prefix,
  followRefSize,
}) {
  const loaders = {};
  const imageInputs = {};
  refs.forEach((name, i) => {
    const id = `load${i + 1}`;
    loaders[id] = { class_type: "LoadImage", inputs: { image: name } };
    imageInputs[`images.image_${i + 1}`] = [id, 0];
  });

  const text = {
    class_type: "TextEncodeQwenImage21",
    inputs: {
      prompt: String(prompt),
      negative_prompt: "",
      resolution: 0,
      clip: ["clip", 0],
      vae: ["vae", 0],
      ...imageInputs,
    },
  };

  const graph = {
    ...modelNodes(w),
    text,
    ...loaders,
    latent: {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    sampler: {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["unet", 0],
        positive: ["text", 0],
        negative: ["text", 1],
        latent_image: ["latent", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
    save: {
      class_type: "SaveImageAdvanced",
      inputs: {
        images: ["decode", 0],
        filename_prefix: prefix,
        format: "png",
        "format.bit_depth": "8-bit",
        "format.input_color_space": "sRGB",
      },
    },
  };

  // followRefSize: reuse the encoder's image-derived latent instead of a blank
  // one, so the edit inherits the reference's framing/size. Off by default —
  // explicit width/height keep output dimensions predictable.
  if (followRefSize) {
    graph.sampler.inputs.latent_image = ["text", 2];
    delete graph.latent;
  }
  return graph;
}

// --- image sizing (dependency-free header read for PNG / JPEG / WEBP) --------

/** Read pixel dimensions from a PNG/JPEG/WEBP header, or null when unknown. */
export function readImageSize(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: 8-byte signature, then IHDR width/height as big-endian u32.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WEBP (VP8X / VP8 / VP8L).
  if (
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    const fourcc = buf.slice(12, 16).toString("ascii");
    if (fourcc === "VP8X") {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    return null;
  }
  // JPEG: walk segments to the first SOFn frame header.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

// --- server lifecycle -------------------------------------------------------

/** Probe a running server; returns system_stats, or null when unreachable. */
export async function comfyuiProbe(url, fetchFn = fetch, timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${url}/system_stats`, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How to launch the server so it OUTLIVES the caller.
 *
 * On Windows a launcher started as a plain child shares the agent shell's
 * console: the long-lived server keeps that shell's output pipe open, so the
 * agent's command never looks finished and gets reaped — taking the printout
 * (and sometimes the server) with it. `start` gives the launcher its own
 * console and returns immediately, which is what "start it on demand and then
 * get on with the resolve" actually requires. `/min` keeps it out of the way.
 *
 * POSIX launchers are shell scripts or PATH commands, so they go through the
 * shell instead. Pure + platform-parameterised so it is unit-testable on both.
 */
export function comfyuiLaunchCommand(launch, platform = process.platform) {
  if (platform === "win32") {
    return { cmd: "cmd", argv: ["/c", "start", "", "/min", launch], shell: false };
  }
  return { cmd: launch, argv: [], shell: true };
}

/**
 * Resolve a usable base URL: an already-running server wins; otherwise start
 * COMFYUI_LAUNCH (detached, from its own directory so relative launcher paths
 * resolve) and poll until it answers. Returns null when neither is possible —
 * the caller then reports a miss rather than hanging.
 */
export async function ensureComfyui(ctx, deps = {}) {
  const {
    fetchFn = fetch,
    spawnFn = spawn,
    platform = process.platform,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    readyTimeoutMs = Number(process.env.COMFYUI_READY_TIMEOUT_MS) || 240_000,
    pollMs = 3000,
  } = deps;

  const url = baseUrl(ctx);
  if (await comfyuiProbe(url, fetchFn)) return url;

  const launch = ctx?.comfyuiLaunch || process.env.COMFYUI_LAUNCH;
  if (!launch) return null;

  try {
    const { cmd, argv, shell } = comfyuiLaunchCommand(launch, platform);
    const child = spawnFn(cmd, argv, {
      shell,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // Portable builds resolve ./python_embeded relative to the launcher.
      cwd: dirname(launch),
    });
    child.unref?.();
  } catch {
    return null;
  }

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (await comfyuiProbe(url, fetchFn)) return url;
  }
  return null;
}

// --- ComfyUI API ------------------------------------------------------------

async function postJson(url, body, fetchFn) {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON error body — surfaced verbatim below
  }
  if (!res.ok || !json) {
    throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return json;
}

/** Upload a local file into ComfyUI's input dir; returns the LoadImage name. */
export async function uploadImage(url, filePath, deps = {}) {
  const { fetchFn = fetch, readFileFn = readFileSync } = deps;
  const bytes = readFileFn(filePath);
  const form = new FormData();
  form.append("image", new Blob([bytes]), basename(filePath));
  form.append("overwrite", "true");
  const res = await fetchFn(`${url}/upload/image`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  return json.subfolder ? `${json.subfolder}/${json.name}` : json.name;
}

function pickOutputImage(record) {
  for (const node of Object.values(record?.outputs || {})) {
    const hit = (node?.images || [])[0];
    if (hit) return hit;
  }
  return null;
}

/**
 * Queue a graph and wait for its first saved image, writing it to outPath.
 * Throws with ComfyUI's own message on a graph/node error so the caller can
 * surface something actionable instead of a bare timeout.
 */
export async function runGraph(url, graph, outPath, deps = {}) {
  const {
    fetchFn = fetch,
    writeFileFn = writeFileSync,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    timeoutMs = Number(process.env.COMFYUI_JOB_TIMEOUT_MS) || 900_000,
    pollMs = 1000,
  } = deps;

  const clientId = `media-use-${process.pid}-${Date.now()}`;
  const queued = await postJson(`${url}/prompt`, { prompt: graph, client_id: clientId }, fetchFn);

  if (queued.node_errors && Object.keys(queued.node_errors).length) {
    throw new Error(`node error: ${JSON.stringify(queued.node_errors).slice(0, 400)}`);
  }
  const id = queued.prompt_id;
  if (!id)
    throw new Error(`no prompt_id in queue response: ${JSON.stringify(queued).slice(0, 200)}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const res = await fetchFn(`${url}/history/${id}`);
    if (!res.ok) continue;
    const history = await res.json();
    const record = history?.[id];
    if (!record) continue;

    const status = record.status?.status_str;
    if (status === "error") {
      const msg = (record.status?.messages || [])
        .filter(([kind]) => kind === "execution_error")
        .map(([, info]) => `${info.node_type || "?"}: ${info.exception_message || "failed"}`)
        .join("; ");
      throw new Error(`execution error: ${msg || "unknown"}`);
    }

    const image = pickOutputImage(record);
    if (!image) continue; // still rendering (or the graph saved nothing)

    const qs = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder || "",
      type: image.type || "output",
    });
    const bin = await fetchFn(`${url}/view?${qs}`);
    if (!bin.ok) throw new Error(`could not fetch output: HTTP ${bin.status}`);
    writeFileFn(outPath, Buffer.from(await bin.arrayBuffer()));
    return outPath;
  }
  throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// --- alpha normalization ----------------------------------------------------

/**
 * Qwen-Image-2.1's alpha is not binary, in both directions:
 *   - a requested cut-out leaves the "empty" background at alpha 1-15, not 0,
 *     which composites as a faint grey wash on dark backgrounds;
 *   - an image that is not a cut-out still ships an alpha channel sitting at
 *     241-254 over most of the frame, i.e. "opaque" is not quite opaque.
 *
 * So the raw model output is normalized the way the request was made: a cut-out
 * gets its near-transparent pixels snapped to zero (anti-aliased edges from 16
 * up are left alone), and anything else is flattened to genuinely opaque by
 * dropping the alpha channel. `--raw-alpha` opts out and keeps the model's
 * bytes verbatim. Threshold 16 is the top of the band the model actually emits.
 */
export const ALPHA_CLEAN_THRESHOLD = 16;

/** ffmpeg -vf expression that normalizes alpha for a transparent/opaque target. */
export function alphaFilter(transparent) {
  return transparent
    ? `format=rgba,lut=a='if(lt(val,${ALPHA_CLEAN_THRESHOLD}),0,val)'`
    : "format=rgb24";
}

/**
 * Rewrite `outPath` in place with normalized alpha. Best-effort by design: a
 * missing/failing ffmpeg must never fail a resolve that already produced an
 * image, so the raw file stays and the reason goes to stderr.
 */
export function normalizeAlpha(outPath, { transparent, deps = {} } = {}) {
  const {
    execFn = execFileSync,
    existsFn = existsSync,
    renameFn = renameSync,
    unlinkFn = unlinkSync,
    ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  } = deps;

  const tmp = `${outPath}.alpha.png`;
  try {
    execFn(
      ffmpegPath,
      ["-y", "-loglevel", "error", "-i", outPath, "-vf", alphaFilter(transparent), tmp],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    if (!existsFn(tmp)) return false;
    renameFn(tmp, outPath); // Node replaces on Windows and POSIX alike
    return true;
  } catch (err) {
    try {
      if (existsFn(tmp)) unlinkFn(tmp);
    } catch {
      // the cleanup failure is not the story; the fallback below is
    }
    const why = err.stderr?.toString().trim().split(/\r?\n/).pop() || err.message;
    console.error(`media-use: alpha normalization skipped (${why})`);
    return false;
  }
}

/** Normalize unless the caller asked for the model's raw bytes. */
function maybeNormalizeAlpha(outPath, ctx, deps) {
  if (ctx?.rawAlpha) return;
  normalizeAlpha(outPath, { transparent: !!ctx?.transparent, deps });
}

// --- provider capabilities --------------------------------------------------

const DEFAULT_STEPS = 30;

function outPathFor() {
  return join(tmpdir(), `media-use-comfyui-${process.pid}-${Date.now()}.png`);
}

function generatedRecord({ intent, outPath, provider, extra }) {
  return {
    localPath: outPath,
    ext: ".png",
    source: "generated",
    metadata: {
      description: intent,
      provider,
      provenance: { prompt: intent, ...extra },
    },
  };
}

/** generate — text-to-image (ctr.transparent -> native RGBA). */
export async function comfyuiImageGenerate(intent, ctx = {}, deps = {}) {
  const url = await ensureComfyui(ctx, deps);
  if (!url) return null;

  const width = snapTo32(ctx.width, 1024);
  const height = snapTo32(ctx.height, 1024);
  const steps = Number(ctx.steps) > 0 ? Number(ctx.steps) : DEFAULT_STEPS;
  const seed = ctx.seed ?? 42;
  const transparent = !!ctx.transparent;
  const model = weights(ctx);
  const modelSha256 = normalizeModelSha256(ctx.modelSha256);

  const graph = buildT2IGraph({
    prompt: intent,
    width,
    height,
    steps,
    seed,
    transparent,
    w: model,
    prefix: "media_use",
  });

  const outPath = outPathFor();
  await runGraph(url, graph, outPath, deps);
  maybeNormalizeAlpha(outPath, ctx, deps);
  return generatedRecord({
    intent,
    outPath,
    provider: "comfyui.qwen_image_2_1",
    extra: {
      model: model.unet,
      model_file: model.unet,
      ...(modelSha256 ? { model_sha256: modelSha256 } : {}),
      workflow_format: "comfyui-api",
      workflow: graph,
      width,
      height,
      steps,
      seed,
      transparent,
    },
  });
}

/** process — multi-reference image edit (ctx.images = 1..10 local paths). */
export async function comfyuiImageEdit(intent, ctx = {}, deps = {}) {
  const refs = (ctx.images || []).filter(Boolean);
  if (!refs.length) return null;
  if (refs.length > 10) refs.length = 10; // Qwen-Image-2.1 caps at 10 references

  const { readFileFn = readFileSync, existsFn = existsSync } = deps;
  for (const ref of refs) {
    if (!existsFn(ref)) throw new Error(`reference image not found: ${ref}`);
  }

  const url = await ensureComfyui(ctx, deps);
  if (!url) return null;

  // Default the output to the first reference's framing so an edit keeps the
  // source aspect ratio; explicit width/height still win.
  let width = Number(ctx.width) || 0;
  let height = Number(ctx.height) || 0;
  const refSizes = refs.map((ref) => readImageSize(readFileFn(ref)));
  if (!width || !height) {
    const size = refSizes[0];
    width = size?.width || 1024;
    height = size?.height || 1024;
  }

  // Keep "target + references" under the measured VRAM cliff. Over-budget edits
  // come back as noise with no error, so shrink the references rather than let
  // one through silently (issues/17 §7.2/§7.3).
  const targetPixels = snapTo32(width) * snapTo32(height);
  const plan = planEditRefs({ refSizes, targetPixels });
  let uploadRefs = refs;
  if (plan.over) {
    const mp = (px) => (px / 1e6).toFixed(2);
    if (plan.scale) {
      console.error(
        `media-use: edit target + references = ${mp(plan.total)}MP, over the ~${mp(
          EDIT_PIXEL_BUDGET,
        )}MP ComfyUI budget — down-scaling ${refSizes.filter(Boolean).length} reference(s) by ${plan.scale.toFixed(
          2,
        )}× to avoid a silent noise result (issues/17 §7.2).`,
      );
      uploadRefs = refs.map((ref, i) =>
        refSizes[i] ? downscaleReference(ref, scaledSize(refSizes[i], plan.scale), deps) : ref,
      );
    } else {
      console.error(
        `media-use: edit target alone is ${mp(targetPixels)}MP, already at the ~${mp(
          EDIT_PIXEL_BUDGET,
        )}MP ComfyUI budget — lower --width/--height or the edit may return noise (issues/17 §7.2).`,
      );
    }
  }

  const uploaded = [];
  for (const ref of uploadRefs) uploaded.push(await uploadImage(url, ref, deps));

  const steps = Number(ctx.steps) > 0 ? Number(ctx.steps) : DEFAULT_STEPS;
  const seed = ctx.seed ?? 42;
  const model = weights(ctx);
  const modelSha256 = normalizeModelSha256(ctx.modelSha256);
  const graph = buildEditGraph({
    // Same RGBA declaration generate uses: Qwen-Image-2.1 keeps alpha across an
    // edit only when the prompt still asks for a transparent result.
    prompt: ctx.transparent ? wrapTransparentPrompt(intent) : intent,
    refs: uploaded,
    width: snapTo32(width),
    height: snapTo32(height),
    steps,
    seed,
    w: model,
    prefix: "media_use_edit",
    followRefSize: !!ctx.followRefSize,
  });

  const outPath = outPathFor();
  await runGraph(url, graph, outPath, deps);
  maybeNormalizeAlpha(outPath, ctx, deps);
  return generatedRecord({
    intent,
    outPath,
    provider: "comfyui.qwen_image_2_1_edit",
    extra: {
      model: model.unet,
      model_file: model.unet,
      ...(modelSha256 ? { model_sha256: modelSha256 } : {}),
      workflow_format: "comfyui-api",
      workflow: graph,
      width: snapTo32(width),
      height: snapTo32(height),
      steps,
      seed,
      references: refs.length,
      // Reference size is a reproduction input, not a nicety: the same seed
      // against a differently-sized reference yields a different image.
      ref_sizes: refSizes.map((s) => (s ? `${s.width}x${s.height}` : null)),
      ...(plan.scale ? { ref_scale: Number(plan.scale.toFixed(3)) } : {}),
    },
  });
}

/** Best-effort descriptor for --doctor; never throws. */
export async function comfyuiStatus(ctx = {}, deps = {}) {
  const url = baseUrl(ctx);
  const stats = await comfyuiProbe(url, deps.fetchFn || fetch);
  if (!stats) return { ok: false, url };
  return {
    ok: true,
    url,
    version: stats.system?.comfyui_version || null,
    device: stats.devices?.[0]?.name || null,
  };
}
