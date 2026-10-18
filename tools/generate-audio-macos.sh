#!/usr/bin/env bash
# Offline fallback: regenerate the clips with the built-in macOS voices.
# Run from anywhere:  ./tools/generate-audio.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v say >/dev/null || ! command -v afconvert >/dev/null; then
  echo "This script needs macOS 'say' and 'afconvert'." >&2
  exit 1
fi
if ! say -v '?' | grep -q '^Samantha'; then
  echo "Samantha voice not found. Install it in System Settings > Accessibility > Spoken Content > System Voice > Manage Voices." >&2
  exit 1
fi
if ! say -v '?' | grep -q '^Flo '; then
  echo "Flo voice not found. Pick another light voice and edit VOICE_FRIEND below." >&2
  exit 1
fi

VOICE_TEACHER="Samantha"
VOICE_FRIEND="Flo"
RATE_TEACHER=150
RATE_SLOW=116
RATE_FRIEND=158

mkdir -p assets/audio
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

render() { # voice rate name text
  local voice="$1" rate="$2" name="$3" text="$4"
  say -v "$voice" -r "$rate" -o "$tmp/$name.aiff" "$text"
  afconvert -f WAVE -d LEI16 "$tmp/$name.aiff" "assets/audio/$name.wav"
  printf '  %-16s %s\n' "$name.wav" "$(afinfo "assets/audio/$name.wav" | awk '/estimated duration/{print $3 "s"}')"
}

echo "Rendering teacher / slow / friend clips..."
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
render "$VOICE_FRIEND" 155 welcome "Hi! I'm Winnie. Let's practice speaking together. Are you ready?"

echo "Rendering demo-mode takes (sentence 2 deliberately says 'really' instead of 'super')..."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-1 "Hi! My name is Winnie, and I'm five years old."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-2 "My favorite foods are ice cream and cake, because they are really sweet."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-3 "My favorite colors are pink and purple, because they make me feel warm and happy."
render "$VOICE_FRIEND" "$RATE_FRIEND" demo-4 "There are five people and a dog in my family, and I love my family so much."

echo
echo "Done. If you changed the voices or rates, update the durations in data/lesson.js"
echo "so rhythm scoring stays aligned. Bump the ?v= number in index.html to bust caches."
