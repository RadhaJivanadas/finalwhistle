#!/usr/bin/env bash
# Assemble recorded segments into the final demo video (<=5 min, 1080p).
#   bash scripts/video/assemble.sh [out_dir]
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-out}"
cd "$OUT"

rm -f list.txt final-demo.mp4
for f in 00-title 01-home 02-bet 03-live 04-settle 05-receipt 06-outro; do
  test -f "$f.webm" || { echo "missing $f.webm"; exit 1; }
  # Uniform codec/fps/size so concat is seamless.
  ffmpeg -y -loglevel error -i "$f.webm" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=25" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an "$f.mp4"
  echo "file '$f.mp4'" >> list.txt
  echo "converted $f"
done

ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy final-demo.mp4
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 final-demo.mp4)
echo "final-demo.mp4 ready, duration ${DUR}s"
