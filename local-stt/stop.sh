#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PID_FILE="$SCRIPT_DIR/whisper-server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  print "whisper-server is not running"
  exit 0
fi

PID=$(<"$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in {1..10}; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
fi
rm -f "$PID_FILE"
print "whisper-server stopped"
