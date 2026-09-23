"""阶段④ · 旁白合成 —— IndexTTS 2.5 零样本克隆（上一项目用的是"本机实拍者的声音"）。

⚠️ 本文件从 `freetoken-v013-vox` 提升而来，含**本机专属路径与引擎选择**，新项目必须先改这三处：
  1. OPENMONTAGE / VOICE_REF —— 换成你的桥与声纹参考（参考格式见下方注释）；
  2. 换别的 TTS 引擎（edge-tts / HeyGen / ElevenLabs / Kokoro）时，
     保留本文件的**骨架**（解析 SCRIPT.md → 逐条合成 → **读 wav 头量真实秒数** → 写清单），
     只换中间的合成调用。**"读 wav 头、不信记录"这一条不能省**（`_contract.md` §2 时间闭环）。
  3. `--frame NN` 单条重跑必须把结果**并回**清单（本文件已实现），否则合计秒数会缩成一条。

单一事实来源是 SCRIPT.md：逐字锁定稿写在每个 `## NN · …` 小节的 `> ` 引用行里。
本脚本只做四件事：解析锁定稿 → 一条一条合成 → 量真实秒数 → 写清单。
**不在这里改文案**：文案要改就回阶段③，改完重跑本脚本。

用法：
    python tools/synthesize_voice.py            # 全量合成 12 条
    python tools/synthesize_voice.py --frame 03 # 只重跑某一条（NN）
    python tools/synthesize_voice.py --list     # 只列出解析到的文案与字数，不合成

约定（见 CALLING.md，违反会得到杂音 / 女声化 / 中文乱码）：
  统一入口 OpenMontage/apps/indextts-bridge/client.py → IndexTTSSession
  model_version="2.5" + lang="ZH" + emotion="calm"（不传 emo_vector，走官方纯净克隆）
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import time
import wave
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
SCRIPT_MD = PROJECT / "SCRIPT.md"
VOICE_DIR = PROJECT / ".media" / "audio" / "voice"
MANIFEST = PROJECT / ".media" / "voice-manifest.json"

OPENMONTAGE = Path(r"E:\YifuAIForge\OpenMontage")
VOICE_REF = Path(r"D:/index-tts/my_voice.wav")
SEED = 42

SECTION_RE = re.compile(r"^##\s+(\d{2})\s+·\s+(.+?)（`?(voice_\d{3}\.wav)`?）\s*$")


def load_client():
    sys.path.insert(0, str(OPENMONTAGE))
    spec = importlib.util.spec_from_file_location(
        "indextts_client", str(OPENMONTAGE / "apps" / "indextts-bridge" / "client.py")
    )
    if spec is None or spec.loader is None:
        raise SystemExit("[env] 找不到 IndexTTS 统一客户端，检查 OpenMontage 路径")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def parse_script() -> list[dict]:
    """从 SCRIPT.md 拆出 [(nn, role, wavname, text)]。"""
    items: list[dict] = []
    current: dict | None = None
    for raw in SCRIPT_MD.read_text(encoding="utf-8").splitlines():
        m = SECTION_RE.match(raw.rstrip())
        if m:
            current = {"nn": m.group(1), "role": m.group(2), "wav": m.group(3), "text": None}
            items.append(current)
            continue
        if current is None or current["text"] is not None:
            continue
        line = raw.strip()
        if line.startswith(">"):
            text = line.lstrip(">").strip()
            if text:
                current["text"] = text
    missing = [i["nn"] for i in items if not i["text"]]
    if missing:
        raise SystemExit(f"[parse] 这些小节没解析到 `> ` 锁定稿: {missing}")
    if len(items) != 12:
        raise SystemExit(f"[parse] 期望 12 条旁白，实际解析到 {len(items)} 条")
    return items


def wav_seconds(path: Path) -> float:
    """读 wav 头算秒数（不信任何记录）。"""
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def wav_format(path: Path) -> dict:
    with wave.open(str(path), "rb") as w:
        return {
            "rate": w.getframerate(),
            "channels": w.getnchannels(),
            "sampwidth": w.getsampwidth(),
            "frames": w.getnframes(),
        }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", default=None, help="只重跑某一条（两位帧号，如 03）")
    ap.add_argument("--list", action="store_true", help="只列出解析结果，不合成")
    args = ap.parse_args()

    items = parse_script()
    if args.frame:
        items = [i for i in items if i["nn"] == args.frame]
        if not items:
            raise SystemExit(f"[usage] 没有帧号 {args.frame}")

    if args.list:
        for i in parse_script():
            print(f"{i['nn']}  {len(i['text']):4d} 字  {i['role']}  -> {i['wav']}")
            print(f"      {i['text'][:60]}…")
        return 0

    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    mod = load_client()

    t_all = time.time()
    results: list[dict] = []
    with mod.IndexTTSSession(
        voice_ref=str(VOICE_REF),
        model_version="2.5",
        lang="ZH",
        emotion="calm",
        project_dir=str(PROJECT),
    ) as tts:
        for i in items:
            out = VOICE_DIR / i["wav"]
            t0 = time.time()
            ok = tts.synthesize(i["text"], out, seed=SEED)
            if not ok:
                raise SystemExit(f"[tts] {i['nn']} 合成失败（见 indextts_server.log）")
            secs = wav_seconds(out)
            fmt = wav_format(out)
            results.append(
                {
                    "frame": i["nn"],
                    "role": i["role"],
                    "wav": str(out.relative_to(PROJECT)).replace("\\", "/"),
                    "chars": len(i["text"]),
                    "seconds": round(secs, 3),
                    "rate": fmt["rate"],
                    "channels": fmt["channels"],
                    "sampwidth": fmt["sampwidth"],
                    "seed": SEED,
                    "wall_s": round(time.time() - t0, 1),
                }
            )
            print(f"  ok  {i['wav']}  {secs:7.3f}s  ({len(i['text'])} 字, {time.time()-t0:.1f}s wall)")

    total = sum(r["seconds"] for r in results)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    # 单帧重跑时把结果并回已有清单（并重算总量），避免把清单缩小成一条。
    lines = results
    if args.frame and MANIFEST.exists():
        prev = json.loads(MANIFEST.read_text(encoding="utf-8"))
        by_frame = {r["frame"]: r for r in prev.get("lines", [])}
        for r in results:
            by_frame[r["frame"]] = r
        lines = [by_frame[k] for k in sorted(by_frame)]
        total = sum(r["seconds"] for r in lines)

    MANIFEST.write_text(
        json.dumps(
            {
                "engine": "IndexTTS 2.5",
                "bridge": "OpenMontage/apps/indextts-bridge/indextts_server.py",
                "voice_ref": str(VOICE_REF),
                "emotion": "calm (no emo_vector)",
                "seed": SEED,
                "lines": lines,
                "total_seconds": round(total, 3),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n合计 {total:.3f}s / {len(lines)} 条；清单已写 {MANIFEST.relative_to(PROJECT)}"
          f"（总耗时 {time.time()-t_all:.0f}s）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
