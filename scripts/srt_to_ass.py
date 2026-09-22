#!/usr/bin/env python3
"""Convert SRT to ASS format for ffmpeg."""

import re
import sys

def srt_to_ass(srt_path, ass_path):
    """Convert SRT subtitle file to ASS format."""
    with open(srt_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Parse SRT entries
    pattern = r"(\d+)\n(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\n(.+?)(?=\n\n|\n\d+\n|\Z)"
    entries = re.findall(pattern, content, re.DOTALL)
    
    # Build ASS
    ass_header = """[Script Info]
Title: Dirt Rally 2.0 Tribute
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,1,2,20,20,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    lines = []
    for idx, start, end, text in entries:
        # Convert time format: HH:MM:SS,mmm -> H:MM:SS.mm
        start_ass = start.replace(",", ".")
        end_ass = end.replace(",", ".")
        # Remove leading zeros from hours for ASS
        start_ass = start_ass.lstrip("0").lstrip(":") if start_ass.startswith("0") else start_ass
        end_ass = end_ass.lstrip("0").lstrip(":") if end_ass.startswith("0") else end_ass
        
        text_clean = text.strip().replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{start_ass},{end_ass},Default,,0,0,0,,{text_clean}")
    
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_header)
        f.write("\n".join(lines))
        f.write("\n")
    
    print(f"Converted {len(entries)} entries to ASS: {ass_path}")

if __name__ == "__main__":
    srt_path = r"E:\YifuAIForge\hyperframes\renders\dirt-rally-2-video\output\subtitles.srt"
    ass_path = r"C:\tmp\subtitles.ass"
    import os
    os.makedirs(r"C:\tmp", exist_ok=True)
    srt_to_ass(srt_path, ass_path)
