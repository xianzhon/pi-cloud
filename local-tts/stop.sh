#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PID_FILE="$SCRIPT_DIR/mlx-audio.pid"

if [[ ! -f "$PID_FILE" ]]; then
  print "MLX Audio is not running"
  exit 0
fi

PID=$(<$PID_FILE)
if [[ "$PID" != <-> ]]; then
  print -u2 "Invalid MLX Audio PID file: $PID_FILE"
  exit 1
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  print "MLX Audio is not running"
  exit 0
fi

COMMAND=$(ps -p "$PID" -o command= 2>/dev/null || true)
if [[ "$COMMAND" != *"mlx_audio.server"* ]]; then
  print -u2 "Refusing to stop PID $PID because it is not an MLX Audio server"
  exit 1
fi

kill "$PID"
for _ in {1..10}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    print "MLX Audio stopped"
    exit 0
  fi
  sleep 1
done

print -u2 "MLX Audio did not stop after 10 seconds; PID file retained"
exit 1
