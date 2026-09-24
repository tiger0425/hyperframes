# Setup and providers — install, auth, RAM ladders, forcing a provider

## Setup — install heygen first (free-usage path)

Install the HeyGen CLI through its [verified release instructions](https://developers.heygen.com/cli), then run:

```bash
heygen update             # free usage needs the OAuth-capable CLI (v0.3.0+)
heygen auth login --oauth # OAuth = free subscription credits; --api-key bills API credits
```

This unlocks the FREE path for bgm/sfx/image/icon catalog search, TTS (voice), and avatar videos. Sign in with `--oauth` — the free allowance rides on the OAuth session (an API key bills API credits instead). **media-use requires heygen >= v0.3.0 uniformly** (the OAuth free-usage path needs it), so `--doctor` nudges older CLIs to update even for API-key-only use. Before resolving anything, verify setup with:

```bash
node <SKILL_DIR>/scripts/resolve.mjs --doctor
```

## Providers

media-use holds no keys; every external tool owns its auth. Generation is
centered on the HeyGen CLI free-usage path. Install and authenticate `heygen`
before resolving bgm/sfx/image/icon/voice/avatar-video. Local tools are opt-in
alternatives where they exist: mflux for image, Kokoro for voice, Parakeet for
transcription, and LTX for local video generation. `resolve` spec-checks
AVAILABLE RAM for those local ladders (`describeModelLadder`); the agent can
see the ladder and override.

| Type      | Provider / path                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bgm/sfx   | heygen catalog free-usage path                                                                                                                                                |
| image     | heygen search free-usage path; optional local **ComfyUI** (Qwen-Image-2.1 — generate *and* edit) or mflux; codex `image_gen` upsell                                                                                                 |
| voice     | heygen tts free-usage path; optional local **Kokoro** (free, on-device)                                                                                                       |
| icon      | heygen asset search free-usage path                                                                                                                                           |
| logo      | svgl, then simple-icons, then GitHub org avatar, then domain favicon (all free)                                                                                               |
| grade/lut | local core-preset map, params/CDN look index, deterministic `buildCube` fallback                                                                                              |
| video     | heygen avatar video free-usage path (sign-in nudge on auth failure); optional local LTX (`videogen` ladder). Image-to-video / photo-avatar / dub stay manual `heygen` recipes |

Local Kokoro (voice), ComfyUI and mflux (image), and LTX (video) run on-device
(free, private, offline once cached). The `codex` CLI remains the ChatGPT-sub
image upsell. Cost rule (X4): the agent confirms before an agent-initiated paid
call; a user-requested one just runs — `heygen.video` is flagged paid (metered
free allowance) so an agent-initiated `resolve --type video` confirms first.

To force a specific generator (e.g. a user says "make this image with codex"),
pass `--provider codex`: it pins resolution to that provider and skips the
free-usage default. See `references/operations.md` for the RAM ladders and
provider recipes.

`--local-only` skips every network provider, including the free HeyGen ones,
leaving the project + global cache and any installed local provider. For
HeyGen-only types, that means no fresh resolve.

## CLI tools used (what to run, and how to enable each)

`resolve` auto-cascades; each provider shells one CLI. HeyGen is the
free-usage path for bgm/sfx/image/icon catalog search, TTS (voice), and avatar
video, so those capabilities need `heygen` installed and authenticated. Local
tools are OPT-IN alternatives where they exist; install one to unlock its free,
private, on-device path instead of or ahead of HeyGen for that type. Only
`ffmpeg`/`ffprobe` are strictly required for the tool to run at all.

| Tool               | Serves                                                                          | Install                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg`/`ffprobe` | adopt probing, smart-grade signalstats, cut, duck bake, loudnorm                | system package (`brew install ffmpeg`)                                                                                                        |
| `heygen`           | catalog (bgm/sfx/image/icon) + TTS (voice) + avatar video — the free-usage path | install through [verified HeyGen release instructions](https://developers.heygen.com/cli), then `heygen auth login --oauth` (needs >= v0.3.0) |
| `mflux-generate`   | local image gen (FLUX), best-for-RAM                                            | `uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux==0.9.6`                                                            |
| ComfyUI            | local image gen **and edit** (Qwen-Image-2.1) — the `process` capability       | any ComfyUI build (portable or desktop) with the Qwen-Image-2.1 weights; then set `COMFYUI_URL` and/or `COMFYUI_LAUNCH` (see below)           |
| `codex`            | image gen upsell (ChatGPT sub)                                                  | Codex CLI, logged in via ChatGPT (owns its own auth)                                                                                          |
| `parakeet-mlx`     | local transcription (default ASR, best)                                         | `uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`                                                      |
| `ltx-2-mlx`        | local video gen                                                                 | `git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras`                                                      |
| `npx hyperframes`  | Kokoro TTS (voice), whisper.cpp (transcribe fallback), remove-background        | via the hyperframes CLI; whisper.cpp is built on first use (Homebrew on macOS, else git+cmake), models download from HuggingFace              |

The RAM-graded local-model shortlist + exact per-tier install/invoke lives in
`scripts/lib/local-models.mjs` (the agent can read `describeModelLadder(cap, specs)`
to see which model fits this machine). Without a tool on PATH, its provider
prints a one-line diagnostic to stderr and resolve falls through where another
provider exists (e.g. no `mflux` -> codex image upsell; no `parakeet-mlx` -> whisper.cpp).

`heygen asset search` is a pre-launch command hidden from `heygen --help`, but it
runs; providers tag requests with the allowlisted `X-HeyGen-Client-Source` header
(v0.3.0+).

## Local ComfyUI (image generation and editing)

The one local provider media-use talks to over HTTP rather than shelling out.
It drives the Qwen-Image-2.1 workflow pair, so it covers what no other provider
does: **native alpha (RGBA) output** for `generate`, and **multi-reference image
editing** for `--process`.

Setup is deliberately two environment variables, so the provider is a silent
no-op for anyone who hasn't opted in:

| Variable          | Meaning                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `COMFYUI_URL`     | Base URL of a running server (default `http://127.0.0.1:8188`)               |
| `COMFYUI_LAUNCH`  | Launcher to start on demand, e.g. `E:\ComfyUI\run_nvidia_gpu.bat`            |
| `COMFYUI_UNET` / `COMFYUI_CLIP` / `COMFYUI_VAE` | Override the Qwen-Image-2.1 weights (defaults are the `Comfy-Org/Qwen-Image-2.1` `int8_convrot` + `vae_bf16` files) |

Resolution order: an already-running server on `COMFYUI_URL` (or the default
port) is used as-is; otherwise `COMFYUI_LAUNCH` is started detached **from its
own directory** — portable builds resolve `./python_embeded` relative to the
launcher — and polled until it answers (tunable with `COMFYUI_READY_TIMEOUT_MS`,
default 240s). If neither works, the provider returns a clean miss, so the
cascade falls through to mflux / codex exactly as before.

Weights go where ComfyUI expects them:

```
ComfyUI/models/diffusion_models/qwen_image_2.1_int8_convrot.safetensors
ComfyUI/models/text_encoders/qwen3vl_8b_int8_convrot.safetensors
ComfyUI/models/vae/qwen_image_2.1_vae_bf16.safetensors
```

Qwen-Image-2.1 needs a recent ComfyUI (native support landed with the model);
verify with `resolve --type image --provider comfyui --intent "test"`. VRAM
notes: the `int8_convrot` pair is ~16GB of weights — comfortable on a 24GB card
at 1024², tight at the native 2048² (start lower and raise). **Edits are tighter
than generation**: `--process` loads the references *and* the target together,
and an over-budget edit returns noise rather than an error — so the provider
auto-down-scales over-budget references (see `references/resolve.md`, "Size
gate"). Job and ready timeouts are `COMFYUI_JOB_TIMEOUT_MS` /
`COMFYUI_READY_TIMEOUT_MS`.

Both capabilities normalize the alpha channel on the way out through `ffmpeg`
(already required by this skill) — see `references/resolve.md` for what that
means for `--transparent` vs. a flat image, and `--raw-alpha` to opt out.

For reproducible records, pass the locally measured hash of the selected model
file as `--model-sha256 <64-hex-sha256>`. `resolve` normalizes it to lowercase
and records it beside `model_file` and `seed`; the exact API graph is also
returned as `provenance.workflow` for the caller to freeze as a workflow
snapshot.

Editing a real workflow instead? Any graph can be exported from ComfyUI as API
JSON and posted to `POST /prompt` the same way this provider does; the two
graphs here are the project's standardised pair, not the only possibility.
