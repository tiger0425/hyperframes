import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_CLEAN_THRESHOLD,
  alphaFilter,
  buildEditGraph,
  buildT2IGraph,
  comfyuiImageEdit,
  comfyuiImageGenerate,
  comfyuiLaunchCommand,
  comfyuiProbe,
  downscaleReference,
  EDIT_PIXEL_BUDGET,
  ensureComfyui,
  normalizeAlpha,
  normalizeModelSha256,
  planEditRefs,
  readImageSize,
  runGraph,
  scaledSize,
  snapTo32,
  wrapTransparentPrompt,
} from "./comfyui-provider.mjs";

const URL_BASE = "http://127.0.0.1:8188";
const noSleep = async () => {};
const W = { unet: "u.safetensors", clip: "c.safetensors", vae: "v.safetensors" };

function pngHeader(width, height) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Stub the four ComfyUI endpoints the provider speaks. `historyRounds` lets a
 * job look "still running" for N polls before the record appears.
 */
function stubFetch({ up = true, historyRounds = 0, nodeErrors = null, execError = null } = {}) {
  const calls = [];
  const state = { historyHits: 0 };
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/system_stats"))
      return up
        ? json({ system: { comfyui_version: "0.37.0" } })
        : new Response("", { status: 503 });
    if (url.endsWith("/upload/image")) {
      return json({ name: "ref-uploaded.png", subfolder: "", type: "input" });
    }
    if (url.endsWith("/prompt")) {
      return json({ prompt_id: "pid-1", number: 0, node_errors: nodeErrors || {} });
    }
    if (url.includes("/history/")) {
      state.historyHits += 1;
      if (state.historyHits <= historyRounds) return json({});
      if (execError) {
        return json({
          "pid-1": {
            status: {
              status_str: "error",
              messages: [
                ["execution_error", { node_type: "KSampler", exception_message: execError }],
              ],
            },
            outputs: {},
          },
        });
      }
      return json({
        "pid-1": {
          status: { status_str: "success", completed: true },
          outputs: {
            save: { images: [{ filename: "out_00001.png", subfolder: "", type: "output" }] },
          },
        },
      });
    }
    if (url.includes("/view?")) return new Response(pngHeader(64, 48), { status: 200 });
    return new Response("", { status: 404 });
  };
  return { calls, fetchFn, state };
}

const written = () => {
  const files = new Map();
  return { files, writeFileFn: (p, b) => files.set(p, b) };
};

// --- pure helpers -----------------------------------------------------------

test("wrapTransparentPrompt adds the RGBA declaration Qwen-Image-2.1 needs", () => {
  const wrapped = wrapTransparentPrompt("  a rally car  ");
  assert.match(wrapped, /^This is an RGBA format image with transparency\./);
  assert.match(wrapped, /a rally car/);
  assert.match(wrapped, /The image has an alpha channel and a transparent background\.$/);
  assert.doesNotMatch(wrapped, /  a rally car  /); // intent is trimmed
});

test("snapTo32 snaps to Qwen-Image-2.1's required multiple and floors bad input", () => {
  assert.equal(snapTo32(1024), 1024);
  assert.equal(snapTo32(1000), 992);
  assert.equal(snapTo32(1030), 1024);
  assert.equal(snapTo32(10), 32);
  assert.equal(snapTo32(undefined, 512), 512);
  assert.equal(snapTo32(-5, 512), 512);
  assert.equal(snapTo32("2048"), 2048);
});

test("normalizeModelSha256 accepts a case-insensitive hash and rejects malformed values", () => {
  const hash = "A".repeat(64);
  assert.equal(normalizeModelSha256(hash), "a".repeat(64));
  assert.equal(normalizeModelSha256("g".repeat(64)), null);
  assert.equal(normalizeModelSha256("A".repeat(63)), null);
  assert.equal(normalizeModelSha256(undefined), null);
});

test("readImageSize reads PNG dimensions from the IHDR header", () => {
  assert.deepEqual(readImageSize(pngHeader(1920, 1080)), { width: 1920, height: 1080 });
  assert.equal(readImageSize(Buffer.from("not an image")), null);
});

// --- alpha normalization ----------------------------------------------------

