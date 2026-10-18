#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-4173}"
printf '\n  Winnie 口语小花园\n  http://localhost:%s\n\n  录音需要 localhost 或 https；按 Ctrl+C 停止。\n\n' "$PORT"
python3 -m http.server "$PORT"
