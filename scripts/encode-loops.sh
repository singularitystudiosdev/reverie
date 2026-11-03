#!/usr/bin/env bash
# Encode the 14 animated portrait loops into public/characters/<id>-loop.mp4.
#
#   scripts/encode-loops.sh            encode every id, then print the seam table
#   scripts/encode-loops.sh verify     only print the seam table
#   scripts/encode-loops.sh <id>...    encode (and verify) just these ids
#
# Source clips: 5s, 24fps, 720x1280 (isolde: 704x1280), one per id.
# - 13 clips were generated with the portrait as first AND last frame, so the
#   final frame duplicates the first: it is dropped so the loop does not stall.
#   The last frame is only close to the first (SSIM about 0.96), so the last
#   SOFT_FADE frames are also crossfaded into the first SOFT_FADE ones.
# - isolde has only a first frame (its last frame is not close to it): the last
#   FADE frames are crossfaded into the first FADE frames.
# - In both cases the loop is rotated so the blend plays first. The frame before
#   the loop point (n-f-1) then runs into frame n-f, and the last blended frame
#   runs into frame f, so the wrap is one ordinary step.
# - Output: H.264 High, yuv420p, 720x1280, no audio, +faststart, the lowest CRF
#   that keeps the file at or under MAX_BYTES.
#
# Seam proof: SSIM between each output's last and first frame next to the SSIM
# of an ordinary adjacent pair (frame 0 vs 1) of the same file. A seamless loop
# has a seam score in the same range as the adjacent pair, never far below it.
set -euo pipefail

FFMPEG=${FFMPEG:-/opt/homebrew/bin/ffmpeg}
SRC=${SRC:-/Users/adrianagne/Documents/cosmos/projects/v3-xxx/.tmp/reverie-art/video}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/public/characters
MAX_BYTES=${MAX_BYTES:-1500000}
FADE=${FADE:-19} # isolde: about 0.8s at 24fps
SOFT_FADE=${SOFT_FADE:-8} # the other 13: a third of a second hides the last residual step
FPS=24
ALL_IDS=(sylvara vesper hanami nerissa cinder isolde nova luna clementine maya kiyo zahra raven ada)

fit='scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps='$FPS

encode() { # <filter_complex-or-vf> <input> <output> <mode>
  local mode=$1 input=$2 output=$3 crf size
  for crf in 16 18 20 22 24 26 28 30 32 34; do
    if [ "$mode" = vf ]; then
      "$FFMPEG" -v error -y -i "$input" -vf "$4" -an -c:v libx264 -profile:v high -pix_fmt yuv420p \
        -preset slow -crf "$crf" -movflags +faststart "$output"
    else
      "$FFMPEG" -v error -y -i "$input" -filter_complex "$4" -map '[out]' -an -c:v libx264 -profile:v high \
        -pix_fmt yuv420p -preset slow -crf "$crf" -movflags +faststart "$output"
    fi
    size=$(stat -f %z "$output")
    if [ "$size" -le "$MAX_BYTES" ]; then
      echo "$(basename "$output") crf=$crf bytes=$size"
      return
    fi
  done
  echo "WARNING: $(basename "$output") is $size bytes at crf 34" >&2
}

encode_id() {
  local id=$1 src=$SRC/$1.mp4 out=$OUT/$1-loop.mp4 n f
  [ -f "$src" ] || { echo "missing $src" >&2; exit 1; }
  n=$("$FFMPEG" -i "$src" -vf "$fit" -f null - 2>&1 | grep -o 'frame= *[0-9]*' | tail -1 | grep -o '[0-9]*$')
  f=$SOFT_FADE
  if [ "$id" = isolde ]; then
    f=$FADE
  else
    n=$((n - 1)) # the final frame duplicates the first: drop it
  fi
  # head: frames 0..f-1, tail: frames n-f..n-1, mid: frames f..n-f-1.
  # xfade(tail -> head) over the whole of both, then the mid section.
  encode fc "$src" "$out" "[0:v]$fit,split=3[a][b][c];\
[a]trim=start_frame=0:end_frame=$f,setpts=PTS-STARTPTS[head];\
[b]trim=start_frame=$((n - f)):end_frame=$n,setpts=PTS-STARTPTS[tail];\
[c]trim=start_frame=$f:end_frame=$((n - f)),setpts=PTS-STARTPTS[mid];\
[tail][head]xfade=transition=fade:duration=$(awk -v f="$f" -v r="$FPS" 'BEGIN{printf "%.6f", f/r}'):offset=0[blend];\
[blend][mid]concat=n=2:v=1:a=0,format=yuv420p[out]"
}

frame_png() { # <video> <index> <png>
  "$FFMPEG" -v error -y -i "$1" -vf "select=eq(n\,$2)" -frames:v 1 -fps_mode passthrough "$3"
}

ssim() { # <png> <png>
  "$FFMPEG" -i "$1" -i "$2" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | tail -1 | cut -d: -f2
}

verify() {
  local tmp frames id v last s_seam s_adj
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/loops.XXXXXX")
  printf '%-11s %7s %9s %10s %10s\n' id frames bytes seam_ssim adj_ssim
  for id in "$@"; do
    v=$OUT/$id-loop.mp4
    frames=$("$FFMPEG" -i "$v" -f null - 2>&1 | grep -o 'frame= *[0-9]*' | tail -1 | grep -o '[0-9]*$')
    last=$((frames - 1))
    frame_png "$v" 0 "$tmp/$id-0.png"
    frame_png "$v" 1 "$tmp/$id-1.png"
    frame_png "$v" "$last" "$tmp/$id-last.png"
    s_seam=$(ssim "$tmp/$id-last.png" "$tmp/$id-0.png")
    s_adj=$(ssim "$tmp/$id-0.png" "$tmp/$id-1.png")
    printf '%-11s %7s %9s %10s %10s\n' "$id" "$frames" "$(stat -f %z "$v")" "$s_seam" "$s_adj"
  done
  rm -rf "$tmp"
}

mode=${1:-all}
case "$mode" in
  verify) verify "${ALL_IDS[@]}" ;;
  all) for id in "${ALL_IDS[@]}"; do encode_id "$id"; done; verify "${ALL_IDS[@]}" ;;
  *) for id in "$@"; do encode_id "$id"; done; verify "$@" ;;
esac
