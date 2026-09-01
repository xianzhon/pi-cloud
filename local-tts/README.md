# Local MLX Audio TTS for Pi Cloud

This directory runs a local OpenAI-compatible text-to-speech service for Pi Cloud on an Apple Silicon Mac. The service stays on `127.0.0.1`; Pi Cloud calls it through `/v1/audio/speech`.

## Recommended model

Start with Kokoro:

```text
mlx-community/Kokoro-82M-bf16
```

It is small, fast, and includes English and Mandarin voices. Useful voices include:

| Voice | Language |
| --- | --- |
| `af_heart` | American English |
| `am_adam` | American English |
| `zf_xiaobei` | Mandarin Chinese |
| `zm_yunxi` | Mandarin Chinese |

For better Chinese quality or voice cloning, try a Qwen3-TTS 1.7B MLX model after the basic setup works. It will use more memory and have higher latency than Kokoro.

## Install MLX Audio

Use a native arm64 Python environment. Python 3.12 is a practical choice for the current TTS dependency set:

```bash
uv venv --python 3.12 "$HOME/.venvs/mlx-audio"
uv pip install --python "$HOME/.venvs/mlx-audio/bin/python" 'mlx-audio[tts,server]' 'misaki[zh]'
```

Install `ffmpeg` only if you want MP3, FLAC, OGG, or Opus output:

```bash
brew install ffmpeg
```

WAV output works without `ffmpeg` and is the default used by Pi Cloud.

## Start the service

From this directory:

```bash
make start
make status
```

The default endpoint is:

```text
http://127.0.0.1:28081/v1
```

Override the port or Python environment when needed:

```bash
PI_CLOUD_LOCAL_TTS_PORT=28082 make start
MLX_AUDIO_PYTHON="$HOME/.venvs/my-mlx/bin/python" make start
```

The model is downloaded by MLX Audio on its first synthesis request and cached locally. Do not commit model files to this repository.

## Configure Pi Cloud

Add these values to the local, uncommitted environment file used by Pi Cloud:

```env
PI_CLOUD_TTS_BASE_URL=http://127.0.0.1:28081/v1
PI_CLOUD_TTS_MODEL=mlx-community/Kokoro-82M-bf16
PI_CLOUD_TTS_VOICE=zf_xiaobei
PI_CLOUD_TTS_LANGUAGE=zh
PI_CLOUD_TTS_FORMAT=wav
```

No `PI_CLOUD_TTS_API_KEY` is required for the local MLX Audio server. Restart Pi Cloud after changing environment variables.

If you selected another service port, use that port in `PI_CLOUD_TTS_BASE_URL`.

## Test the endpoint

```bash
curl --noproxy '*' -sS \
  -X POST http://127.0.0.1:28081/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "mlx-community/Kokoro-82M-bf16",
    "input": "你好，这是 Pi Cloud 的本地语音测试。",
    "voice": "zf_xiaobei",
    "response_format": "wav",
    "lang_code": "z"
  }' \
  --output test.wav

open test.wav
```

The first request may take longer while the model downloads and loads. Later requests reuse the loaded model.

## Stop the service

```bash
make stop
```

Logs and the PID file are kept in this directory for troubleshooting and ignored by Git:

```text
local-tts/mlx-audio.log
local-tts/mlx-audio.pid
```

## Troubleshooting

### Python environment not found

Check the configured interpreter:

```bash
ls -l "$HOME/.venvs/mlx-audio/bin/python"
"$HOME/.venvs/mlx-audio/bin/python" -c 'import mlx_audio, misaki; print("ok")'
```

### TTS is unavailable in Pi Cloud

Check both services:

```bash
make status
curl --noproxy '*' -sf http://127.0.0.1:28081/docs >/dev/null
```

Then verify that `PI_CLOUD_TTS_BASE_URL` includes `/v1` and that Pi Cloud was restarted after editing its environment file.

### Generation fails or is too slow

Inspect `mlx-audio.log`. First test with Kokoro and short text. Avoid loading a large TTS model simultaneously with a memory-heavy local LLM on a 16 GB Mac; stop one service or use a smaller/quantized model if memory pressure occurs.
