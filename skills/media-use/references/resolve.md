# Resolve — command, flags, reuse, adopt, inventory

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type <type> --intent "<description>" --project <dir>
```

Returns one line: `resolved <id> → <path> (<type>, <metadata>)`

## Types

| Type    | What it finds                    | Provider / cascade                                           |
| ------- | -------------------------------- | ------------------------------------------------------------ |
| `bgm`   | Background music                 | HeyGen audio catalog (10k+ tracks)                           |
| `sfx`   | Sound effects                    | Bundled 19-file library + HeyGen catalog                     |
| `image` | Photos, backgrounds              | HeyGen asset search (75k+ vectors)                           |
| `icon`  | Icons, symbols                   | HeyGen asset search (type=icon)                              |
| `logo`  | Official brand marks             | svgl → simple-icons → GitHub org avatar → domain favicon     |
| `voice` | TTS voiceover                    | HeyGen TTS free-usage path; optional local Kokoro            |
| `grade` | HyperFrames color-grading blocks | Core preset → look index params/CDN LUT → deterministic cube |
| `lut`   | Reusable `.cube` LUT files       | Look index params/CDN LUT → deterministic cube               |

## Examples

```bash
# Background music
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "upbeat tech launch" --project .
# → resolved bgm_001 → .media/audio/bgm/bgm_001.mp3 (bgm, 25s)

# Sound effect
node <SKILL_DIR>/scripts/resolve.mjs --type sfx --intent "whoosh" --project .
# → resolved sfx_001 → .media/audio/sfx/sfx_001.mp3 (sfx, 0.57s)

# Image
node <SKILL_DIR>/scripts/resolve.mjs --type image --intent "gradient tech background" --project .
# → resolved image_001 → .media/images/image_001.jpg (image)

# Icon
node <SKILL_DIR>/scripts/resolve.mjs --type icon --intent "rocket" --project .
# → resolved icon_001 → .media/images/icon_001.png (icon, transparent)

# Brand logo (official mark — never redrawn by hand)
node <SKILL_DIR>/scripts/resolve.mjs --type logo --entity linkedin --intent "LinkedIn logo" --project .
# → resolved logo_001 → .media/images/logo_001.svg (logo, official mark)

# Color grade block
node <SKILL_DIR>/scripts/resolve.mjs --type grade --intent "warm daylight" --project . --json
# → {"ok":true,"preset":"warm-daylight","grading":{"preset":"warm-daylight","intensity":1},...}

# LUT file
node <SKILL_DIR>/scripts/resolve.mjs --type lut --intent "teal orange blockbuster" --project .
# → resolved lut_001 → .media/luts/lut_001.cube (lut)
```

## Flags

| Flag            | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `--type, -t`    | Media type: bgm, sfx, image, icon, logo, voice, grade, lut                           |
| `--intent, -i`  | What you need (natural language)                                                     |
| `--entity, -e`  | Entity name for cache matching (optional)                                            |
| `--project, -p` | Project directory (default: .)                                                       |
| `--candidates`  | List reusable assets (project + global cache) for `--type`; no download, no mutation |
| `--reuse <sha>` | Import a specific global-cache asset (by content sha/prefix, from `--candidates`)    |
| `--from`        | Freeze a local file or direct public URL (ingest)                                    |
| `--for`         | Analyze a local image/video and add measured adjust suggestions (`grade` only)       |
| `--local-only`  | Offline: skip every network provider (cache + local only)                            |
| `--provider`    | Force one generator (e.g. `codex`, `mflux`, `comfyui`, `kokoro`, `heygen`)           |
| `--process`     | Operate on existing media instead of finding/generating one (see below)              |
| `--image <path>`| Reference image for `--process`; repeat for multiple (up to 10)                      |
| `--transparent` | Ask an image generator for a native alpha channel (RGBA PNG)                         |
| `--raw-alpha`   | Keep the generator's alpha byte-for-byte instead of normalizing it                   |
| `--followRefSize` | Reuse the first `--image` reference's framing/latent instead of a blank latent (`--process` edits; `comfyui` only; also `--follow-ref-size`) |
| `--width/--height` | Generation size in px (snapped to a multiple of 32)                              |
| `--steps`       | Sampling steps (`comfyui`: default 30; the official pipeline uses 40-50)             |
| `--seed`        | Pin the seed for a reproducible generation                                           |
| `--model-sha256` | Optional 64-character model file SHA-256 recorded with ComfyUI provenance           |
| `--adopt`       | Bulk-import existing assets/ into manifest                                           |
| `--doctor`      | Check local CLI dependencies; no manifest changes                                    |
| `--stats`       | Print local usage stats from `.media/` and `~/.media`; no manifest changes           |
| `--days N`      | Limit `--stats` to timestamped records/misses from the last N days                   |
| `--json`        | Output JSON instead of one-line result                                               |

## Generate, and operate on media (`--process`)

`image` cascades search → generate: the HeyGen catalog first, then (on a miss) a
local image generator, then the `codex` upsell. Generation flags:

```bash
# 1024² with a native alpha channel, on the local ComfyUI / Qwen-Image-2.1 path
node <SKILL_DIR>/scripts/resolve.mjs --type image --provider comfyui \
  --transparent --width 1024 --height 1024 --intent "a rally car on its own"
