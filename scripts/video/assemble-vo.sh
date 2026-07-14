#!/usr/bin/env bash
# Final assembly with voiceover: pairs each scene video with its narration,
# pads audio with silence to scene length, extends title to fit VO, concats.
#   bash scripts/video/assemble-vo.sh <scenes_dir> [vo_dir] [out_file]
# Scene videos: <dir>/{00-title,01-home,02-bet,03-live,04-settle,05-receipt,06-outro}.webm|.mp4
set -euo pipefail
export PATH="/c/Programs/ffmpeg/bin:$PATH"
cd "$(dirname "$0")"
SCENES="${1:?scenes dir}"; VO="${2:-vo}"; OUTF="${3:-$SCENES/final-demo-vo.mp4}"

rm -f "$SCENES/list-vo.txt"
for s in 00-title 01-home 02-bet 03-live 04-settle 05-receipt 06-outro; do
  src="$SCENES/$s.webm"; [ -f "$src" ] || src="$SCENES/$s.mp4"
  [ -f "$src" ] || { echo "missing scene $s"; exit 1; }
  vodur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VO/vo-$s.wav")
  viddur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
  # target = max(video, vo + 0.7s tail)
  target=$(python -c "print(max(float('$viddur'), float('$vodur')+0.7))")
  ffmpeg -y -loglevel error -i "$src" -i "$VO/vo-$s.wav" \
    -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=25,tpad=stop_mode=clone:stop_duration=10,trim=duration=$target[v];[1:a]aresample=48000,apad[a]" \
    -map "[v]" -map "[a]" -t "$target" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k \
    "$SCENES/$s-vo.mp4"
  echo "file '$s-vo.mp4'" >> "$SCENES/list-vo.txt"
  echo "scene $s: video=${viddur}s vo=${vodur}s -> ${target}s"
done

ffmpeg -y -loglevel error -f concat -safe 0 -i "$SCENES/list-vo.txt" -c copy "$OUTF"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTF")
echo "DONE: $OUTF (${DUR}s)"