test("alphaFilter snaps near-transparent pixels for a cut-out, flattens otherwise", () => {
  const cut = alphaFilter(true);
  assert.match(cut, /^format=rgba,/);
  assert.match(cut, new RegExp(`lt\\(val,${ALPHA_CLEAN_THRESHOLD}\\)`));
  assert.match(cut, /,0,val\)/); // below threshold -> 0, above untouched
  // Opacity requested -> drop the channel entirely, so "opaque" really is
  // opaque and the model's 241-254 haze cannot survive into a composite.
  assert.equal(alphaFilter(false), "format=rgb24");
});

function stubAlphaExec({ fail = false } = {}) {
  const runs = [];
  return {
    runs,
    execFn: (bin, argv) => {
      runs.push({ bin, argv });
      if (fail) {
        const err = new Error("exit 1");
        err.stderr = "alpha.png: No such file or directory";
        throw err;
      }
      return "";
    },
  };
}

test("normalizeAlpha rewrites the file in place through ffmpeg", () => {
  const { runs, execFn } = stubAlphaExec();
  const renamed = [];
  const ok = normalizeAlpha("/tmp/out.png", {
    transparent: true,
    deps: {
      execFn,
      existsFn: () => true,
      renameFn: (from, to) => renamed.push({ from, to }),
      unlinkFn: () => {},
    },
  });

  assert.equal(ok, true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].bin, "ffmpeg");
  assert.ok(runs[0].argv.includes("-vf"));
  assert.equal(runs[0].argv[runs[0].argv.indexOf("-vf") + 1], alphaFilter(true));
  // ffmpeg cannot write over its own input, so it lands beside then replaces.
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].from, "/tmp/out.png.alpha.png");
  assert.equal(renamed[0].to, "/tmp/out.png");
});

test("normalizeAlpha keeps the raw artifact when ffmpeg is unavailable", () => {
  const { execFn } = stubAlphaExec({ fail: true });
  const removed = [];
  const renamed = [];
  const ok = normalizeAlpha("/tmp/out.png", {
    transparent: true,
    deps: {
      execFn,
      existsFn: () => true,
      renameFn: (from, to) => renamed.push({ from, to }),
      unlinkFn: (p) => removed.push(p),
    },
  });

  assert.equal(ok, false, "a failed cleanup must not throw — the image already exists");
  assert.equal(renamed.length, 0, "the raw file is left untouched");
  assert.deepEqual(removed, ["/tmp/out.png.alpha.png"]);
});

test("normalizeAlpha reports false when ffmpeg exits without producing output", () => {
  const { execFn } = stubAlphaExec();
  const ok = normalizeAlpha("/tmp/out.png", {
    transparent: false,
    deps: { execFn, existsFn: () => false, renameFn: () => {}, unlinkFn: () => {} },
  });
  assert.equal(ok, false);
});

// --- graph builders ---------------------------------------------------------

test("buildT2IGraph wires the official Qwen-Image-2.1 text-to-image chain", () => {
  const g = buildT2IGraph({
    prompt: "a teapot",
    width: 1024,
    height: 768,
    steps: 30,
    seed: 7,
    transparent: false,
    w: W,
    prefix: "media_use",
  });
  assert.equal(g.unet.inputs.unet_name, "u.safetensors");
  assert.equal(g.clip.inputs.type, "qwen_image");
  assert.equal(g.text.inputs.prompt, "a teapot"); // no RGBA wrap when opaque
  assert.equal(g.text.class_type, "TextEncodeQwenImage21");
  assert.deepEqual(g.latent.inputs, { width: 1024, height: 768, batch_size: 1 });
  assert.equal(g.sampler.inputs.cfg, 1);
  assert.equal(g.sampler.inputs.seed, 7);
  assert.equal(g.sampler.inputs.latent_image[0], "latent");
  assert.equal(g.save.inputs.format, "png"); // PNG is what preserves alpha
  assert.equal(g.save.inputs["format.bit_depth"], "8-bit");
});

test("buildT2IGraph wraps the prompt when transparent", () => {
  const g = buildT2IGraph({
    prompt: "a dragon sticker",
    width: 1024,
    height: 1024,
    steps: 30,
    seed: 1,
    transparent: true,
    w: W,
    prefix: "x",
  });
  assert.match(g.text.inputs.prompt, /RGBA format image with transparency/);
});

