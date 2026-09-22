"""VoxCPM TTS script for Dirt Rally 2.0 video narration."""

import os
import sys
import hashlib
import tempfile
from pathlib import Path

# 添加 OpenMontage 路径以使用 VoxCPM
sys.path.insert(0, r"E:\YifuAIForge\OpenMontage")

def generate_tts():
    """Generate TTS audio for narration."""
    try:
        from voxcpm import VoxCPM
        import scipy.io.wavfile as wavfile
        import torch
    except ImportError as e:
        print(f"Error importing dependencies: {e}")
        print("Please install: pip install voxcpm scipy torch")
        return False

    # 检查 CUDA
    if not torch.cuda.is_available():
        print("Error: CUDA GPU is required for VoxCPM TTS")
        return False

    # 加载模型
    model_id = os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2")
    print(f"Loading model: {model_id}...")
    model = VoxCPM.from_pretrained(model_id, load_denoiser=False)
    print("Model loaded.")

    # 旁白文本列表（按时间顺序）
    narration_segments = [
        # 第一部分：开场 Hook
        "还有人知道这个游戏吗？",
        "Dirt Rally 2.0，2019年发布，已经快七年了。",
        "七年，足够让一款游戏被遗忘。足够让无数新作涌现，然后消失。",
        "但奇怪的是——到现在，我没有发现任何一款游戏，能真正超越它。",
        "EA Sports WRC？画面更好，但手感差了一截。",
        "WRC系列？更像是给硬核粉丝的交代，而不是给所有人的礼物。",
        "就连科乐美自己，在那之后也没有推出过真正意义上的续作。",
        "所以，今天我想聊聊——为什么一款2019年的游戏，至今仍是拉力赛车游戏的天花板。",
        
        # 第二部分：物理与操控
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
        
        # 第三部分：音效设计
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
        
        # 第四部分：赛道设计
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
        
        # 第五部分：情感升华
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
        
        # 第六部分：结尾
        "如果你还没有玩过Dirt Rally 2.0，我强烈建议你试试。",
        "它可能不是画面最好的赛车游戏。",
        "但它一定是你玩过的最真实的拉力赛车游戏。",
        "而这种真实，至今无人能及。",
        "Dirt Rally 2.0——2019年至今，拉力赛车游戏的天花板。",
    ]

    # 输出目录
    output_dir = Path(r"E:\YifuAIForge\hyperframes\renders\dirt-rally-2-tts")
    output_dir.mkdir(parents=True, exist_ok=True)

    # 参考音频（用户自己的音色）
    reference_wav = r"E:\YifuAIForge\hyperframes\renders\dirt-rally-2-tts\voice_reference.wav"
    if not Path(reference_wav).exists():
        print(f"Error: Reference audio not found: {reference_wav}")
        return False
    
    print(f"Using voice reference: {reference_wav}")

    # 生成每个片段
    print(f"\nGenerating {len(narration_segments)} TTS segments...")
    
    for i, text in enumerate(narration_segments):
        segment_path = output_dir / f"segment_{i:03d}.wav"
        
        # 跳过已存在的片段
        if segment_path.exists() and segment_path.stat().st_size > 0:
            print(f"[{i+1}/{len(narration_segments)}] Skipping (exists): {text[:30]}...")
            continue
        
        print(f"[{i+1}/{len(narration_segments)}] Generating: {text[:30]}...")
        
        audio = model.generate(
            text=text,
            reference_wav_path=reference_wav,
            cfg_value=3.0,
            inference_timesteps=10,
        )
        
        wavfile.write(str(segment_path), 48000, audio)
        print(f"  Saved: {segment_path}")

    print(f"\nAll {len(narration_segments)} segments generated successfully!")
    print(f"Output directory: {output_dir}")
    return True


if __name__ == "__main__":
    success = generate_tts()
    sys.exit(0 if success else 1)
