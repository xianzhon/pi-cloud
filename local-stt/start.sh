#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
MODEL_PATH="${WHISPER_MODEL_PATH:-$HOME/.local/share/whisper.cpp/models/ggml-large-v3-turbo-q5_0.bin}"
PID_FILE="$SCRIPT_DIR/whisper-server.pid"
LOG_FILE="$SCRIPT_DIR/whisper-server.log"
TMP_DIR="${TMPDIR:-/tmp}/pi-cloud-whisper"
PORT="${PI_CLOUD_LOCAL_STT_PORT:-28080}"

if [[ ! -f "$MODEL_PATH" ]]; then
  print -u2 "Model not found: $MODEL_PATH"
  print -u2 "Download ggml-large-v3-turbo-q5_0.bin before starting."
  exit 1
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
  print "whisper-server already running (PID $(<"$PID_FILE"))"
  exit 0
fi

mkdir -p "$TMP_DIR"
rm -f "$PID_FILE"
nohup whisper-server \
  --model "$MODEL_PATH" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --inference-path /audio/transcriptions \
  --convert \
  --tmp-dir "$TMP_DIR" \
  --language auto \
  >"$LOG_FILE" 2>&1 &

print $! > "$PID_FILE"
print "Starting whisper-server on http://127.0.0.1:$PORT"
for _ in {1..60}; do
  if curl --noproxy '*' -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    print "whisper-server ready (PID $(<"$PID_FILE"))"
    exit 0
  fi
  sleep 1
done

print -u2 "whisper-server did not become ready; see $LOG_FILE"
exit 1
