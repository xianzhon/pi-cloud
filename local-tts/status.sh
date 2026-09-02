#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PID_FILE="$SCRIPT_DIR/mlx-audio.pid"
PORT="${PI_CLOUD_LOCAL_TTS_PORT:-28081}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(<$PID_FILE)" 2>/dev/null; then
  if curl --noproxy '*' -sf "http://127.0.0.1:$PORT/docs" >/dev/null 2>&1; then
    print "MLX Audio is ready on http://127.0.0.1:$PORT (PID $(<$PID_FILE))"
    exit 0
  fi
fi

print "MLX Audio is not ready"
exit 1
