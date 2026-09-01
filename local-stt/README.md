# Local Whisper STT for Pi Cloud

This guide describes a private, local speech-to-text setup for Pi Cloud on an Apple Silicon Mac. It intentionally avoids machine-specific paths, hostnames, ports, credentials, and runtime details.

## Recommended model

For English dictation on an M2 Pro, use:

```text
ggml-medium.en-q5_0.bin
```

Why:

- `medium.en` is optimized for English.
- It is accurate with technical and coding vocabulary.
- Q5 quantization provides a good accuracy, memory, and speed balance.
- It is lighter and faster than `large-v3`.
- whisper.cpp has native Apple Silicon and Metal support.

Alternatives:

| Model | Choose it when |
| --- | --- |
| `small.en-q5_1` | Lowest latency is more important than accuracy |
| `medium.en-q5_0` | Best general default for English dictation |
| `medium.en` FP16 | You want slightly better quality and have extra memory |
| `large-v3-turbo-q5_0` | You need multilingual or higher general accuracy |
| `large-v3` | You specifically need maximum accuracy and accept high resource use |

For short English voice input, `large-v3` is normally unnecessary.

## Architecture

```text
Browser microphone
  -> Pi Cloud speech route
  -> local whisper.cpp OpenAI-compatible endpoint
  -> text returned to Pi Cloud input
```

The browser normally records WebM/Opus. FFmpeg converts that audio to a Whisper-compatible WAV format before transcription.

## Install dependencies

On Apple Silicon macOS:

```bash
brew install whisper-cpp ffmpeg
```

Verify the tools:

```bash
command -v whisper-server
command -v ffmpeg
whisper-server --help
```

When the server starts, its output should show that the Metal backend is available.

## Download the model

Choose a model directory outside the Git repository:

```bash
mkdir -p "$HOME/.local/share/whisper.cpp/models"
```

Download the recommended model:

```bash
curl -L --fail --retry 2 \
  -o "$HOME/.local/share/whisper.cpp/models/ggml-medium.en-q5_0.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-q5_0.bin
```

The file is several hundred megabytes. Do not commit it to the application repository.

## Configure Pi Cloud

Add these variables to Pi Cloud's local, uncommitted environment file. Replace the URL with the address and port used by your local Whisper server:

```env
PI_CLOUD_STT_API_KEY=local
PI_CLOUD_STT_BASE_URL=http://127.0.0.1:PORT
PI_CLOUD_STT_MODEL=medium.en
PI_CLOUD_STT_LANGUAGE=en
```

The `local` API key is only a compatibility value for the Bearer header. Use a real secret if the STT endpoint is exposed beyond the local machine.

The backend must load these variables when it starts. Do not put credentials or private runtime configuration in Git.

## Start whisper.cpp

The equivalent server command is:

```bash
whisper-server \
  --model "$HOME/.local/share/whisper.cpp/models/ggml-medium.en-q5_0.bin" \
  --host 127.0.0.1 \
  --port PORT \
  --inference-path /audio/transcriptions \
  --convert \
  --tmp-dir "${TMPDIR:-/tmp}/whisper-stt" \
  --language en
```

Create the temporary directory first:

```bash
mkdir -p "${TMPDIR:-/tmp}/whisper-stt"
```

Binding to `127.0.0.1` keeps the service off the network. The included `start.sh` helper uses equivalent settings and stores only local PID/log files.

## Test the endpoint

Use any short WAV file:

```bash
curl --noproxy '*' -sS \
  -w '\nHTTP %{http_code}\n' \
  http://127.0.0.1:PORT/audio/transcriptions \
  -H 'Authorization: Bearer local' \
  -F 'file=@sample.wav' \
  -F 'model=medium.en' \
  -F 'language=en'
```

Expected response:

```json
{"text":"Your transcription"}
```

Test browser-format audio as well:

```bash
curl --noproxy '*' -sS \
  http://127.0.0.1:PORT/audio/transcriptions \
  -H 'Authorization: Bearer local' \
  -F 'file=@recording.webm' \
  -F 'model=medium.en' \
  -F 'language=en'
```

A successful WebM request confirms that FFmpeg conversion and the browser audio format are compatible.

## Use with Pi Cloud

After the backend has loaded the STT environment variables:

1. Open Pi Cloud through its normal local or HTTPS URL.
2. Allow microphone access in the browser.
3. Click the microphone button.
4. Speak, then stop recording.
5. Confirm the transcript is inserted into the message input.

Dictation inserts text; it does not automatically send the message.

## Nginx upload issue

If short recordings work but longer recordings return HTTP 500, check Nginx's request-body temporary directory. When the upload exceeds `client_body_buffer_size`, Nginx writes it to `client_body_temp_path`. The Nginx worker must be able to write to that directory.

Example configuration:

```nginx
client_max_body_size 25m;
client_body_buffer_size 128k;
client_body_temp_path /path/to/writable/nginx/client_body_temp;
```

Ensure the directory is owned and writable by the Nginx worker user, then validate and reload Nginx:

```bash
nginx -t
nginx -s reload
```

An Nginx error such as `client_body_temp/... Permission denied` causes the request to fail before it reaches Pi Cloud. Increasing `client_body_buffer_size` alone is not a reliable fix. HTTP 502 is a separate upstream or Whisper-server problem.

### Troubleshooting

### Speech is shown as unavailable

The backend did not load a non-empty `PI_CLOUD_STT_API_KEY`, or the browser cannot access the microphone. Check the environment configuration and browser permissions.

### `Transcription failed`

Check both application and Whisper logs, then verify:

```bash
command -v ffmpeg
lsof -nP -iTCP:PORT -sTCP:LISTEN
```

Run the direct endpoint test above. If it succeeds, the Whisper endpoint and model are healthy.

### FFmpeg conversion failed

Confirm FFmpeg is installed and the temporary directory exists:

```bash
ffmpeg -version
mkdir -p "${TMPDIR:-/tmp}/whisper-stt"
```

### Model loading failed

Check that the model exists and is a binary file:

```bash
ls -lh "$HOME/.local/share/whisper.cpp/models/ggml-medium.en-q5_0.bin"
file "$HOME/.local/share/whisper.cpp/models/ggml-medium.en-q5_0.bin"
```

### Busy or intermittent 502 errors

A single whisper.cpp processor handles one transcription at a time. Concurrent requests may be rejected and appear to Pi Cloud as HTTP 502. Avoid overlapping recordings or diagnostic requests. A production setup can add retry/backoff or deliberately configure multiple processors after checking memory use.

## Included helper scripts

- `start.sh` starts Whisper if it is not already running.
- `status.sh` checks whether the local endpoint is ready.
- `stop.sh` is an optional manual stop command.
- `.gitignore` excludes generated PID and log files.
