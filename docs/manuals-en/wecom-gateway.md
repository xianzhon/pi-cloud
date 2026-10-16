# WeCom Gateway

The WeCom gateway connects Pi Cloud to organization members through a self-built WeCom application. This version supports text messages, image messages, voice messages, and slash commands. Voice messages require Pi Cloud's speech-to-text service to be configured.

## Setup

1. Open the [WeCom administration console](https://work.weixin.qq.com/wework_admin/frame#apps), create or select a self-built application, and note its Corp ID, Agent ID, and Secret.
2. In Pi Cloud, open **Settings > Gateway > WeCom self-built app**. Enter those values and a comma-separated allowlist of member User IDs. Use `*` only if every member who can see the application may use it.
3. Select **Save and generate callback**. Copy the displayed callback URL, Token, and EncodingAESKey.
4. In the application's administration page, open **Features (功能) > Receive Messages (接收消息) > Set API Receiving (设置 API 接收)**. Paste all three callback values and save. The Pi Cloud status changes to **Callback verified** after WeCom verifies or delivers a callback.
5. Add Pi Cloud's outbound server IP to the application's trusted IP list if WeCom requires it, then use **Test connection**.

Pi Cloud must be reachable from WeCom over public HTTPS. The callback endpoint is `/api/gateways/wecom/callback`. Callback requests are signature-checked and AES-decrypted before processing. Gateway users can run the coding agent's tools on the Pi Cloud host, so access is denied by default: an empty member allowlist rejects every member. Rejected members receive a reply containing their User ID so an administrator can add them.

The gateway uses the profile, model, skillset, and allowed folders configured under **Gateway defaults**. In WeCom, send `/help` to list commands such as `/new`, `/status`, `/profile`, `/cwd`, and `/skillset`.

For a voice message, Pi Cloud downloads the AMR media from WeCom, sends it to the configured OpenAI-compatible speech-to-text endpoint, and sends only the resulting text to the coding agent. Configure the `PI_CLOUD_STT_*` variables described in [Configuration](configuration.md#voice-dictation). If transcription is unavailable or fails, the gateway replies with an error instead of sending an empty prompt.

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

Start a text or existing voice-transcription instruction with `小助理`, for example `小助理 start a new conversation`, `小助理 which project am I in?`, or `小助理 switch the working directory to pi-cloud`. Customize the prefix with `PI_CLOUD_GATEWAY_COMMAND_PREFIX`.

- Supported actions: start a new conversation, show status/help, or switch an allowed directory, Profile, or skillset. Only one action is accepted per message; configuration switches retain the existing session-reset behavior.
- Interpretation uses the gateway model, otherwise the selected Profile's default model (or the first available model if no default is configured). This is a separate, billable model request without chat history or tools.
- Targets must match configured choices. Ambiguous, unsupported, or multi-action requests are not executed. Resend a complete, prefixed instruction rather than replying with just an option name.
- Model errors or timeouts do not execute actions or fall through to normal chat. Existing `/commands` bypass the model; other messages remain ordinary chat. Voice transcription support is unchanged.

## Environment-managed setup

The UI setup is recommended. For managed deployments, configure `PI_CLOUD_WECOM_CORP_ID`, `PI_CLOUD_WECOM_CORP_SECRET`, `PI_CLOUD_WECOM_AGENT_ID`, `PI_CLOUD_WECOM_CALLBACK_TOKEN`, `PI_CLOUD_WECOM_ENCODING_AES_KEY`, and `PI_CLOUD_WECOM_ALLOWED_USERS` (comma-separated User IDs, or `*`). Environment values override saved UI configuration and make the connection read-only in Settings. See `.env.example` for the exact format.

Treat the application Secret, callback Token, and EncodingAESKey as credentials. UI-saved values are encrypted in SQLite using Pi Cloud's credential encryption key. Restrict access to the database, credential key, and environment files.
