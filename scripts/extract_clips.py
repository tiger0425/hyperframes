"""Extract video clips mapped to TTS narration segments."""

import json
import subprocess
import os
from pathlib import Path
from dataclasses import dataclass

@dataclass
class ClipMapping:
    segment_id: int
    source_file: str
    source_start: float
    clip_duration: float
    narration_text: str
    part: str

# TTS segment durations (from ffprobe)
SEGMENT_DURATIONS = [
    1.76, 4.64, 6.88, 5.44, 5.60, 5.44, 5.44, 7.68,  # seg 0-7: Part 1 Hook
    3.20, 5.60,  # seg 8-9: Part 1 end
    4.16, 7.04, 6.40, 4.64, 4.32, 4.00, 5.28, 4.48, 5.28, 8.80,  # seg 10-19: Part 2 Physics
    4.00, 5.12, 5.28, 6.56, 3.52, 4.64, 4.00, 3.04, 6.24, 6.24,  # seg 20-29: Part 2 cont.
    3.68, 2.40, 4.00, 7.84, 6.24, 4.48, 4.16, 6.88, 3.68, 5.76,  # seg 30-39: Part 3 Sound
    4.64, 6.40, 5.44, 5.28, 5.44, 4.64, 3.04, 3.52, 5.76, 5.44,  # seg 40-49: Part 3 end + Part 4
    4.16, 4.16, 4.32, 6.08, 5.12, 3.20, 3.36, 2.72, 5.92,  # seg 50-58: Part 5 + 6
]

# Narration texts
NARRATION = [
    "还有人知道这个游戏吗？",
    "Dirt Rally 2.0，2019年发布，已经快七年了。",
    "七年，足够让一款游戏被遗忘。足够让无数新作涌现，然后消失。",
    "但奇怪的是——到现在，我没有发现任何一款游戏，能真正超越它。",
    "EA Sports WRC？画面更好，但手感差了一截。",
    "WRC系列？更像是给硬核粉丝的交代，而不是给所有人的礼物。",
    "就连科乐美自己，在那之后也没有推出过真正意义上的续作。",
    "所以，今天我想聊聊——为什么一款2019年的游戏，至今仍是拉力赛车游戏的天花板。",
    "先说最核心的——物理。",
    "拉力赛和其他赛车游戏最大的不同是什么？不是速度，是不确定性。",
    "你永远不知道下一个弯道之后，路面会变成什么样。",
    "柏油路突然变成碎石，干燥的路面被雨水打湿，平整的赛道布满坑洼。",
    "Dirt Rally 2.0对这些细节的还原，是所有赛车游戏中最真实的。",
    "轮胎的抓地力会随着路面变化而实时改变。",
    "砂石路面上，你能感觉到轮胎在碎石上打滑。",
    "湿滑的柏油路上，刹车距离明显变长。",
    "雪地里，每一次转向都像是在和物理定律博弈。",
    "这不是什么'感觉像真的'——这就是真的物理模拟。",
    "有人说，EA Sports WRC的画面更好，光影更真实。",
    "但当你真正开起来，你会发现——EA的操控更像是在'玩一个游戏'，而DR2更像是'在开车'。",
    "这个区别，只有真正开过两款游戏的人才能体会。",
    "接下来，说一个很多人忽略的细节——音效。",
    "Dirt Rally 2.0的音效设计，是我玩过的所有赛车游戏中最出色的。",
    "引擎声浪会随着转速变化而变化，每一个档位都有独特的音色。",
    "砂石打在底盘上的声音，清晰可闻。",
    "雨天的雨刷声，轮胎在湿滑路面上的嘶嘶声。",
    "领航员的路书播报，清晰而有节奏感。",
    "音效这东西，你平时可能不会注意。",
    "但当你关掉声音玩一款赛车游戏，你会发现——它瞬间失去了灵魂。",
    "Dirt Rally 2.0的音效，让你真正'听到'你在开什么车，在什么路面上开。",
    "这是其他赛车游戏至今无法企及的细节。",
    "第三个维度——赛道设计。",
    "拉力赛的魅力之一，是它遍布全球的赛道。",
    "芬兰的森林弯道，蒙特卡洛的山间公路，日本的狭窄山路，澳大利亚的红土荒漠。",
    "Dirt Rally 2.0收录了超过140条赛道，横跨14个国家。",
    "每一条赛道都有独特的地形、气候和驾驶挑战。",
    "更重要的是，这些赛道不是简单的'换个贴图'。",
    "蒙特卡洛的冰面弯道和芬兰的高速弯道，需要完全不同的驾驶策略。",
    "雨天的蒙特卡洛，路面湿滑得像溜冰场。",
    "夜晚的威尔士，能见度几乎为零，只能靠领航员的声音导航。",
    "这种多样性和真实感，是其他赛车游戏难以复制的。",
    "说到这里，你可能会问——既然这款游戏这么好，为什么它没有成为主流？",
    "为什么现在的赛车游戏市场，被GT赛车、Forza、F1占据？",
    "我想，答案很简单。拉力赛，从来就不是一项大众运动。",
    "它不像F1那样光鲜亮丽，不像GT赛车那样优雅精致。",
    "拉力赛是粗糙的、原始的、充满不确定性的。",
    "而这，恰恰是它的魅力所在。",
    "Dirt Rally 2.0捕捉到了这种魅力。",
    "它没有试图讨好所有人。它只是专注于一件事——让你体验真正的拉力赛。",
    "每一次失控，每一次救车，每一次冲过终点线的成就感。",
    "这些瞬间，是其他赛车游戏无法给予的。",
    "七年了，我没有发现任何一款游戏能超越它。",
    "不是因为没有更好的画面，更好的音效，更好的物理。",
    "而是因为，没有一款游戏像DR2这样，如此纯粹地专注于一件事。",
    "如果你还没有玩过Dirt Rally 2.0，我强烈建议你试试。",
    "它可能不是画面最好的赛车游戏。",
    "但它一定是你玩过的最真实的拉力赛车游戏。",
    "而这种真实，至今无人能及。",
    "Dirt Rally 2.0——2019年至今，拉力赛车游戏的天花板。",
]

