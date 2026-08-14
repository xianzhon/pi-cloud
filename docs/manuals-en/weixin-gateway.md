# WeChat Gateway Manual

This guide explains how to connect a WeChat iLink bot account to Pi WebUI so you can send WeChat messages and receive replies from the Pi agent server.

## What this gateway does

The WeChat gateway uses Tencent iLink bot APIs. Unlike the Feishu gateway, it does not expose a public webhook callback. Pi WebUI starts a background poller that:

1. Polls iLink for new WeChat messages.
2. Maps each WeChat direct-message chat to a persistent Pi session.
3. Sends the message text to the Pi agent.
4. Sends the final assistant response back to the same WeChat chat.

Each WeChat direct-message chat gets its own Pi session. Send `/new` or `/reset` in WeChat to start a fresh Pi session for that chat.

## Current support and limitations

Supported now:

- Direct-message text messages.
- Direct-message image messages when iLink exposes inline image data or a downloadable image URL, and the selected gateway model supports image input.
- Direct-message voice messages when iLink provides `voice_item.text` speech-recognition text.
- QR-code pairing from the Web UI settings page.
- Reusing previously saved pairing credentials.
- WeChat chat to Pi session binding.
- Per-chat profile, working-directory, and skillset commands.

Not supported yet:

- WeChat group chats. The gateway intentionally ignores groups for now because iLink group delivery is unreliable in the current implementation.
- Files, stickers, and video.
- Image messages whose iLink payload shape does not expose inline image data or a downloadable image URL. The server logs unsupported media item shapes to help expand parser support.
- Bot-side audio download and transcription. Voice support depends on iLink/WeChat providing recognized text.
- Multiple WeChat bot accounts in one Pi WebUI server.

## 1. Configure Pi WebUI environment

Add these variables to the project `.env` file:

```env
PI_WEBUI_WECHAT_GATEWAY_ENABLED=true

# Optional direct-message access policy:
# PI_WEBUI_WECHAT_DM_POLICY=pairing
# PI_WEBUI_WECHAT_ALLOWED_USERS=

# Optional, normally not needed:
# PI_WEBUI_WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
```

Notes:

- `PI_WEBUI_WECHAT_GATEWAY_ENABLED=true` is required. Pairing alone saves credentials, but the poller starts only when the gateway is enabled.
- Configure the allowed folders, default gateway profile, model, and skillset in **Settings > Gateway**.
- Restart the Pi WebUI server after changing `.env`.

## 2. Pair the WeChat bot account

1. Open Pi WebUI in the browser.
2. Open **Settings**.
3. Find **WeChat pairing**.
4. Click **Start QR pairing**.
5. Scan the QR code with WeChat.
6. Confirm the login/pairing prompt on your phone.
7. Wait until the Web UI shows the pairing as confirmed.

After confirmation, Pi WebUI saves the iLink account credentials in its local database. You do not normally need to manually set `PI_WEBUI_WECHAT_ACCOUNT_ID` or `PI_WEBUI_WECHAT_TOKEN`.

If you already have credentials from another working setup, you can also provide them explicitly:

```env
PI_WEBUI_WECHAT_ACCOUNT_ID=your-ilink-bot-account-id
PI_WEBUI_WECHAT_TOKEN=your-ilink-bot-token
PI_WEBUI_WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
```

Environment variables take precedence over saved pairing credentials.

## 3. Start using the bot

After the server is restarted and the gateway is enabled:

1. Send a direct text message to the paired WeChat bot account.
2. The server creates or resumes a Pi session for that WeChat chat.
3. The bot replies when the Pi agent finishes.

Voice messages also work when WeChat/iLink includes speech-recognition text in `voice_item.text`. In that case Pi WebUI sends the recognized text to the agent exactly like a typed message.

## Commands

Send these commands in the WeChat chat:

```text
/status
/help
/profiles
/profile <profile-id>
/cwds
/cwd [absolute-path]
/skillsets
/skillset <all|preset-name>
/reset
/new
/clear-config
```