# → resolved image_003 → .media/images/image_003.png (image, generated)

# Pin the local model file hash and capture the exact API graph in provenance
node <SKILL_DIR>/scripts/resolve.mjs --type image --provider comfyui \
  --model-sha256 <64-hex-sha256> --seed 20260923 --intent "a paper collage rally car"
```

`--process` flips the verb from *find* to *operate on*: instead of resolving a
new asset, it hands the `--image` references to a provider's **process**
capability. ComfyUI is the provider that implements it (Qwen-Image-2.1 image
editing, 1–10 references — the references are referenced from the prompt as
`<image1>`, `<image2>`, …):

```bash
# single reference: replace the background, relight to match
node <SKILL_DIR>/scripts/resolve.mjs --type image --process --provider comfyui \
  --image .media/images/car.png \
  --intent "replace the background with a rainy night street, wet asphalt, relight the car"

# multi-reference: bring a property from one image onto another
node <SKILL_DIR>/scripts/resolve.mjs --type image --process --provider comfyui \
  --image .media/images/car.png --image .media/images/livery.png \
  --intent "repaint the car from <image1> with the livery of <image2>, keep everything else"
```

Output defaults to a multiple-of-32 box; when `--width/--height` are omitted it
takes the first reference's framing. `--transparent` keeps the alpha channel
across the edit. The result is registered exactly like a generated asset —
same ledger, same provenance (including the reference count), same global-cache
promotion — so an edited image is reusable across projects like any other.

`--followRefSize` tells the graph to reuse the encoder's image-derived latent
instead of a fresh blank one, so the edit inherits the reference's framing — the
same behaviour the automatic default above already aims for, but at the graph
level rather than by copying width/height.

ComfyUI results also carry the reproducibility inputs in `provenance`: the
selected `model_file`, the optional normalized `model_sha256` passed by
`--model-sha256`, the pinned `seed`, and the exact API graph under
`provenance.workflow` (`workflow_format: "comfyui-api"`). The vox bridge writes
that graph to `.media/gen/<role>-<nn>.workflow.json` and records the relative
path in its M5 ledger row.

### Size gate: references + target share one budget

The edit path holds every reference **and** the target latent in VRAM at once. On
a 24GB card, `target + references` measured **~3.9MP passes** and **~4.2MP
breaks** — and a breaking edit does **not** error: it returns high-frequency
noise at a normal speed. To keep that from happening silently, the provider
plans a **reference down-scale** before uploading when the combined pixels cross
`EDIT_PIXEL_BUDGET` (4MP), caps references at 1024², and prints what it did to
stderr (and records `ref_scale` / `ref_sizes` in provenance). If the **target
alone** is already at the budget, no reference down-scale can save it, so it
warns instead. Either way the passing recipe stands: **keep references ≤1024²**,
and for a full-frame result either raise nothing and let the gate shrink the
reference, or generate text-to-image (no reference → no combined budget).

### Alpha is normalized, not taken raw

Qwen-Image-2.1's alpha channel is not binary in either direction, so the raw
output composites badly:

- a requested cut-out leaves the "empty" background at **alpha 1-15**, which
  reads as a faint grey wash once composited on anything dark;
- an image that is *not* a cut-out still ships an alpha channel sitting at
  **241-254** across most of the frame — "opaque" is not quite opaque, so the
  result is very slightly translucent.

So the provider fixes it up to match how you asked, using ffmpeg (already a hard
dependency of this skill):

| Request             | What happens to the alpha                                                     |
| ------------------- | ----------------------------------------------------------------------------- |
| `--transparent`     | pixels below 16 are snapped to 0; anti-aliased edges (16+) are left untouched |
| neither flag        | the alpha channel is dropped — the PNG is genuinely, fully opaque             |
| `--raw-alpha`       | nothing; the model's bytes are kept verbatim                                  |

This is why a cut-out is expected to be **requested** with `--transparent`, even
when the source image was already transparent: ask for transparency and you get a
clean cut-out; don't, and you get a flat image. If normalization cannot run (no
ffmpeg, or it errors), the resolve still succeeds — the raw file is kept and the
reason goes to stderr.

Prompt adherence is the model's business, not the tool's: "keep X unchanged"
instructions are honoured loosely. For a strict single-property change (swap the
background), one reference is the reliable shape; multi-reference edits read
more like *compose a new image from these references* than *inpaint reference 1*.

## Reuse before you resolve

Before resolving bgm/sfx/image/icon/logo/grade/lut, **check what already exists and reuse it when it fits.** media-use does not semantically match for you — you are the judge. It surfaces candidates; you decide.

```bash
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "upbeat tech launch" --candidates --project .
#   [project] upbeat tech launch (25s, heygen.audio.sounds)
#           .media/audio/bgm/bgm_001.wav
#   [global]  energetic tech intro (22s, heygen.audio.sounds)
#           --reuse 06e052c075fd2b80
```

Read the list and judge semantic fit yourself — "upbeat tech launch" ≈ "energetic tech intro" is a call only you can make from the descriptions. Then:

- **A project candidate fits** → just reference its path in your composition. Nothing else to run.
- **A global candidate fits** → `resolve --type bgm --reuse <sha>` copies it into this project (self-contained render) and records it.
- **Nothing fits** → resolve fresh (`--type ... --intent ...`).

**Trust guardrail — when unsure, resolve fresh.** A redundant download is cheap; shipping the wrong asset is not. Judge fit from description + prompt + type + duration/dims. For **brand/entity** assets, reuse a _global_ candidate only when the entity matches exactly — the global cache aggregates every project you have worked on, so a `--candidates` list can surface another client's brand mark and its prompt text. Never reuse a cross-project brand asset on a loose match.

The deterministic floor still runs automatically: an identical (case/whitespace-insensitive) repeat auto-reuses with no `--candidates` step. `--candidates` is only for the semantic layer above that floor — and a fuzzy match is **never** auto-applied; reuse is always your explicit call. On a resolve that misses the floor and is about to fetch, media-use prints a one-line stderr hint when similar cached assets exist, pointing you back here.

## How it works

`resolve` runs an automatic floor, then falls through to fetching:

1. Check project `.media/manifest.jsonl` for a prompt match (case- and whitespace-insensitive) — auto-reuse
2. Scan existing `assets/` directory for unregistered files that share a word with the need
3. Check global cache `~/.media/` for a reusable asset matched on the same normalized prompt — auto-reuse
4. Search via provider (HeyGen audio catalog, HeyGen asset search), or resolve color locally
5. Freeze file to `.media/<type>/`, register in manifest, regenerate `index.md`, auto-promote to `~/.media/`

Steps 1 and 3 are the **deterministic floor**: they only auto-reuse an exact-normalized match, never a fuzzy one. Semantic reuse ("close enough") is the agent's explicit call via [Reuse before you resolve](#reuse-before-you-resolve) — it never happens automatically. The agent gets back **one line**; candidates, scores, provenance stay on disk.

## Stamping provenance when mounting a resolved video

`resolve` never writes composition HTML itself — mounting a `<video>` element
into a composition is always the agent's own edit. When the mounted video's
manifest record has `provenance.provider === "heygen.video"` (check
`.media/manifest.jsonl` or the one-line resolve output for the provider name),
add `data-media-source="heygen"` to that `<video>` tag. Leave the attribute off
entirely for every other provider (`ltx.local`, an adopted/local file, etc.) —
this is not a general provider taxonomy, just the one signal render telemetry
tracks today.

## Adopt existing projects

Most HyperFrames projects already have assets in `assets/`. media-use adopts them:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --adopt --project .
# → adopted 9 assets from assets/
#   bgm_001 → assets/bgm/mango-fizz.mp3 (bgm, 146.6s)
#   image_001 → assets/images/avatar.jpg (image, 400×400)
```

`ffprobe` extracts real duration and dimensions. During resolve, unregistered files in `assets/` matching the intent are adopted on the fly.

## Reading the inventory

After resolve or adopt, read `.media/index.md` for the full inventory:

```
# .media · 4 assets

id         type   dur   dims       path                          description
bgm_001    bgm    25s   -          .media/audio/bgm/bgm_001.mp3  upbeat tech launch
sfx_001    sfx    0.6s  -          .media/audio/sfx/sfx_001.mp3  whoosh
image_001  image  -     1920×1080  .media/images/image_001.jpg   gradient tech background
icon_001   icon   -     200×200    .media/images/icon_001.png    rocket
```

## Cross-project reuse

Assets are cached automatically on resolve. Every resolved/ingested asset is auto-promoted to the global cache at `~/.media/`, so subsequent resolves for the same (or near-identical) prompt, in any project, hit the cache with no re-download and no provider call.

For a _semantically_ similar (not identical) need in another project, the exact-match floor won't fire — use [Reuse before you resolve](#reuse-before-you-resolve): `--candidates` lists the global assets, and `--reuse <sha>` imports the one you pick. This is how a track resolved in one project gets reused in the next when the wording differs.
