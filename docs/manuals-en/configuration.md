# Configuration

Pi Cloud reads configuration from shell environment variables and `.env` files. Shell variables take precedence. Source deployments can use `.env` in the project root; global installations use `~/.config/pi-cloud/.env` by default. Set `XDG_CONFIG_HOME` to change the user configuration directory.

On the first run of a global installation, Pi Cloud copies the complete sample configuration to the user configuration file and replaces the sample credentials with the `admin` username and a random password. It prints those credentials to the terminal. An existing user configuration file is never overwritten.

## Authentication

| Variable | Required | Description |
|---|---|---|
| `PI_CLOUD_AUTH_USERNAME` | Yes | Login username |
| `PI_CLOUD_AUTH_PASSWORD` | Yes* | Plaintext login password for development or simple setups |
| `PI_CLOUD_AUTH_PASSWORD_HASH` | Yes* | scrypt password hash, recommended for production |

\* Provide exactly one of `PI_CLOUD_AUTH_PASSWORD` or `PI_CLOUD_AUTH_PASSWORD_HASH`. See the [deployment manual](deployment.md#store-the-password-securely) for generating and configuring a production password hash.

## Server and Storage

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `FRONTEND_PORT` | `5173` | Frontend development server port |
| `HOST` | `127.0.0.1` | Backend bind address |
| `PI_CLOUD_DB_PATH` | User configuration directory | Custom SQLite database path |
| `PI_CLOUD_ALLOWED_ROOTS` | User home directory | Comma-separated directories the file browser and terminal may access |
| `PI_CLOUD_DISABLE_PATH_CHECK` | `true` on Windows; `false` on macOS/Linux | Disable allowed-root checks for file, terminal cwd, and Git API paths |
| `PI_CLOUD_ENABLE_SYSTEM_OPEN` | `false` | Enable **Open with system tool** through non-localhost URLs, such as a local nginx hostname |
| `PI_CLOUD_TERMINAL_SHELL` | `COMSPEC`/`cmd.exe` on Windows; `SHELL`/`bash` on macOS/Linux | Terminal shell executable, such as `powershell.exe`, `pwsh.exe`, or `/bin/zsh` |

**Open with system tool** is automatically available through `localhost`, `127.0.0.1`, `::1`, and `*.localhost`. Set `PI_CLOUD_ENABLE_SYSTEM_OPEN=true` when accessing the same local machine through a custom reverse-proxy hostname. The action launches an application on the machine running Pi Cloud, so enable it only for trusted local deployments. Restart the server after changing this setting.

When `PI_CLOUD_DISABLE_PATH_CHECK=true`, `PI_CLOUD_ALLOWED_ROOTS` is ignored. Windows disables these checks by default so paths on other drives remain accessible; set `PI_CLOUD_DISABLE_PATH_CHECK=false` and configure `PI_CLOUD_ALLOWED_ROOTS` to restrict access. Disabling the check allows WebUI filesystem endpoints to access any path permitted to the server process, so use it only in a trusted deployment.

The CLI equivalents for the common server options are:

```bash
pi-cloud --port 8080
pi-cloud --hostname 0.0.0.0 --no-open
```

## Sessions and Security

| Variable | Default | Description |
|---|---|---|
| `PI_CLOUD_SESSION_TTL_HOURS` | `8` | Session idle timeout and renewal window in hours |
| `PI_CLOUD_SESSION_MAX_HOURS` | `720` | Maximum session lifetime, including renewals, in hours |
| `PI_CLOUD_COOKIE_SECURE` | `false` | Restrict the session cookie to HTTPS connections |
| `PI_CLOUD_TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers from a reverse proxy |
| `SKIP_2FA_VERIFY` | `false` | Emergency 2FA bypass; keep disabled during normal operation |

When exposing Pi Cloud on a network, use HTTPS through a trusted reverse proxy and keep authentication enabled. Set `PI_CLOUD_TRUST_PROXY=true` and `PI_CLOUD_COOKIE_SECURE=true` when deployed behind HTTPS as described in the [deployment manual](deployment.md#reverse-proxy-nginx).

## Memory Policy

`PI_CLOUD_MEMORY_POLICY` controls memory extraction and recall. The adaptive lexical policy is enabled by default. To temporarily roll back to the legacy policy:

```env
PI_CLOUD_MEMORY_POLICY=legacy
```

Restart the server after changing this setting.

## Agent Proxy Configuration

Configure the proxy for each agent profile from the WebUI profile settings. The settings are stored in the Pi Cloud SQLite database and apply only to agent and model requests; the embedded terminal is not affected. Changes take effect on the next agent action without a restart.

## Local LLM Configuration

Open **Agent profiles → Local LLM**, choose an Ollama, LM Studio, or llama.cpp preset (or enter a custom OpenAI-compatible endpoint), and click **Connect & discover models**. Select the models to expose and save them; no API key is required. The endpoint is reached by the Pi Cloud server, so `127.0.0.1` refers to the machine running the server. Loopback endpoints are allowed by default. To use a LAN or remote endpoint, add its exact origin (scheme, hostname, and port) to the comma-separated `PI_CLOUD_LOCAL_LLM_ALLOWED_ORIGINS` setting, for example `http://192.168.1.20:11434,https://llm.example.test`. The generated provider is stored in that profile's `models.json` without replacing other providers. Discovered models are configured for text and image input by default; existing explicit model capabilities are preserved.

## Custom API Providers

Open **Agent profiles → Custom API provider** to add an OpenAI-compatible remote service. Enter a lowercase provider ID, an HTTPS base URL ending at the API root (for example, `https://api.example.com/v1`), and its API key. Click **Connect & discover models**, select the models to expose, and save the provider. The provider and selected model IDs are stored in the profile's `models.json`; newly entered keys are stored separately in Pi's protected `auth.json` and are never returned to the browser. Existing custom providers in `models.json`, such as a manually configured Agnes provider, can also be selected and edited here.

Model discovery depends on the provider's `GET /models` response. Most OpenAI-compatible services return model IDs but not context-window, reasoning, or image capabilities, so discovered models use Pi's defaults unless those fields already exist in `models.json`.

For Cloudflare Workers AI, choose **Cloudflare Workers AI** as the provider type and enter the Cloudflare Account ID and an API token with Workers AI read access. Pi Cloud generates the fixed `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` endpoint and loads chat-compatible models from Cloudflare's model catalog. Select the models to expose and mark image support as needed. AI Gateway is not enabled and no gateway ID is required.

## Voice Dictation

Voice dictation is an independent speech-to-text layer; the coding agent receives only the resulting text. Configure an OpenAI-compatible `/audio/transcriptions` endpoint, then restart the server:

```env
PI_CLOUD_STT_API_KEY=sk-...
PI_CLOUD_STT_BASE_URL=https://api.openai.com/v1
PI_CLOUD_STT_MODEL=gpt-4o-mini-transcribe
PI_CLOUD_STT_LANGUAGE=zh
```

`PI_CLOUD_STT_API_KEY` falls back to `OPENAI_API_KEY`. The base URL and model default to the values above. `PI_CLOUD_STT_LANGUAGE` is optional; omit it to let the provider detect the language. Once configured, the microphone button records in the browser, sends the completed audio to the server for transcription, and inserts the returned text into the message input without sending it automatically. The same service transcribes inbound WeCom voice messages. The STT provider must accept AMR audio for WeCom support. Browser microphone access requires HTTPS or localhost.

## Provider and Gateway Variables

Provider API keys such as `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are optional because the server uses the Pi agent's own authentication by default.

See `.env.example` for provider-specific variables and the dedicated [Feishu](feishu-gateway.md), [WeCom](wecom-gateway.md), and [WeChat](weixin-gateway.md) gateway manuals for messaging configuration.
