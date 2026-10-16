# Feishu/Lark Bot Gateway Manual

This guide explains how to connect a Feishu/Lark bot to Pi Cloud so you can send messages in Feishu and receive replies from the Pi agent server.

## What this gateway does

The Feishu gateway exposes one callback endpoint:

```text
POST /api/gateways/feishu/events
```

When Feishu sends a text message event to this endpoint, Pi Cloud:

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
- Sender allowlist (`PI_CLOUD_FEISHU_ALLOWED_USERS`) for direct and group messages

Not supported yet:

- Feishu persistent-connection callback mode
- Images, files, audio, or video
- Audio transcription. Feishu audio receive-message events currently provide only audio metadata such as `duration` and `file_key`; they do not include client-side speech-to-text transcript text.
- Interactive cards

## 1. Configure Pi Cloud environment

Add these variables to the project `.env` file:

```env
PI_CLOUD_FEISHU_APP_ID=cli_xxx
PI_CLOUD_FEISHU_APP_SECRET=your-app-secret
PI_CLOUD_FEISHU_DOMAIN=feishu
# Optional, only if configured in Feishu event subscription security settings:
# PI_CLOUD_FEISHU_VERIFICATION_TOKEN=your-verification-token
# Required if Feishu's encryption strategy is enabled:
# PI_CLOUD_FEISHU_ENCRYPT_KEY=your-encrypt-key
```

Then allow the Feishu users who may use the gateway:

```env
# Comma-separated open_id, user_id, or union_id values. `*` allows every sender.
PI_CLOUD_FEISHU_ALLOWED_USERS=ou_xxx
```

Notes:

- Use `PI_CLOUD_FEISHU_DOMAIN=feishu` for China Feishu.
- Use `PI_CLOUD_FEISHU_DOMAIN=lark` for international Lark.
- Configure the allowed folders, default gateway profile, model, and skillset in **Settings > Gateway**.
- Gateway users can run the coding agent's tools on the Pi Cloud host, so access is denied by default. Messages from senders not listed in `PI_CLOUD_FEISHU_ALLOWED_USERS` are ignored; the bot replies with the sender's `open_id` so you can add it.
- When `PI_CLOUD_FEISHU_ENCRYPT_KEY` is set, unencrypted callbacks are rejected.
- Restart the Pi Cloud server after changing `.env`.

## 2. Make the callback URL reachable by Feishu

Feishu must be able to reach your Pi Cloud server from the public internet.

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
5. Choose **Send callbacks to developer's server** as the subscription mode. The current Pi Cloud gateway uses Feishu's HTTP callback mode, not **Receive callbacks through persistent connection**.
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
   PI_CLOUD_FEISHU_VERIFICATION_TOKEN=...
   ```

9. If Feishu's encryption strategy is enabled, set the Encrypt Key in:

   ```env
   PI_CLOUD_FEISHU_ENCRYPT_KEY=...
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
/cwds
/cwd [number]
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
- `/clear-config` removes this chat's overrides and returns to the `PI_CLOUD_FEISHU_*` environment defaults.
- `/new` and `/reset` dispose the current in-memory Pi session for that Feishu chat and bind the next message to a fresh Pi session.

## Execution controls and task queries

```text
/stop                         # alias: /abort
/status
/task list
/task status <number-or-unique-title>
/task result <number-or-unique-title>
/task stop <number-or-unique-title>
```

- These slash controls bypass the ordinary message queue, including while the chat is running. `/status` also shows running/stopping/idle, elapsed seconds, and pending message count.
- `/stop` requests cancellation of the current chat and discards previously queued messages, preserving history and leaving independent tasks alone. Cancellation is cooperative: external tools or providers may not stop immediately. Later ordinary messages wait until the active execution actually settles.
- `/task list` lists all inbox states in the currently allowed project; the natural-language waiting-task list still lists waiting tasks only. Numbers refer to this chat's most recent task list; re-listing changes numbering, and a restart requires re-listing. Unambiguous partial titles are accepted.
- `/task status` separates durable inbox state from live execution state. `started` does not mean still running or successful; finishing execution does not automatically mark an inbox task `completed`.
- `/task result` returns the latest assistant text, excluding thinking and tool output. Long text is truncated; use the returned session ID to find the full transcript in WebUI. Persisted results remain readable after restart without resuming execution or inferring success.
- `/task stop` only stops tasks launched through the gateway in this server process. Stop WebUI/automatic-queue executions at their owning entry point. Repeated requests are safe; records are preserved and not marked completed. Retry after preparation finishes for tasks still starting.
- Natural-language task status/result/stop instructions are also supported, e.g. “小助理，查看任务 2 的结果”. They still queue behind ordinary messages; use slash controls for immediate access during execution.

## Natural-language management instructions

Start an instruction with `小助理`, for example `小助理 start a new conversation`, `小助理 which project am I in?`, or `小助理 switch the working directory to pi-cloud`. Customize the prefix with `PI_CLOUD_GATEWAY_COMMAND_PREFIX`.

- Supported actions: start a new conversation, show status/help, or switch an allowed directory, Profile, or skillset. Only one action is accepted per message; configuration switches retain the existing session-reset behavior.
- Interpretation uses the gateway model, otherwise the selected Profile's default model (or the first available model if no default is configured). This is a separate, billable model request without chat history or tools.
- Targets must match configured choices. Ambiguous, unsupported, or multi-action requests are not executed. Resend a complete, prefixed instruction rather than replying with just an option name.
- Model errors or timeouts do not execute actions or fall through to normal chat. Existing `/commands` bypass the model; other messages remain ordinary chat.
- This feature interprets text, not audio. Feishu audio messages remain unsupported.

## Troubleshooting

### Feishu URL verification fails

Check:

- The public URL is HTTPS and reachable by Feishu.
- The backend server is running.
- The reverse proxy forwards `POST /api/gateways/feishu/events` to the backend.
- `PI_CLOUD_FEISHU_VERIFICATION_TOKEN` matches Feishu if a token is configured.
- `PI_CLOUD_FEISHU_ENCRYPT_KEY` matches Feishu if encrypted callbacks are enabled.

### Bot receives audio messages but ignores them

Audio messages are currently unsupported. Server logs may show an unsupported inbound message like:

```text
[feishu-gateway] unsupported inbound message ... messageType: 'audio' ... contentKeys: [ 'duration', 'file_key' ]
```

This means Feishu provided audio metadata but no speech-to-text transcript. Supporting audio would require downloading the audio by `file_key` and running a separate transcription/ASR step before sending text to Pi.

### Bot receives messages but does not reply

Check server logs for `[feishu-gateway]` errors. Common causes:

- Missing Feishu send/reply permission.
- Invalid `PI_CLOUD_FEISHU_APP_ID` or `PI_CLOUD_FEISHU_APP_SECRET`.
- The Pi agent profile or Web-configured default model is invalid.
- No allowed gateway folder is configured, or the selected folder does not exist or is not accessible.

### Messages take a long time

In **Send callbacks to developer's server** mode, the callback acknowledges Feishu quickly, but the bot only replies after the Pi agent finishes. Long-running tool use can delay the Feishu reply.

### Existing Hermes Feishu bot credentials

If you already have a working Hermes Feishu bot, you can reuse the same Feishu app credentials by copying:

```text
FEISHU_APP_ID      -> PI_CLOUD_FEISHU_APP_ID
FEISHU_APP_SECRET  -> PI_CLOUD_FEISHU_APP_SECRET
FEISHU_DOMAIN      -> PI_CLOUD_FEISHU_DOMAIN
```

Do not commit `.env` because it contains secrets.