test("buildEditGraph binds each reference to images.image_N", () => {
  const g = buildEditGraph({
    prompt: "swap the outfit",
    refs: ["a.png", "b.png", "c.png"],
    width: 1024,
    height: 1024,
    steps: 30,
    seed: 1,
    w: W,
    prefix: "x",
    followRefSize: false,
  });
  assert.equal(g.load1.inputs.image, "a.png");
  assert.equal(g.load3.inputs.image, "c.png");
  assert.deepEqual(g.text.inputs["images.image_1"], ["load1", 0]);
  assert.deepEqual(g.text.inputs["images.image_3"], ["load3", 0]);
  assert.equal(g.text.inputs["images.image_4"], undefined);
  assert.equal(g.text.inputs.vae[0], "vae"); // VAE rides on the encoder for edits
  assert.equal(g.sampler.inputs.latent_image[0], "latent");
});

test("buildEditGraph followRefSize reuses the encoder's image-derived latent", () => {
  const g = buildEditGraph({
    prompt: "x",
    refs: ["a.png"],
    width: 1024,
    height: 1024,
    steps: 30,
    seed: 1,
    w: W,
    prefix: "x",
    followRefSize: true,
  });
  assert.equal(g.latent, undefined);
  assert.deepEqual(g.sampler.inputs.latent_image, ["text", 2]);
});

// --- lifecycle --------------------------------------------------------------

test("comfyuiProbe returns stats when the server answers", async () => {
  const { fetchFn } = stubFetch();
  assert.equal((await comfyuiProbe(URL_BASE, fetchFn)).system.comfyui_version, "0.37.0");
});

test("ensureComfyui returns the URL of an already-running server", async () => {
  const { fetchFn } = stubFetch();
  assert.equal(await ensureComfyui({}, { fetchFn, sleep: noSleep }), URL_BASE);
});

test("ensureComfyui is a no-op (null) with no server and no launcher", async () => {
  const { fetchFn } = stubFetch({ up: false });
  assert.equal(await ensureComfyui({}, { fetchFn, sleep: noSleep }), null);
});

test("comfyuiLaunchCommand detaches through `start` on Windows", () => {
  // A plain child inherits the agent shell's console on Windows, so the server
  // keeps the shell's pipe open and gets reaped with the command. `start` hands
  // the launcher its own console and returns at once.
  const win = comfyuiLaunchCommand("C:\\ComfyUI\\run_nvidia_gpu.bat", "win32");
  assert.equal(win.cmd, "cmd");
  assert.deepEqual(win.argv, ["/c", "start", "", "/min", "C:\\ComfyUI\\run_nvidia_gpu.bat"]);
  assert.equal(win.shell, false);

  const posix = comfyuiLaunchCommand("/opt/comfy/launch.sh", "darwin");
  assert.equal(posix.cmd, "/opt/comfy/launch.sh");
  assert.deepEqual(posix.argv, []);
  assert.equal(posix.shell, true);
});

test("ensureComfyui launches, waits, and resolves once the server comes up", async () => {
  const spawned = [];
  let up = false;
  const fetchFn = async (url) => {
    if (url.endsWith("/system_stats")) {
      if (!up) return new Response("", { status: 503 });
      return json({ system: { comfyui_version: "0.37.0" } });
    }
    return new Response("", { status: 404 });
  };
  let ticks = 0;
  const sleep = async () => {
    ticks += 1;
    if (ticks >= 2) up = true;
  };
  const url = await ensureComfyui(
    { comfyuiLaunch: "C:\\ComfyUI\\run_nvidia_gpu.bat" },
    {
      fetchFn,
      sleep,
      platform: "win32",
      spawnFn: (cmd, argv, opts) => {
        spawned.push({ cmd, argv, opts });
        return { unref() {} };
      },
    },
  );
  assert.equal(url, URL_BASE);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, "cmd");
  assert.ok(spawned[0].argv.includes("C:\\ComfyUI\\run_nvidia_gpu.bat"));
  // cwd must be the launcher's own dir: portable launchers use relative paths.
  assert.equal(spawned[0].opts.cwd, "C:\\ComfyUI");
  assert.equal(spawned[0].opts.detached, true);
});

