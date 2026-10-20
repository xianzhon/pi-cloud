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
| `PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY` | Generated key file | Base64-encoded 32-byte key used to encrypt credentials stored in SQLite |
| `PI_CLOUD_ALLOWED_ROOTS` | User home directory | Comma-separated directories the file browser and terminal may access |
| `PI_CLOUD_DISABLE_PATH_CHECK` | `false` | Disable allowed-root checks for file, terminal cwd, and Git API paths |
| `PI_CLOUD_ENABLE_SYSTEM_OPEN` | `false` | Enable **Open with system tool** through non-localhost URLs, such as a local nginx hostname |
| `PI_CLOUD_TERMINAL_SHELL` | `COMSPEC`/`cmd.exe` on Windows; `SHELL`/`bash` on macOS/Linux | Terminal shell executable, such as `powershell.exe`, `pwsh.exe`, or `/bin/zsh` |
| `PI_CLOUD_LOOP_DETECTION_THRESHOLD` | `5` | Stop an agent run after this many consecutive identical tool calls; `0` disables loop detection |

**Open with system tool** is automatically available through `localhost`, `127.0.0.1`, `::1`, and `*.localhost`. Set `PI_CLOUD_ENABLE_SYSTEM_OPEN=true` when accessing the same local machine through a custom reverse-proxy hostname. The action launches an application on the machine running Pi Cloud, so enable it only for trusted local deployments. Restart the server after changing this setting.

TOTP secrets, GitHub/Gitea tokens, and gateway credentials are encrypted in SQLite with AES-256-GCM. If `PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY` is unset, Pi Cloud creates `<database-path>.credentials.key` with owner-only permissions. Generate an environment-managed key with `openssl rand -base64 32`. Configure it before saving credentials, do not change it while encrypted credentials exist, and back it up separately from the database. Losing the key makes those credentials unrecoverable. Existing plaintext credentials are encrypted automatically on the next startup.

When `PI_CLOUD_DISABLE_PATH_CHECK=true`, `PI_CLOUD_ALLOWED_ROOTS` is ignored. The checks are enabled by default on every platform. On Windows, list additional drives or folders explicitly, for example `PI_CLOUD_ALLOWED_ROOTS=C:\Users\you,D:\Projects`. Disabling the check allows WebUI filesystem endpoints to access any path permitted to the server process, so use it only in a trusted deployment.

The CLI equivalents for the common server options are:

```bash
pi-cloud --port 8080
pi-cloud --hostname 0.0.0.0 --no-open
```

## Chat details and mobile bandwidth

**Chat → View options → Details** is off by default and saved in this browser only. For Pi Cloud agent chats, leaving it off omits tool arguments, tool results, thinking content, and command activity from live delivery and loaded history. Answers, lightweight status signals, errors, and completion notifications still arrive. The agent continues using the full session on the server.

Enable Details to load the full history and receive future details. If a run is in progress, new details arrive immediately; earlier details load after the run finishes to avoid interrupting the streamed answer. Disabling Details stops future detail delivery and cancels outstanding history downloads. Mobile and desktop browsers can use different settings.

## Shared skills

In **Settings → Shared skills**, add a skill by entering a lowercase hyphenated name and a `SKILL.md` containing matching `name` and nonempty `description` frontmatter. You can edit its `SKILL.md` later without changing other files. Alternatively, clone an HTTPS GitHub repository containing a root `SKILL.md`, or a skill subdirectory using `https://github.com/owner/repo/tree/branch/path/to/skill` (single-segment branch names). The destination name must match the skill's frontmatter name. Clone never overwrites an existing skill and reports failures without retaining a partial copy.

Managed skills are stored in `~/.agents/skills/` on the server, shared across agent profiles. Pi discovers them along with project and profile skills in the existing skill picker and presets; existing presets are not modified. Review third-party instructions and scripts before selecting them. A running session may need to be restarted to load a new or updated skill.

## Sessions and Security

