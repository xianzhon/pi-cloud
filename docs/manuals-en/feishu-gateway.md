# Feishu/Lark Bot Gateway Manual

This guide explains how to connect a Feishu/Lark bot to Pi WebUI so you can send messages in Feishu and receive replies from the Pi agent server.

## What this gateway does

The Feishu gateway exposes one callback endpoint:

```text
POST /api/gateways/feishu/events
```

When Feishu sends a text message event to this endpoint, Pi WebUI:

1. Parses the Feishu message.
2. Maps the Feishu chat to a persistent Pi session.
3. Sends the text to the Pi agent.
4. Replies to the original Feishu message with the final assistant response.

Each Feishu chat gets its own Pi session. Send `/new` or `/reset` in Feishu to start a fresh Pi session for that chat.

## Current MVP limitations

Supported now:

- Text messages
- Feishu URL verification callback
- Optional verification token check
- Feishu chat to Pi session binding
- `/new` and `/reset`

Not supported yet:

- Feishu persistent-connection callback mode
- Images, files, audio, or video
- Audio transcription. Feishu audio receive-message events currently provide only audio metadata such as `duration` and `file_key`; they do not include client-side speech-to-text transcript text.
- Interactive cards
- Per-user allowlists in group chats

## 1. Configure Pi WebUI environment

Add these variables to the project `.env` file:

```env
PI_WEBUI_FEISHU_APP_ID=cli_xxx
PI_WEBUI_FEISHU_APP_SECRET=your-app-secret
PI_WEBUI_FEISHU_DOMAIN=feishu
# Optional, only if configured in Feishu event subscription security settings:
# PI_WEBUI_FEISHU_VERIFICATION_TOKEN=your-verification-token
# Required if Feishu's encryption strategy is enabled:
# PI_WEBUI_FEISHU_ENCRYPT_KEY=your-encrypt-key
```

Notes:

- Use `PI_WEBUI_FEISHU_DOMAIN=feishu` for China Feishu.
- Use `PI_WEBUI_FEISHU_DOMAIN=lark` for international Lark.
- Configure the allowed folders, default gateway profile, model, and skillset in **Settings > Gateway**.
- Restart the Pi WebUI server after changing `.env`.

## 2. Make the callback URL reachable by Feishu

Feishu must be able to reach your Pi WebUI server from the public internet.

If your backend runs on port `3200`, the callback URL should look like:

```text
https://your-public-domain/api/gateways/feishu/events
```

For local-only testing, expose the backend with a tunnel such as ngrok, Cloudflare Tunnel, or a reverse proxy with HTTPS.

If using nginx, proxy this path to the backend server, for example:

```nginx
location /api/gateways/feishu/events {
    proxy_pass http://127.0.0.1:3200;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 3. Configure the Feishu app

In the Feishu developer console:

1. Open your app.
2. Ensure bot capability is enabled.
3. Add the bot to the target chat, or allow users to message the bot directly.
4. Go to event subscription settings.
5. Choose **Send callbacks to developer's server** as the subscription mode. The current Pi WebUI gateway uses Feishu's HTTP callback mode, not **Receive callbacks through persistent connection**.
6. Set the request URL to:

   ```text
   https://your-public-domain/api/gateways/feishu/events
   ```

7. Subscribe to the receive-message event:

   ```text
   im.message.receive_v1
   ```

8. If you configure a verification token in Feishu, set the same value in:

   ```env
   PI_WEBUI_FEISHU_VERIFICATION_TOKEN=...
   ```

9. If Feishu's encryption strategy is enabled, set the Encrypt Key in:

   ```env
   PI_WEBUI_FEISHU_ENCRYPT_KEY=...
   ```

10. Save the event subscription. Feishu should call the URL verification endpoint and receive the expected `challenge` response.

## 4. Required Feishu permissions

The app needs permissions for:

- Receiving messages/events
- Sending messages or replying to messages

The exact permission names vary between Feishu/Lark console versions. Search for IM message receive/send/reply permissions and publish the app permission change if Feishu requires it.

## 5. Use the bot

After the server is restarted and Feishu event subscription is active:

1. Send a direct message to the Feishu bot, or mention it in a chat where the bot is installed.
2. The server creates or resumes a Pi session for that Feishu chat.
3. The bot replies when the Pi agent finishes.

Commands:

```text
/status
/help
/profiles
/profile <profile-id>
/cwd [absolute-path]
/skillsets
/skillset <all|preset-name>
/reset
/new
/clear-config
```

Notes:

- `/status` shows the current Feishu chat profile, work directory, profile default model, skillset, and session state.
- `/profiles` and `/skillsets` list valid choices for the current configuration.
- `/profile`, `/cwd`, and `/skillset` persist settings for this Feishu chat/thread and start a fresh Pi session.
- `/skillset all` uses all available skills. Other skillsets such as `least` or `debug` are Web-configured skill presets.
- `/clear-config` removes this chat's overrides and returns to the `PI_WEBUI_FEISHU_*` environment defaults.
- `/new` and `/reset` dispose the current in-memory Pi session for that Feishu chat and bind the next message to a fresh Pi session.

## Troubleshooting

### Feishu URL verification fails

Check:

- The public URL is HTTPS and reachable by Feishu.
- The backend server is running.
- The reverse proxy forwards `POST /api/gateways/feishu/events` to the backend.
- `PI_WEBUI_FEISHU_VERIFICATION_TOKEN` matches Feishu if a token is configured.
- `PI_WEBUI_FEISHU_ENCRYPT_KEY` matches Feishu if encrypted callbacks are enabled.

### Bot receives audio messages but ignores them

Audio messages are currently unsupported. Server logs may show an unsupported inbound message like:

```text
[feishu-gateway] unsupported inbound message ... messageType: 'audio' ... contentKeys: [ 'duration', 'file_key' ]
```

This means Feishu provided audio metadata but no speech-to-text transcript. Supporting audio would require downloading the audio by `file_key` and running a separate transcription/ASR step before sending text to Pi.

### Bot receives messages but does not reply

Check server logs for `[feishu-gateway]` errors. Common causes:

- Missing Feishu send/reply permission.
- Invalid `PI_WEBUI_FEISHU_APP_ID` or `PI_WEBUI_FEISHU_APP_SECRET`.
- The Pi agent profile or Web-configured default model is invalid.
- No allowed gateway folder is configured, or the selected folder does not exist or is not accessible.

### Messages take a long time

In **Send callbacks to developer's server** mode, the callback acknowledges Feishu quickly, but the bot only replies after the Pi agent finishes. Long-running tool use can delay the Feishu reply.

### Existing Hermes Feishu bot credentials

If you already have a working Hermes Feishu bot, you can reuse the same Feishu app credentials by copying:

```text
FEISHU_APP_ID      -> PI_WEBUI_FEISHU_APP_ID
FEISHU_APP_SECRET  -> PI_WEBUI_FEISHU_APP_SECRET
FEISHU_DOMAIN      -> PI_WEBUI_FEISHU_DOMAIN
```

Do not commit `.env` because it contains secrets.