# Source files
SRC = r"E:\YifuAIForge\hyperframes\renders\dirt-rally-2-video\source"
SOURCES = {
    "dr2_announce": os.path.join(SRC, "dr2_announcement_trailer.mp4"),
    "dr2_launch": os.path.join(SRC, "dr2_launch_trailer.mp4"),
    "dr2_codriver": os.path.join(SRC, "dr2_codriver.mp4"),
    "dr2_argentina": os.path.join(SRC, "dr2_gameplay_argentina.mp4"),
    "ea_wrc": os.path.join(SRC, "ea_wrc_clip.mp4"),
    "dr1": os.path.join(SRC, "dirt_rally_1_trailer.mp4"),
    "wrc6": os.path.join(SRC, "wrc6_clip.mp4"),
    "wrc7": os.path.join(SRC, "wrc7_clip.mp4"),
    "wrc8": os.path.join(SRC, "wrc8_clip.mp4"),
}

# Build clip mappings: segment_id -> (source_key, source_start_sec)
# Format: (source_key, start_time_in_source_seconds)
# The clip duration = TTS segment duration + 0.5s padding (min 3s)
CLIP_MAP = {
    # Part 1: Hook (seg 0-9) - DR2 trailers, EA WRC, WRC comparison
    0:  ("dr2_launch", 0),          # "还有人知道这个游戏吗？"
    1:  ("dr2_launch", 5),          # "Dirt Rally 2.0，2019年发布"
    2:  ("dr2_launch", 15),         # "七年，足够让一款游戏被遗忘"
    3:  ("dr2_launch", 30),         # "到现在，没有发现任何一款游戏能超越它"
    4:  ("ea_wrc", 0),              # "EA Sports WRC？画面更好，但手感差了一截"
    5:  ("wrc6", 0),                # "WRC系列？更像是给硬核粉丝的交代"
    6:  ("dr1", 0),                 # "就连科乐美自己..."
    7:  ("dr2_announce", 0),        # "所以，今天我想聊聊——"
    
    # Part 2: Physics (seg 8-20) - DR2 driving, EA WRC comparison
    8:  ("dr2_announce", 50),       # "先说最核心的——物理"
    9:  ("dr2_codriver", 30),       # "拉力赛和其他赛车游戏最大的不同"
    10: ("dr2_codriver", 60),       # "你永远不知道下一个弯道之后"
    11: ("dr2_codriver", 90),       # "柏油路突然变成碎石"
    12: ("dr2_codriver", 120),      # "Dirt Rally 2.0对这些细节的还原"
    13: ("dr2_codriver", 150),      # "轮胎的抓地力会随着路面变化"
    14: ("dr2_codriver", 180),      # "砂石路面上，你能感觉到轮胎"
    15: ("dr2_codriver", 210),      # "湿滑的柏油路上，刹车距离"
    16: ("dr2_codriver", 240),      # "雪地里，每一次转向"
    17: ("dr2_codriver", 270),      # "这就是真的物理模拟"
    18: ("ea_wrc", 10),             # "EA Sports WRC的画面更好"
    19: ("dr2_codriver", 300),      # "EA的操控更像是在'玩一个游戏'"
    20: ("dr2_codriver", 330),      # "只有真正开过两款游戏的人才能体会"
    
    # Part 3: Sound (seg 21-31) - DR2 cockpit/codriver, WRC7 comparison
    21: ("dr2_launch", 40),         # "接下来，说一个很多人忽略的细节——音效"
    22: ("dr2_codriver", 160),      # "Dirt Rally 2.0的音效设计"
    23: ("dr2_codriver", 170),      # "引擎声浪会随着转速变化"
    24: ("dr2_codriver", 200),      # "砂石打在底盘上的声音"
    25: ("dr2_codriver", 220),      # "雨天的雨刷声"
    26: ("dr2_codriver", 250),      # "领航员的路书播报"
    27: ("dr2_codriver", 280),      # "音效这东西，你平时可能不会注意"
    28: ("dr2_codriver", 310),      # "当你关掉声音玩一款赛车游戏"
    29: ("dr2_codriver", 340),      # "Dirt Rally 2.0的音效"
    30: ("wrc7", 0),                # "其他赛车游戏至今无法企及"
    31: ("wrc7", 10),               # transition
    
    # Part 4: Track Design (seg 32-40) - DR2 Finland/Monte Carlo, WRC tracks
    32: ("dr2_announce", 20),       # "第三个维度——赛道设计"
    33: ("dr2_codriver", 350),      # "拉力赛的魅力之一"
    34: ("dr2_codriver", 380),      # "芬兰的森林弯道，蒙特卡洛"
    35: ("dr2_codriver", 410),      # "Dirt Rally 2.0收录了超过140条赛道"
    36: ("dr2_codriver", 430),      # "每一条赛道都有独特的地形"
    37: ("dr2_codriver", 450),      # "这些赛道不是简单的'换个贴图'"
    38: ("dr2_codriver", 460),      # "蒙特卡洛的冰面弯道"
    39: ("dr2_launch", 50),         # "雨天的蒙特卡洛"
    40: ("dr2_launch", 55),         # "夜晚的威尔士"
    
    # Part 4 end + Part 5: Emotional (seg 41-53) - DR2 dramatic moments
    41: ("dr2_announce", 35),       # "这种多样性和真实感"
    42: ("dr2_launch", 10),         # "既然这款游戏这么好"
    43: ("dr2_argentina", 60),      # "为什么现在的赛车游戏市场"
    44: ("dr2_argentina", 100),     # "拉力赛，从来就不是一项大众运动"
    45: ("dr2_argentina", 140),     # "不像F1那样光鲜亮丽"
    46: ("dr2_argentina", 180),     # "拉力赛是粗糙的、原始的"
    47: ("dr2_argentina", 200),     # "而这，恰恰是它的魅力所在"
    48: ("dr2_argentina", 220),     # "Dirt Rally 2.0捕捉到了这种魅力"
    49: ("dr2_argentina", 250),     # "它没有试图讨好所有人"
    50: ("dr2_argentina", 270),     # "每一次失控，每一次救车"
    51: ("dr2_argentina", 290),     # "这些瞬间，是其他赛车游戏无法给予的"
    52: ("dr2_argentina", 300),     # "七年了，没有发现任何一款游戏能超越它"
    53: ("dr2_announce", 40),       # "不是因为没有更好的画面"
    
    # Part 5 end + Part 6: Ending (seg 54-58) - DR2 iconic moments
    54: ("dr2_announce", 55),       # "没有一款游戏像DR2这样"
    55: ("dr2_launch", 20),         # "如果你还没有玩过"
    56: ("dr2_launch", 40),         # "它可能不是画面最好的"
    57: ("dr2_launch", 60),         # "但它一定是你玩过的最真实的"
    58: ("dr2_announce", 60),       # "Dirt Rally 2.0——天花板"
}


