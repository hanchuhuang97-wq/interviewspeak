#!/usr/bin/env bash
# Regenerate all bundled clips with free Edge neural voices.
# Requires network. edge-tts is an unofficial client for Microsoft Edge read-aloud.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v edge-tts >/dev/null 2>&1; then
  TTS=(edge-tts)
elif [ -x .venv/bin/edge-tts ]; then
  TTS=(.venv/bin/edge-tts)
elif command -v uvx >/dev/null 2>&1; then
  TTS=(uvx edge-tts)
else
  echo "Install edge-tts first, e.g.  uv tool install edge-tts" >&2
  echo "or create a local venv:       uv venv .venv && uv pip install --python .venv/bin/python edge-tts" >&2
  exit 1
fi

if command -v afconvert >/dev/null 2>&1; then
  CONVERT=afconvert
elif command -v ffmpeg >/dev/null 2>&1; then
  CONVERT=ffmpeg
else
  echo "Converting the downloaded MP3 needs macOS afconvert or ffmpeg." >&2
  exit 1
fi

VOICE_TEACHER="en-US-AvaMultilingualNeural"
VOICE_FRIEND="en-US-AnaNeural"
RATE_TEACHER="-8%"
RATE_SLOW="-24%"
RATE_FRIEND="-2%"

mkdir -p assets/audio
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

convert() { # input.mp3 output.wav
  if [ "$CONVERT" = "afconvert" ]; then
    afconvert -f WAVE -d LEI16 "$1" "$2"
  else
    ffmpeg -y -loglevel error -i "$1" -ac 1 -ar 24000 -c:a pcm_s16le "$2"
  fi
}

duration() {
  if command -v afinfo >/dev/null 2>&1; then
    afinfo "$1" | awk '/estimated duration/{print $3 "s"}'
  elif command -v ffprobe >/dev/null 2>&1; then
    ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"
  fi
}

render() { # voice rate name text
  local voice="$1" rate="$2" name="$3" text="$4" attempt
  for attempt in 1 2 3; do
    if "${TTS[@]}" --voice "$voice" --rate="$rate" --text "$text" --write-media "$tmp/$name.mp3" >/dev/null 2>&1; then
      convert "$tmp/$name.mp3" "assets/audio/$name.wav"
      printf '  %-16s %s\n' "$name.wav" "$(duration "assets/audio/$name.wav")"
      return 0
    fi
    sleep 1
  done
  echo "FAILED: $name" >&2
  return 1
}

echo "Rendering teacher (Ava) / slow / friend (Ana)..."
render "$VOICE_TEACHER" "$RATE_TEACHER" s1-teacher "Hi! My name is Winnie, and I'm five years old!"
render "$VOICE_TEACHER" "$RATE_TEACHER" s2-teacher "My favorite foods are ice cream and cake, because they are super sweet!"
render "$VOICE_TEACHER" "$RATE_TEACHER" s3-teacher "My favorite colors are pink and purple, because they make me feel warm and happy!"
render "$VOICE_TEACHER" "$RATE_TEACHER" s4-teacher "There are five people and a dog in my family, and I love my family so much!"
render "$VOICE_TEACHER" "$RATE_SLOW" s1-slow "Hi! My name is Winnie, and I'm five years old."
render "$VOICE_TEACHER" "$RATE_SLOW" s2-slow "My favorite foods are ice cream and cake, because they are super sweet."
render "$VOICE_TEACHER" "$RATE_SLOW" s3-slow "My favorite colors are pink and purple, because they make me feel warm and happy."
render "$VOICE_TEACHER" "$RATE_SLOW" s4-slow "There are five people and a dog in my family, and I love my family so much."
render "$VOICE_FRIEND" "$RATE_FRIEND" s1-friend "Hi! My name is Winnie, and I'm five years old!"
render "$VOICE_FRIEND" "$RATE_FRIEND" s2-friend "My favorite foods are ice cream and cake, because they are super sweet!"
render "$VOICE_FRIEND" "$RATE_FRIEND" s3-friend "My favorite colors are pink and purple, because they make me feel warm and happy!"
render "$VOICE_FRIEND" "$RATE_FRIEND" s4-friend "There are five people and a dog in my family, and I love my family so much!"
render "$VOICE_FRIEND" "$RATE_FRIEND" welcome "Hi! I'm Winnie. Let's practice speaking together. Are you ready?"

echo "Rendering demo-mode takes with Ana (sentence 2 says 'really' on purpose)..."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-1 "Hi! My name is Winnie, and I'm five years old."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-2 "My favorite foods are ice cream and cake, because they are really sweet."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-3 "My favorite colors are pink and purple, because they make me feel warm and happy."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-4 "There are five people and a dog in my family, and I love my family so much."

echo
echo "Done. Update the durations in data/lesson.js if they changed, and bump ?v= in index.html."
