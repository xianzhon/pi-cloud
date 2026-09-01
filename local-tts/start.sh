#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PYTHON_BIN="${MLX_AUDIO_PYTHON:-$HOME/.venvs/mlx-audio/bin/python}"
MODEL="${PI_CLOUD_LOCAL_TTS_MODEL:-mlx-community/Kokoro-82M-bf16}"
PID_FILE="$SCRIPT_DIR/mlx-audio.pid"
LOG_FILE="$SCRIPT_DIR/mlx-audio.log"
PORT="${PI_CLOUD_LOCAL_TTS_PORT:-28081}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  print -u2 "MLX Audio Python not found or not executable: $PYTHON_BIN"
  print -u2 "Create the environment with: uv venv --python 3.12 $HOME/.venvs/mlx-audio"
  print -u2 "Then install with: uv pip install --python $HOME/.venvs/mlx-audio/bin/python 'mlx-audio[tts,server]'"
  exit 1
fi

if [[ "$MODEL" == *Kokoro* ]] && ! "$PYTHON_BIN" -c 'import misaki' >/dev/null 2>&1; then
  print -u2 "Kokoro text processing is not installed in: $PYTHON_BIN"
  print -u2 "Install it with: uv pip install --python $PYTHON_BIN 'misaki[zh]'"
  exit 1
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(<$PID_FILE)" 2>/dev/null; then
  print "MLX Audio already running (PID $(<$PID_FILE))"
  exit 0
fi

rm -f "$PID_FILE"
nohup "$PYTHON_BIN" -m mlx_audio.server \
  --host 127.0.0.1 \
  --port "$PORT" \
  >"$LOG_FILE" 2>&1 &

print $! > "$PID_FILE"
print "Starting MLX Audio on http://127.0.0.1:$PORT"
for _ in {1..60}; do
  if curl --noproxy '*' -sf "http://127.0.0.1:$PORT/docs" >/dev/null 2>&1; then
    print "MLX Audio ready (PID $(<$PID_FILE))"
    exit 0
  fi
  sleep 1
done

print -u2 "MLX Audio did not become ready; see $LOG_FILE"
exit 1