| Variable | Default | Description |
|---|---|---|
| `PI_CLOUD_SESSION_TTL_HOURS` | `8` | Session idle timeout and renewal window in hours |
| `PI_CLOUD_SESSION_MAX_HOURS` | `720` | Maximum session lifetime, including renewals, in hours |
| `PI_CLOUD_COOKIE_SECURE` | `false` | Restrict the session cookie to HTTPS connections; automatically enabled for an HTTPS passkey origin |
| `PI_CLOUD_PASSKEY_ORIGIN` | unset | Enable passkeys for this exact HTTPS origin, or `http://localhost:<port>` in development; no trailing slash |
| `PI_CLOUD_TRUST_PROXY` | `false` | Trust one reverse proxy: use the last `X-Forwarded-For` hop as the client address and accept a `Host` header without the external port |
| `SKIP_2FA_VERIFY` | `false` | Emergency TOTP bypass for login and password-confirmed recovery actions; keep disabled during normal operation |

When exposing Pi Cloud on a network, use HTTPS through a trusted reverse proxy and keep authentication enabled. Set `PI_CLOUD_TRUST_PROXY=true` and `PI_CLOUD_COOKIE_SECURE=true` when deployed behind HTTPS as described in the [deployment manual](deployment.md#reverse-proxy-nginx).

Browser requests that change state, and all WebSocket connections, must come from the same origin (scheme, host, and port) as the `Host` header. Pages served from another port on the same machine are rejected. After startup, Pi Cloud removes its own secrets (authentication password, credential key, gateway, and speech API secrets) from the environment inherited by terminals, agent tools, MCP servers, and Git.

### Passkey login

Set `PI_CLOUD_PASSKEY_ORIGIN=https://pi.example.com` and restart, then access that exact origin. The RP ID is its hostname, not a parent domain. For development use `http://localhost:5173` (not `127.0.0.1`). Unset the variable to disable passkeys. An HTTPS origin also enables secure session cookies, so use HTTPS for all logins.

Log in normally and open **Settings → Security → Passkeys** to add a named credential. Adding and deleting keys requires the current password and TOTP if enabled, even in `SKIP_2FA_VERIFY` recovery mode. The login page offers **Sign in with a passkey**; this is an independent login method requiring device/provider user verification, without an additional password or TOTP. Bitwarden, platform authenticators, and compatible security keys work through standard WebAuthn.

Only public keys and credential metadata are stored in SQLite. Keep password + TOTP or a spare passkey as a recovery method. Credentials are scoped to the configured username and RP ID; changing either does not transfer credentials. Register separate keys for development and production. Pending challenges expire after five minutes and are invalidated by a server restart.

## Memory Policy

`PI_CLOUD_MEMORY_POLICY` controls memory extraction and recall. The adaptive lexical policy is enabled by default. To temporarily roll back to the legacy policy:

```env
PI_CLOUD_MEMORY_POLICY=legacy
```

Restart the server after changing this setting.

## Profile Extension Packages

Open **Agent profiles → Extensions** to enable or disable the extensions supplied by each package in the profile's `settings.json`. For example, uncheck `npm:pi-subagents` to disable delegation while leaving `npm:pi-mcp-adapter` enabled. Changes save immediately and apply to new or reopened sessions, including CLI Pi using the same profile; already-running sessions are unchanged.

This uses Pi's native package filter: a disabled entry becomes `{ "source": "npm:pi-subagents", "extensions": [] }`. Packages stay installed, and their skills, prompts, and themes retain their existing settings. Existing extension filters are saved in the entry's `piCloudExtensionFilters` field and restored when re-enabled. These toggles cover profile package declarations, not standalone extension files or project-level package overrides.

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

## Text-to-Speech

Pi Cloud can generate audio through an OpenAI-compatible `/audio/speech` service. For a local MLX Audio server, configure:

```env
PI_CLOUD_TTS_BASE_URL=http://127.0.0.1:28081/v1
PI_CLOUD_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
PI_CLOUD_TTS_VOICE=Vivian
PI_CLOUD_TTS_LANGUAGE=Chinese
PI_CLOUD_TTS_FORMAT=wav
```

Only `PI_CLOUD_TTS_BASE_URL` is required to enable the controls. Local endpoints do not require a key; set `PI_CLOUD_TTS_API_KEY` when the provider requires bearer authentication. For mixed Chinese/English replies, Qwen3-TTS 0.6B CustomVoice with `Vivian` is recommended. The format defaults to WAV. `PI_CLOUD_TTS_LANGUAGE` is optional. Restart Pi Cloud after changing these variables.

Completed assistant text replies provide play, stop, and replay controls. **Settings → Chat → Read assistant replies aloud** can automatically synthesize a reply after its `agent_end` completion event; this preference is disabled by default so long coding responses are not spoken unexpectedly. Pi Cloud sends the completed text only once, never individual streaming deltas.

A local MLX Audio service can be installed with Python 3.12 and `uv pip install "mlx-audio[tts,server]" "misaki[zh]"`, then started with `make -C local-tts start` on port `28081`. WAV avoids MLX Audio's `ffmpeg` requirement for compressed output formats.

## Provider and Gateway Variables

Provider API keys such as `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are optional because the server uses the Pi agent's own authentication by default.

See `.env.example` for provider-specific variables and the dedicated [Feishu](feishu-gateway.md), [WeCom](wecom-gateway.md), and [WeChat](weixin-gateway.md) gateway manuals for messaging configuration.

## MCP servers and permissions

MCP support uses the `pi-mcp-adapter` extension installed in each agent profile. Install it with `pi install npm:pi-mcp-adapter` in the intended Pi agent directory (`PI_CODING_AGENT_DIR`), then create or resume a Pi Cloud session. Pi Cloud does not install third-party executable packages automatically.

Open **Settings → MCP** and select an agent profile using the searchable selector. Each server has an enable/disable switch, connection status, and configuration source. Tool names and descriptions are available in a read-only list, collapsed by default. **Discover / refresh tools** explicitly starts a temporary adapter session, connects to the chosen server, refreshes its tool cache, and disposes the temporary session. This requires the adapter's `mcp` proxy tool; direct-only configurations with `disableProxyTool: true` must enable the proxy to use this action. OAuth servers may require authentication through Pi first. Cached inventories can be stale; stale or unknown tool identities cannot be called until discovered again.

Use **Add MCP server** or **Edit server** to open the connection editor. Choose **Local command** and enter the command and arguments (one argument per line), or choose **HTTP server** and enter its URL. **Advanced settings** contains working directory, environment variables/HTTP headers, and additional JSON options. Existing secret values stay hidden; adding values updates or extends them without removing stored values. For example, a local connection corresponds to:

```json
{ "command": "npx", "args": ["-y", "your-mcp-server"] }
```

Or, for HTTP:

```json
{ "url": "https://example.com/mcp" }
```

MCP commands execute on the **backend**, with its operating-system permissions. Only configure trusted commands and endpoints. Optional `cwd` and project paths must satisfy Pi Cloud's allowed-root checks, including symlinks and environment-variable expansion. Prefer `${VARIABLE}` references in `env`/`headers` or `bearerTokenEnv` over inline credentials. Stored `env`, headers, bearer tokens, and OAuth settings are not returned to the browser and are preserved when editing the displayed connection fields. Avoid putting secrets in command arguments or URL query strings.

Pi Cloud writes server entries only to `<profile>/mcp.json`, preserving unrelated settings. Effective precedence remains shared global config → profile config → project `.mcp.json` → project `.pi/mcp.json`. Shared global/imported servers can receive a profile override. Project overrides are read-only in this panel: edit their source file instead. Removing a **profile entry** may reveal a shared definition of the same server; it does not delete shared or project files. Saving a change to only a server's inline `bearerToken` in this panel automatically reloads affected idle sessions' extensions and MCP connections, preserving conversation history; no backend restart is needed. Other connection configuration changes still require a fresh session runtime. Changes to `bearerTokenEnv` or the backend's environment are not hot-reloaded. Permission changes affect loaded sessions immediately when idle.

Server switches control **permission**, not direct/proxy exposure. Disabling a server blocks its tools through both the gateway and direct calls, removes its direct tools from the model's active tool list, and blocks explicit gateway connection requests. The server restriction also applies to tools discovered later, without enumerating individual tool permissions. Re-enabling a server preserves existing adapter exclusions and legacy per-tool restrictions. Tool lists have no permission checkboxes.

Type **`/mcp`** in chat to open the current session's MCP panel without sending a model prompt. Session settings can only further restrict profile-enabled servers. They cannot re-enable profile-disabled servers. Restrictions persist across resume and are isolated by profile and session. Pi Cloud stores permissions in `<profile>/pi-cloud-mcp.json`; this does not rewrite shared adapter configuration. Changes are rejected while an affected session is streaming. Permission restrictions do not prevent adapter eager/keep-alive connections from starting, and they are not an operating-system sandbox.
