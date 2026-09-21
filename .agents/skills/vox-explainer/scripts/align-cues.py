"""阶段④ 后置 · 词级对齐 —— 把 tools/cues.json 的锚短语对到真实音频时间。

⚠️ 依赖两个约定，新项目要对齐：
  1. SCRIPT.md 的每条旁白必须是 `## NN · 角色（voice_00N.wav）` 标题 + 紧随的 `> ` 引用行；
  2. tools/cues.json 的锚短语必须是**该条锁定稿的连续子串**（格式见 voice-sync.md §3）。
  模型选择：中文用 `--model medium`（`small` 会把 QuantScheme 听成 Quant Stream）；
  纯中文且要快可以 `small`，但要看 `align_hit` 是否掉到 60% 以下。

为什么需要它：本片的要求是「画面元素与动效跟旁白内容同步」，也就是每个元素出现的时间
必须是旁白真的念到那个词的那一刻，而不是按固定间隔铺。做法：

    锁定稿（SCRIPT.md）
      + faster-whisper 对每条 wav 的词级时间戳
      -> 字符级单调对齐（difflib.SequenceMatcher）
      -> 每个锚短语的归一化字符位置查到时间
      -> tools/cue-times.json（帧 -> 线索 -> 秒）

它同时输出逐帧 ASR 转写：那既是「合出来是语音不是杂音」的内容级自证，
也是「TTS 有没有把 v0.1.3 / PC / quant-backend 念错」的检查面。

用法：
    python tools/align-cues.py [--model small|medium|large-v3] [--json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
SCRIPT_MD = PROJECT / "SCRIPT.md"
CUES_JSON = PROJECT / "tools" / "cues.json"
OUT_JSON = PROJECT / "tools" / "cue-times.json"
VOICE_DIR = PROJECT / ".media" / "audio" / "voice"

SECTION_RE = re.compile(r"^##\s+(\d{2})\s+·\s+(.+?)（`?(voice_\d{3}\.wav)`?）\s*$")
KEEP = re.compile(r"[0-9a-z\u4e00-\u9fff]+")


def normalize(s: str) -> str:
    """小写化 + 只留中文字、拉丁字母、数字；标点/空白全丢。"""
    s = unicodedata.normalize("NFKC", s).lower()
    return "".join(KEEP.findall(s))


def parse_script() -> dict[str, dict]:
    items: dict[str, dict] = {}
    current: dict | None = None
    for raw in SCRIPT_MD.read_text(encoding="utf-8").splitlines():
        m = SECTION_RE.match(raw.rstrip())
        if m:
            current = {"nn": m.group(1), "role": m.group(2), "wav": m.group(3), "text": None}
            items[m.group(1)] = current
            continue
        if current is None or current["text"] is not None:
            continue
        line = raw.strip()
        if line.startswith(">"):
            t = line.lstrip(">").strip()
            if t:
                current["text"] = t
    return items


def transcribe(wav: Path, model_name: str):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(str(wav), language="zh", word_timestamps=True)
    words: list[tuple[str, float, float]] = []
    for seg in segments:
        for w in seg.words or []:
            words.append((w.word, float(w.start), float(w.end)))
    return words


def align(target: str, words: list[tuple[str, float, float]]):
    """字符级单调对齐：返回 (target 字符 index -> 时间) 的查询函数与命中率。"""
    asr_chars: list[str] = []
    asr_times: list[float] = []
    for text, start, _end in words:
        for ch in normalize(text):
            asr_chars.append(ch)
            asr_times.append(start)

    if not asr_chars:
        raise SystemExit("[align] ASR 没有产出任何词，检查音频")

    sm = SequenceMatcher(None, target, "".join(asr_chars), autojunk=False)
    t2a: dict[int, int] = {}
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                t2a[i1 + k] = j1 + k

    hit = len(t2a) / max(1, len(target))

    def time_at(ti: int) -> float | None:
        if ti in t2a:
            return asr_times[t2a[ti]]
        for d in range(1, 400):
            if ti - d in t2a:
                return asr_times[t2a[ti - d]]
            if ti + d in t2a:
                return asr_times[t2a[ti + d]]
        return None

    return time_at, hit


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small", help="faster-whisper 模型名（默认 small）")
    ap.add_argument("--frame", default=None, help="只重跑某一条（两位帧号）；结果并回 cue-times.json")
    ap.add_argument("--json", action="store_true", help="只输出 JSON")
    args = ap.parse_args()

    script = parse_script()
    cues = json.loads(CUES_JSON.read_text(encoding="utf-8"))

    out: dict[str, dict] = {}
    if args.frame and OUT_JSON.exists():
        out = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    report: list[str] = []
    problems: list[str] = []

    for key, spec in cues.items():
        if key.startswith("_"):
            continue
        if args.frame and not key.startswith(args.frame + "-"):
            continue
        nn = key.split("-")[0]
        entry = script.get(nn)
        if entry is None:
            raise SystemExit(f"[cues] {key} 找不到对应的 SCRIPT.md 小节")
        text = entry["text"]
        norm = normalize(text)
        wav = VOICE_DIR / entry["wav"]
        if not wav.exists():
            raise SystemExit(f"[cues] 缺音频 {wav}")

        words = transcribe(wav, args.model)
        time_at, hit = align(norm, words)
        transcript = "".join(w for w, _s, _e in words)

        frame_cues = []
        used: set[int] = set()
        for cue in spec["cues"]:
            anchor_norm = normalize(cue["anchor"])
            candidates = [cue["anchor"]] + list(cue.get("alt", []))
            idx = -1
            occ = int(cue.get("occurrence", 1))
            for cand in candidates:
                c = normalize(cand)
                if not c:
                    continue
                found = -1
                for k in range(occ):
                    found = norm.find(c, found + 1)
                    if found < 0:
                        break
                if found >= 0:
                    idx = found
                    break
            if idx < 0:
                problems.append(f"{key}/{cue['id']}: 锚短语不在锁定稿里 -> {cue['anchor']}")
                continue
            t = time_at(idx)
            if t is None:
                problems.append(f"{key}/{cue['id']}: 对不到时间")
                continue
            used.add(idx)
            frame_cues.append(
                {
                    "id": cue["id"],
                    "t": round(t, 3),
                    "anchor": cue["anchor"],
                    "element": cue.get("element", ""),
                }
            )

        out[key] = {
            "nn": nn,
            "role": entry["role"],
            "wav": entry["wav"],
            "text": text,
            "asr": transcript,
            "align_hit": round(hit, 3),
            "cues": frame_cues,
        }
        report.append(
            f"{key:22s} align {hit*100:5.1f}%  线索 {len(frame_cues):2d}/{len(spec['cues']):2d}  "
            f"末线索 t={max([c['t'] for c in frame_cues], default=0):6.3f}s"
        )

    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    print("=== 对齐报告 ===")
    for line in report:
        print("  " + line)
    print("\n=== 逐帧 ASR 转写（内容级自证：是语音、且 TTS 没念错）===")
    for key, v in out.items():
        print(f"\n{key}  ({v['align_hit']*100:.0f}% 命中)")
        print("  锁定稿: " + v["text"])
        print("  转写  : " + v["asr"])
        print("  线索  : " + "  ".join(f"{c['id']}@{c['t']:.2f}" for c in v["cues"]))

    if problems:
        print("\n=== 问题 ===")
        for p in problems:
            print("  ! " + p)
        return 1
    print(f"\n写好 {OUT_JSON.relative_to(PROJECT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