Notes:

- `/status` shows the current WeChat chat profile, work directory, profile default model, skillset, and session state.
- `/profiles`, `/cwds`, and `/skillsets` list valid choices for the current configuration.
- `/profile`, `/cwd`, and `/skillset` persist settings for this WeChat chat and start a fresh Pi session.
- `/skillset all` uses all available skills. Other skillsets such as `least`, `least-skills`, or `debug` are Web-configured skill presets.
- `/clear-config` removes this chat's overrides and returns to the `PI_WEBUI_WECHAT_*` environment defaults.
- `/new` and `/reset` dispose the current in-memory Pi session for that WeChat chat and bind the next message to a fresh Pi session.

## Direct-message access policy

`PI_WEBUI_WECHAT_DM_POLICY` controls who can talk to the bot:

| Value | Behavior |
| --- | --- |
| `pairing` | Default. Accept inbound direct messages. Useful while setting up and discovering sender IDs. |
| `allowlist` | Accept only users listed in `PI_WEBUI_WECHAT_ALLOWED_USERS`. |
| `open` | Accept all users only if `PI_WEBUI_WECHAT_ALLOW_ALL_USERS=true` or `GATEWAY_ALLOW_ALL_USERS=true` is also set. |
| `disabled` | Ignore all direct messages. |

For allowlist mode:

```env
PI_WEBUI_WECHAT_DM_POLICY=allowlist
PI_WEBUI_WECHAT_ALLOWED_USERS=user-id-1,user-id-2
```

Use server logs or `/status` during pairing-mode testing to identify sender IDs before tightening the policy.

## Network notes

The gateway makes outbound requests to:

```text
https://ilinkai.weixin.qq.com
```

No public inbound URL is required.

If the server cannot connect to iLink, check whether proxy environment variables are affecting the server process. For WeChat/iLink, prefer direct connectivity or set an appropriate `NO_PROXY`/proxy configuration for the server environment.

## Troubleshooting

### The settings page says paired, but WeChat shows “暂无法连接”

Check server logs for `[weixin-gateway]` errors. A healthy startup should include a line like:

```text
[weixin-gateway] started
```

Common causes:

- `PI_WEBUI_WECHAT_GATEWAY_ENABLED` is not `true`.
- The server was not restarted after changing `.env`.
- The saved pairing credentials are stale; pair again from Settings.
- The server cannot reach `https://ilinkai.weixin.qq.com`.
- Proxy settings are breaking iLink requests.

### Polling fails with `invalid content-length header`

Use a build that lets `fetch` calculate `Content-Length` for iLink POST requests. Manually setting `content-length` can be rejected by `undici/fetch` before the request is sent.

### Text messages work, but voice messages do not

Voice support depends on WeChat/iLink returning recognized text in `voice_item.text`.

Check server logs for:

```text
[weixin-gateway] unsupported inbound message
```

If the logged `voice_item` has a `text` field but it is empty, WeChat/iLink did not provide transcription for that voice message. Pi WebUI does not currently download audio and run its own ASR.

### The bot receives messages but does not reply

Check server logs for `[weixin-gateway] message handling failed` or `sendmessage failed`. Common causes:

- The Pi agent profile or profile default model is invalid.
- No allowed gateway folder is configured, or the selected folder does not exist or is not accessible.
- The assistant response is delayed by long-running tool use.
- The iLink token expired or was revoked; pair again.

### Commands changed profile or cwd, but old context remains

Commands that change chat configuration reset the mapped Pi session. If behavior still looks stale, send:

```text
/reset
```

Then send the next normal message.

## Security notes

- Do not commit `.env`; it may contain gateway credentials.
- Saved WeChat pairing credentials are stored in the local Pi WebUI database.
- Restrict direct-message access with `PI_WEBUI_WECHAT_DM_POLICY=allowlist` once setup is complete if the bot account is reachable by users you do not trust.