// --- generate ---------------------------------------------------------------

test("comfyuiImageGenerate is a miss when ComfyUI is unavailable", async () => {
  const { fetchFn } = stubFetch({ up: false });
  assert.equal(await comfyuiImageGenerate("a cat", {}, { fetchFn, sleep: noSleep }), null);
});

test("comfyuiImageGenerate queues a graph and freezes the returned PNG", async () => {
  const { fetchFn, calls } = stubFetch();
  const { files, writeFileFn } = written();
  const { runs, execFn } = stubAlphaExec();

  const res = await comfyuiImageGenerate(
    "a modern rally car",
    {
      width: 1000,
      height: 1000,
      steps: 20,
      seed: 5,
      transparent: true,
      modelSha256: "C".repeat(64),
    },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn,
      execFn,
      existsFn: () => true,
      renameFn: () => {},
      unlinkFn: () => {},
    },
  );

  assert.equal(res.ext, ".png");
  assert.equal(res.source, "generated");
  assert.equal(res.metadata.provider, "comfyui.qwen_image_2_1");
  assert.equal(res.metadata.provenance.width, 992); // 1000 snapped to 32
  assert.equal(res.metadata.provenance.transparent, true);
  assert.equal(res.metadata.provenance.model_file, "qwen_image_2.1_int8_convrot.safetensors");
  assert.equal(res.metadata.provenance.model_sha256, "c".repeat(64));
  assert.equal(res.metadata.provenance.workflow_format, "comfyui-api");
  assert.equal(res.metadata.provenance.workflow.sampler.inputs.seed, 5);
  assert.equal(files.size, 1);
  assert.ok(files.get(res.localPath).length > 0);

  // --transparent: the alpha the model wrote is thresholded, not taken as-is.
  assert.equal(runs.length, 1);
  assert.equal(runs[0].argv[runs[0].argv.indexOf("-vf") + 1], alphaFilter(true));

  const queued = JSON.parse(calls.find((c) => c.url.endsWith("/prompt")).init.body);
  assert.match(queued.prompt.text.inputs.prompt, /RGBA format image with transparency/);
  assert.equal(queued.prompt.latent.inputs.width, 992);
  assert.equal(queued.prompt.sampler.inputs.steps, 20);
});

test("comfyuiImageGenerate skips alpha work when ctx.rawAlpha is set", async () => {
  const { fetchFn } = stubFetch();
  const { execFn, runs } = stubAlphaExec();
  await comfyuiImageGenerate(
    "a modern rally car",
    { transparent: true, rawAlpha: true },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn: () => {},
      execFn,
      existsFn: () => true,
      renameFn: () => {},
    },
  );
  assert.equal(runs.length, 0, "--raw-alpha keeps the model's bytes untouched");
});

test("comfyuiImageGenerate surfaces a ComfyUI node error instead of hanging", async () => {
  const { fetchFn } = stubFetch({ nodeErrors: { 3: { message: "bad vae" } } });
  await assert.rejects(
    () => comfyuiImageGenerate("x", {}, { fetchFn, sleep: noSleep, writeFileFn: () => {} }),
    /node error/,
  );
});

test("runGraph keeps polling until the job leaves the queue", async () => {
  const { fetchFn, state } = stubFetch({ historyRounds: 3 });
  const { files, writeFileFn } = written();
  await runGraph(URL_BASE, { 1: { class_type: "X", inputs: {} } }, "/tmp/o.png", {
    fetchFn,
    sleep: noSleep,
    writeFileFn,
  });
  assert.equal(state.historyHits, 4); // 3 empty polls, then the record
  assert.equal(files.size, 1);
});

test("runGraph surfaces an execution error with the failing node", async () => {
  const { fetchFn } = stubFetch({ execError: "CUDA out of memory" });
  await assert.rejects(
    () => runGraph(URL_BASE, {}, "/tmp/o.png", { fetchFn, sleep: noSleep, writeFileFn: () => {} }),
    /CUDA out of memory/,
  );
});

// --- process (edit) ---------------------------------------------------------

