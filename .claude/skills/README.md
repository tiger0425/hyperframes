# Project-local Claude Code skills

Skills in this directory are auto-discovered by Claude Code when the
`hyperframes` repo is opened as the working directory. They are NOT part of
the marketplace-distributed plugin (that set lives under `skills/` and is
manifested by `.claude-plugin/`). Two separate namespaces, on purpose:

- `.claude/skills/` — **repo-native**, run only against this repo (weekly
  changelog videos, doctrine-heavy authoring flows). Claude Code's
  project-local skill dir.
- `skills/` — **marketplace-distributable**, installed into other projects
  via `npx hyperframes skills` or `npx skills add heygen-com/hyperframes`.

## Weekly changelog video

The `changelog-video` skill turns a weekly changelog markdown into a
~45–60s branded 1080×1080 MP4 (motion-doctrine layout, Annie VO,
seam-gated cuts, caption rail). It ships pre-configured — fonts,
background pattern, house BGM, lexicon, and the align-captions script all
live inside `changelog-video/`. Its five dependency skills
(`motion-doctrine`, `cut-the-curve`, `captions-overlay`, `seam-craft`,
`oversized-cursor`) sit alongside so the router graph is complete on
clone.

Weekly usage:

1. Regenerate the digest markdown for the target range:
   `bun run changelog:weekly --from YYYY-MM-DD --to YYYY-MM-DD` (this
   only reads git; the `--write` variant is what the docs cron uses).
2. In Claude Code at the repo root, invoke `/changelog-video` with the
   generated markdown. The agent will present its script + visualization
   plan for review before rendering.
3. Accept, and the agent produces `weekly-changelog-<range>.mp4` gated by
   `hyperframes check` (0 errors) + `seam-gate verify` (0 fail/warn).

TTS uses the tracked `skills/hyperframes-media/scripts/heygen-tts.mjs`
(no extra install needed). Runtime dependencies you need on PATH:

- Node ≥ 22
- HeyGen CLI ≥ 0.3.0, authenticated via `heygen auth login --oauth`
- `ffmpeg` (for VO wav conversion + frame QA)
- A headless Chrome for HyperFrames rendering (`hyperframes doctor` will
  point out the exact ask if it's missing)

The parallel set at `.agents/skills/` is a byte-identical copy so Codex
CLI users get the same auto-discover behaviour — keep the two in sync
when editing. A `scripts/check-skill-mirror.mjs` check enforces this at
CI time.

## VOX explainer video

The `vox-explainer` skill authors a VOX-style Chinese explainer/teaching
video end to end: brief → storyboard → locked narration → TTS → frames
built from real material → gates → render. It carries a narrative arc,
the paper-and-ink visual grammar (paper ground, near-black body, one
signal blue, red pen annotations), the real-material + hand-drawn-
annotation method, and the word-level voice timing loop (every element
appears on the word that names it) — plus the five
gates as runnable scripts (`audit-frames`, `sync-frame-durations`,
`verify-timeline`, `verify-film-audio`, and the `hf.mjs` wrapper for
lint/check/snapshot), and a scaffolder that starts a project and copies
those scripts into it.

It is distilled from two shipped Chinese explainers.
**The frame count is a parameter, not a rule** — the arc and the
per-frame discipline are what carry over; the number of frames comes
from how the content segments. The skill directory contains a
`references/` set (contract, pitfalls, pipeline stages, narrative arc,
visual grammar, material sourcing, verification) and `templates/`.

Two things it is deliberately honest about, both learned the hard way:
`check` can report ok without having run its runtime stage (so the
wrapper refuses to claim a pass without the `samples.Count` /
`contrast.checked` counters), and in a sandbox that forbids named pipes
`check` cannot start a headless browser at all — that is an environment
boundary, not a composition bug.

Each repo-native skill declares `metadata.internal: true`, so `npx skills add`
skips it during normal installs (including `--all`). This does not change local
agent discovery. To explicitly install these skills elsewhere, set
`INSTALL_INTERNAL_SKILLS=1` when running the installer.
