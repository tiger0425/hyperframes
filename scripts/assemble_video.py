#!/usr/bin/env python3
"""Simplified assembly: concat clips + TTS audio + SRT subtitles."""

import subprocess
import os
import json
import shutil

PROJECT = r"E:\YifuAIForge\hyperframes\renders\dirt-rally-2-video"
OUTPUT_DIR = os.path.join(PROJECT, "output")
TTS_DIR = os.path.join(PROJECT, "..", "dirt-rally-2-tts")
CLIPS_DIR = os.path.join(PROJECT, "clips")

def load_manifest():
    with open(os.path.join(CLIPS_DIR, "manifest.json"), "r", encoding="utf-8") as f:
        return json.load(f)

def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True
    )
    return float(r.stdout.strip()) if r.stdout.strip() else 0

def main():
    manifest = load_manifest()
    print(f"Loaded manifest: {len(manifest)} segments")

    # Step 1: Build concat list
    print("\n=== Step 1: Build concat list ===")
    concat_lines = []
    for entry in manifest:
        clip_path = os.path.join(CLIPS_DIR, entry["clip_file"])
        if os.path.exists(clip_path):
            concat_lines.append(f"file '{clip_path}'")
    with open(os.path.join(OUTPUT_DIR, "concat_list.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(concat_lines))
    print(f"Concat list: {len(concat_lines)} entries")

    # Step 2: Concat video
    print("\n=== Step 2: Concat video ===")
    concat_video = os.path.join(OUTPUT_DIR, "concat_video.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", os.path.join(OUTPUT_DIR, "concat_list.txt"),
        "-c", "copy", concat_video
    ], check=True, capture_output=True, text=True)
    video_duration = get_duration(concat_video)
    print(f"Video: {video_duration:.1f}s")

    # Step 3: Mix TTS audio
    print("\n=== Step 3: Mix TTS audio ===")
    tts_track = os.path.join(OUTPUT_DIR, "tts_track.wav")
    srt_lines = []
    t = 0.0

    for entry in manifest:
        tts_path = os.path.join(TTS_DIR, f"segment_{entry['segment_id']:03d}.wav")
        if os.path.exists(tts_path):
            srt_lines.append(f"{entry['segment_id']+1}")
            start_h, start_m = int(t//3600), int((t%3600)//60)
            start_s = t % 60
            end_t = t + entry['tts_duration']
            end_h, end_m = int(end_t//3600), int((end_t%3600)//60)
            end_s = end_t % 60
            start_str = f"{int(start_h):02d}:{int(start_m):02d}:{start_s:06.3f}".replace(".", ",")
            end_str = f"{int(end_h):02d}:{int(end_m):02d}:{end_s:06.3f}".replace(".", ",")
            srt_lines.append(f"{start_str} --> {end_str}")
            srt_lines.append(entry["narration"])
            srt_lines.append("")
        t += entry['tts_duration']

    # Build ffmpeg command for audio mix
    n = len(manifest)
    inputs = []
    for entry in manifest:
        tts_path = os.path.join(TTS_DIR, f"segment_{entry['segment_id']:03d}.wav")
        inputs.extend(["-i", tts_path])

    filter_parts = []
    for i, entry in enumerate(manifest):
        delay_ms = int(sum(e['tts_duration'] for e in manifest[:i]) * 1000)
        filter_parts.append(f"[{i}:a]adelay={delay_ms}|{delay_ms}[a{i}];")

    mix_inputs = "".join(f"[a{i}]" for i in range(n))
    filter_parts.append(f"{mix_inputs}amix=inputs={n}:duration=longest[outa]")

    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", "".join(filter_parts),
        "-map", "[outa]", tts_track
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    tts_duration = get_duration(tts_track)
    print(f"TTS track: {tts_duration:.1f}s")

    # Step 4: Write SRT to simple path
    srt_path = os.path.join(OUTPUT_DIR, "subtitles.srt")
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(srt_lines))
    print(f"SRT: {srt_path}")

    # Copy ASS to C:\tmp for simpler path
    tmp_ass = r"C:\tmp\subtitles.ass"
    os.makedirs(r"C:\tmp", exist_ok=True)

    # Step 5: Final assembly — video + TTS audio + subtitles
    print("\n=== Step 5: Final assembly ===")
    final_output = os.path.join(OUTPUT_DIR, "dirt_rally_2_tribute.mp4")

    # Use ass filter with escaped path (escape colon for ffmpeg filter syntax)
    ass_filter = f"ass=C\\:/tmp/subtitles.ass"

    cmd = [
        "ffmpeg", "-y",
        "-i", concat_video,
        "-i", tts_track,
        "-vf", ass_filter,
        "-c:v", "libx264", "-crf", "23", "-preset", "medium",
        "-c:a", "aac", "-b:a", "192k",
        "-map", "0:v", "-map", "1:a",
        "-shortest",
        final_output
    ]
    print(f"Running final assembly with ASS subtitles...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ASS subtitle error:\n{result.stderr[-1500:]}")
        # Fallback: skip subtitles
        print("\nRetrying without subtitles...")
        cmd_fallback = [
            "ffmpeg", "-y",
            "-i", concat_video,
            "-i", tts_track,
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-map", "0:v", "-map", "1:a",
            "-shortest",
            final_output
        ]
        subprocess.run(cmd_fallback, check=True, capture_output=True, text=True)

    final_duration = get_duration(final_output)
    final_size_mb = os.path.getsize(final_output) / 1024 / 1024
    print(f"\n=== DONE ===")
    print(f"Output: {final_output}")
    print(f"Duration: {final_duration:.1f}s ({final_duration/60:.1f}min)")
    print(f"Size: {final_size_mb:.1f} MB")

if __name__ == "__main__":
    main()