test("comfyuiImageEdit misses without references (nothing to operate on)", async () => {
  const { fetchFn } = stubFetch();
  assert.equal(await comfyuiImageEdit("swap", {}, { fetchFn, sleep: noSleep }), null);
  assert.equal(await comfyuiImageEdit("swap", { images: [] }, { fetchFn, sleep: noSleep }), null);
});

test("comfyuiImageEdit uploads each reference and queues an edit graph", async () => {
  const { fetchFn, calls } = stubFetch();
  const { files, writeFileFn } = written();
  const refs = ["C:\\pics\\a.png", "C:\\pics\\b.png"];

  const res = await comfyuiImageEdit(
    "swap the outfit",
    { images: refs, modelSha256: "d".repeat(64) },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn,
      existsFn: () => true,
      readFileFn: (p) => (p === refs[0] ? pngHeader(1920, 1080) : Buffer.from("jpegish")),
      execFn: () => "",
      renameFn: () => {},
      unlinkFn: () => {},
    },
  );
  assert.equal(res.metadata.provider, "comfyui.qwen_image_2_1_edit");
  assert.equal(res.metadata.provenance.references, 2);
  assert.equal(res.metadata.provenance.model_sha256, "d".repeat(64));
  assert.equal(res.metadata.provenance.workflow_format, "comfyui-api");
  assert.ok(res.metadata.provenance.workflow.load1);
  // Output defaults to the first reference's framing (1080 -> snapped 1088).
  assert.equal(res.metadata.provenance.height, 1088);

  const uploads = calls.filter((c) => c.url.endsWith("/upload/image"));
  assert.equal(uploads.length, 2);

  const queued = JSON.parse(calls.find((c) => c.url.endsWith("/prompt")).init.body);
  assert.deepEqual(queued.prompt.text.inputs["images.image_1"], ["load1", 0]);
  assert.deepEqual(queued.prompt.text.inputs["images.image_2"], ["load2", 0]);
  assert.equal(queued.prompt.load1.inputs.image, "ref-uploaded.png");
  assert.equal(files.size, 1);
});

test("comfyuiImageEdit wraps the prompt for transparency, like generate does", async () => {
  const { fetchFn, calls } = stubFetch();
  await comfyuiImageEdit(
    "replace the background",
    { images: ["a.png"], transparent: true },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn: () => {},
      existsFn: () => true,
      readFileFn: () => pngHeader(512, 512),
      execFn: () => "",
      renameFn: () => {},
      unlinkFn: () => {},
    },
  );
  const queued = JSON.parse(calls.find((c) => c.url.endsWith("/prompt")).init.body);
  assert.match(queued.prompt.text.inputs.prompt, /RGBA format image with transparency/);
  assert.match(queued.prompt.text.inputs.prompt, /replace the background/);
});

test("comfyuiImageEdit rejects a missing reference file", async () => {
  const { fetchFn } = stubFetch();
  await assert.rejects(
    () =>
      comfyuiImageEdit(
        "x",
        { images: ["C:\\nope.png"] },
        { fetchFn, sleep: noSleep, existsFn: () => false },
      ),
    /reference image not found/,
  );
});

test("comfyuiImageEdit caps references at Qwen-Image-2.1's 10", async () => {
  const { fetchFn, calls } = stubFetch();
  const refs = Array.from({ length: 14 }, (_, i) => `r${i}.png`);
  await comfyuiImageEdit(
    "x",
    { images: refs },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn: () => {},
      existsFn: () => true,
      readFileFn: () => pngHeader(512, 512),
      execFn: () => "",
      renameFn: () => {},
      unlinkFn: () => {},
    },
  );
  const queued = JSON.parse(calls.find((c) => c.url.endsWith("/prompt")).init.body);
  assert.equal(queued.prompt.text.inputs["images.image_10"] !== undefined, true);
  assert.equal(queued.prompt.text.inputs["images.image_11"], undefined);
  assert.equal(calls.filter((c) => c.url.endsWith("/upload/image")).length, 10);
});

// --- edit VRAM budget (issues/17 §7.2) --------------------------------------

