# Configuration

Pi WebUI reads configuration from shell environment variables and `.env` files. Shell variables take precedence. Source deployments can use `.env` in the project root; global installations use `~/.config/pi-webui/.env` by default. Set `XDG_CONFIG_HOME` to change the user configuration directory.

On the first run of a global installation, Pi WebUI copies the complete sample configuration to the user configuration file and replaces the sample credentials with the `admin` username and a random password. It prints those credentials to the terminal. An existing user configuration file is never overwritten.

## Authentication

| Variable | Required | Description |
|---|---|---|
| `PI_WEBUI_AUTH_USERNAME` | Yes | Login username |
| `PI_WEBUI_AUTH_PASSWORD` | Yes* | Plaintext login password for development or simple setups |
| `PI_WEBUI_AUTH_PASSWORD_HASH` | Yes* | scrypt password hash, recommended for production |

\* Provide exactly one of `PI_WEBUI_AUTH_PASSWORD` or `PI_WEBUI_AUTH_PASSWORD_HASH`. See the [deployment manual](deployment.md#store-the-password-securely) for generating and configuring a production password hash.

## Server and Storage

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `FRONTEND_PORT` | `5173` | Frontend development server port |
| `HOST` | `127.0.0.1` | Backend bind address |
| `PI_WEBUI_DB_PATH` | User configuration directory | Custom SQLite database path |
| `PI_WEBUI_ALLOWED_ROOTS` | User home directory | Comma-separated directories the file browser and terminal may access |
| `PI_WEBUI_DISABLE_PATH_CHECK` | `true` on Windows; `false` on macOS/Linux | Disable allowed-root checks for file, terminal cwd, and Git API paths |
| `PI_WEBUI_TERMINAL_SHELL` | `COMSPEC`/`cmd.exe` on Windows; `SHELL`/`bash` on macOS/Linux | Terminal shell executable, such as `powershell.exe`, `pwsh.exe`, or `/bin/zsh` |

When `PI_WEBUI_DISABLE_PATH_CHECK=true`, `PI_WEBUI_ALLOWED_ROOTS` is ignored. Windows disables these checks by default so paths on other drives remain accessible; set `PI_WEBUI_DISABLE_PATH_CHECK=false` and configure `PI_WEBUI_ALLOWED_ROOTS` to restrict access. Disabling the check allows WebUI filesystem endpoints to access any path permitted to the server process, so use it only in a trusted deployment.

The CLI equivalents for the common server options are:

```bash
pi-webui --port 8080
pi-webui --hostname 0.0.0.0 --no-open
```

## Sessions and Security

| Variable | Default | Description |
|---|---|---|
| `PI_WEBUI_SESSION_TTL_HOURS` | `8` | Session idle timeout and renewal window in hours |
| `PI_WEBUI_SESSION_MAX_HOURS` | `720` | Maximum session lifetime, including renewals, in hours |
| `PI_WEBUI_COOKIE_SECURE` | `false` | Restrict the session cookie to HTTPS connections |
| `PI_WEBUI_TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers from a reverse proxy |
| `SKIP_2FA_VERIFY` | `false` | Emergency 2FA bypass; keep disabled during normal operation |

When exposing Pi WebUI on a network, use HTTPS through a trusted reverse proxy and keep authentication enabled. Set `PI_WEBUI_TRUST_PROXY=true` and `PI_WEBUI_COOKIE_SECURE=true` when deployed behind HTTPS as described in the [deployment manual](deployment.md#reverse-proxy-nginx).

## Memory Policy

`PI_WEBUI_MEMORY_POLICY` controls memory extraction and recall. The adaptive lexical policy is enabled by default. To temporarily roll back to the legacy policy:

```env
PI_WEBUI_MEMORY_POLICY=legacy
```

Restart the server after changing this setting.

## Agent Proxy Configuration

Configure the proxy for each agent profile from the WebUI profile settings. The settings are stored in the Pi WebUI SQLite database and apply only to agent and model requests; the embedded terminal is not affected. Changes take effect on the next agent action without a restart.

## Local LLM Configuration

Open **Agent profiles → Local LLM**, choose an Ollama, LM Studio, or llama.cpp preset (or enter a custom OpenAI-compatible endpoint), and click **Connect & discover models**. Select the models to expose and save them; no API key is required. The endpoint is reached by the Pi WebUI server, so `127.0.0.1` refers to the machine running the server. The generated provider is stored in that profile's `models.json` without replacing other providers.

## Provider and Gateway Variables

Provider API keys such as `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are optional because the server uses the Pi agent's own authentication by default.

See `.env.example` for provider-specific variables and the dedicated [Feishu](feishu-gateway.md) and [WeChat](weixin-gateway.md) gateway manuals for messaging configuration.
