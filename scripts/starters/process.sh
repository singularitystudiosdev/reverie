#!/usr/bin/env bash
# Turns one starter persona's raw generations into the app's assets.
#   scripts/starters/process.sh <id> <raw-dir>
# Reads <raw-dir>/<id>.png (profile still), <raw-dir>/<id>-scene.png (background),
# <raw-dir>/<id>-loop-raw.mp4 (profile video, optional). Writes public/characters/:
#   <id>.webp 893x1600, <id>-sm.webp 357x640, <id>-scene.webp 893x1600,
#   <id>-scene-sm.webp 357x640, <id>-loop.mp4 720x1280 24fps muted seamless loop.
set -euo pipefail
id="$1"; raw="$2"; out="public/characters"
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
[ -f "$raw/$id.png" ] || { echo "$id: missing $raw/$id.png" >&2; exit 1; }
magick "$raw/$id.png" -resize 893x1600^ -gravity center -extent 893x1600 -quality 80 "$out/$id.webp"
magick "$raw/$id.png" -resize 357x640^ -gravity center -extent 357x640 -quality 80 "$out/$id-sm.webp"
if [ -f "$raw/$id-scene.png" ]; then
  magick "$raw/$id-scene.png" -resize 893x1600^ -gravity center -extent 893x1600 -quality 72 "$out/$id-scene.webp"
  magick "$raw/$id-scene.png" -resize 357x640^ -gravity center -extent 357x640 -quality 72 "$out/$id-scene-sm.webp"
fi
if [ -f "$raw/$id-loop-raw.mp4" ]; then
  d=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$raw/$id-loop-raw.mp4")
  f=0.75
  off=$(python3 -c "print(round($d - 2*$f, 3))")
  # Seamless loop: drop the first f seconds, then crossfade the clip's last f seconds into its first f.
  ffmpeg -v error -y -i "$raw/$id-loop-raw.mp4" -filter_complex \
    "[0:v:0]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24,format=yuv420p,split[a][b];[a]trim=start=$f,setpts=PTS-STARTPTS[mid];[b]trim=end=$f,setpts=PTS-STARTPTS[head];[mid][head]xfade=transition=fade:duration=$f:offset=$off[v]" \
    -map "[v]" -an -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart "$out/$id-loop.mp4"
fi
ls -1 "$out/$id".webp "$out/$id"-*.webp "$out/$id"-loop.mp4 2>/dev/null | tr '\n' ' '; echo