test("EDIT_PIXEL_BUDGET sits between the measured pass (~3.9MP) and fail (~4.2MP)", () => {
  // 1024² ref + 1920×1088 target = 3.14MP — the recipe's passing shape.
  assert.equal(
    planEditRefs({ refSizes: [{ width: 1024, height: 1024 }], targetPixels: 1920 * 1088 }).over,
    false,
  );
  // 1920×1088 ref + 1792×1024 target = 3.92MP — also measured passing.
  assert.equal(
    planEditRefs({ refSizes: [{ width: 1920, height: 1088 }], targetPixels: 1792 * 1024 }).over,
    false,
  );
  // 1920×1088 ref + 1920×1088 target = 4.18MP — the measured breaking shape.
  const over = planEditRefs({
    refSizes: [{ width: 1920, height: 1088 }],
    targetPixels: 1920 * 1088,
  });
  assert.equal(over.over, true);
  assert.ok(over.total > EDIT_PIXEL_BUDGET);
  assert.ok(over.scale > 0 && over.scale < 1);
  // Never upscales and always lands on the recipe's 1024² cap for a big ref.
  assert.deepEqual(scaledSize({ width: 1920, height: 1088 }, over.scale), {
    width: 1024,
    height: 580,
  });
});

test("planEditRefs is a no-op with no measurable reference, and unfixable target is flagged", () => {
  assert.equal(planEditRefs({ refSizes: [null], targetPixels: 1920 * 1088 }).over, false);
  assert.equal(planEditRefs({ refSizes: [], targetPixels: 1920 * 1088 }).over, false);
  // A target alone beyond the budget cannot be fixed by shrinking references.
  const unfixable = planEditRefs({
    refSizes: [{ width: 1024, height: 1024 }],
    targetPixels: 2048 * 2048,
  });
  assert.equal(unfixable.over, true);
  assert.equal(unfixable.scale, null);
});

test("downscaleReference writes an ffmpeg-scaled copy beside the source", () => {
  const runs = [];
  const dest = downscaleReference(
    "C:\\pics\\a.png",
    { width: 1024, height: 580 },
    { execFn: (bin, argv) => runs.push({ bin, argv }) },
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0].bin, "ffmpeg");
  assert.equal(runs[0].argv[runs[0].argv.indexOf("-vf") + 1], "scale=1024:580");
  assert.equal(runs[0].argv.at(-1), dest);
  assert.match(dest, /a\.png\.ref-1024x580\.png$/);
});

test("comfyuiImageEdit down-scales an over-budget reference instead of risking silent noise", async () => {
  const { fetchFn } = stubFetch();
  const execRuns = [];
  const res = await comfyuiImageEdit(
    "x",
    { images: ["C:\\big.png"] },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn: () => {},
      existsFn: () => true,
      readFileFn: () => pngHeader(1920, 1088),
      execFn: (bin, argv) => {
        execRuns.push({ bin, argv });
        return "";
      },
      renameFn: () => {},
      unlinkFn: () => {},
    },
  );
  // 1920×1088 ref + 1920×1088 target = 4.18MP → scaled, and the scale is recorded.
  assert.ok(res.metadata.provenance.ref_scale > 0 && res.metadata.provenance.ref_scale < 1);
  assert.deepEqual(res.metadata.provenance.ref_sizes, ["1920x1088"]);
  assert.ok(
    execRuns.some(
      (r) =>
        r.argv.includes("-vf") && String(r.argv[r.argv.indexOf("-vf") + 1]).startsWith("scale="),
    ),
  );
});

test("comfyuiImageEdit leaves a within-budget reference untouched", async () => {
  const { fetchFn } = stubFetch();
  const execRuns = [];
  const res = await comfyuiImageEdit(
    "x",
    { images: ["C:\\ok.png"], width: 1024, height: 1024 },
    {
      fetchFn,
      sleep: noSleep,
      writeFileFn: () => {},
      existsFn: () => true,
      readFileFn: () => pngHeader(1024, 1024),
      execFn: (bin, argv) => {
        execRuns.push({ bin, argv });
        return "";
      },
      renameFn: () => {},
      unlinkFn: () => {},
    },
  );
  assert.equal(res.metadata.provenance.ref_scale, undefined);
  assert.ok(
    !execRuns.some(
      (r) =>
        r.argv.includes("-vf") && String(r.argv[r.argv.indexOf("-vf") + 1]).startsWith("scale="),
    ),
  );
});