def get_duration(path: str) -> float:
    """Get media duration in seconds."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())


def extract_clip(seg_id: int, source_key: str, start: float, duration: float, output_dir: str):
    """Extract a clip from source footage."""
    source = SOURCES[source_key]
    output = os.path.join(output_dir, f"clip_{seg_id:03d}.mp4")
    
    # Ensure duration is at least 3 seconds for visual breathing room
    actual_duration = max(duration + 0.5, 3.0)
    
    # Check source duration
    src_dur = get_duration(source)
    if start >= src_dur:
        start = max(0, src_dur - actual_duration)
    if start + actual_duration > src_dur:
        actual_duration = src_dur - start
    
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", source,
        "-t", str(actual_duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-an",  # No audio (we'll add TTS separately)
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        "-r", "30",
        output
    ]
    
    print(f"[{seg_id:03d}] {source_key} @ {start:.1f}s for {actual_duration:.1f}s -> {os.path.basename(output)}")
    subprocess.run(cmd, capture_output=True, text=True)
    return output


def main():
    output_dir = os.path.join(SRC, "..", "clips")
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"Extracting {len(CLIP_MAP)} clips...")
    
    manifest = []
    for seg_id in sorted(CLIP_MAP.keys()):
        source_key, start = CLIP_MAP[seg_id]
        duration = SEGMENT_DURATIONS[seg_id]
        clip_path = extract_clip(seg_id, source_key, start, duration, output_dir)
        
        manifest.append({
            "segment_id": seg_id,
            "narration": NARRATION[seg_id],
            "source": source_key,
            "source_start": start,
            "tts_duration": duration,
            "clip_file": os.path.basename(clip_path),
            "part": get_part(seg_id),
        })
    
    # Save manifest
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\nManifest saved: {manifest_path}")
    
    # Calculate total duration
    total_tts = sum(SEGMENT_DURATIONS)
    print(f"Total TTS duration: {total_tts:.1f}s ({total_tts/60:.1f}min)")
    print(f"Total clips: {len(manifest)}")


def get_part(seg_id: int) -> str:
    """Get the narration part for a segment."""
    if seg_id <= 7:
        return "Part 1: Hook"
    elif seg_id <= 20:
        return "Part 2: Physics"
    elif seg_id <= 31:
        return "Part 3: Sound"
    elif seg_id <= 40:
        return "Part 4: Tracks"
    elif seg_id <= 53:
        return "Part 5: Emotional"
    else:
        return "Part 6: Ending"


if __name__ == "__main__":
    main()
