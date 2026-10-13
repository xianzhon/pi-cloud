# AI Session Integration API

[Documentation index](../README.md) | [简体中文](../manuals-cn/integration-api.md)

Use this server-to-server API to ask a question in a new Pi Cloud session or continue an existing conversation. Sessions use the selected agent profile's model credentials, skills, extensions, memory, and configured MCP tools.

## API tokens

In **Settings → Security → API Tokens**, create a named token with an expiration date. Enter your account password and, when enabled, your TOTP code. Copy the token immediately: the full secret is shown only once. You can inspect expiration/last-use times and revoke tokens in the same panel.

Send `Authorization: Bearer pic_pat_…` on every integration request. Store the token only on your application server, not in frontend code, URLs, logs, or a repository. Use HTTPS for remote access. No new environment variables are needed in Pi Cloud.

Tokens are stored hashed and are limited to the integration endpoints below. They cannot manage account settings, create other tokens, use filesystem REST APIs, or open WebSockets—even when a browser cookie is also present. Changing the configured account username/password or recovery bypass setting invalidates existing tokens. Logging out of a browser does not revoke tokens. Expiration/revocation blocks new requests, but does not stop an already accepted run.

**A token can run AI sessions with the account's agent tools, including shell and MCP operations. This is not a filesystem sandbox or a read-only credential. Give tokens only to trusted applications.** Working directories must pass Pi Cloud's existing allowed-root checks; these checks do not sandbox agent tools.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/integration/profiles` | List profile IDs and default models |
| POST | `/api/integration/sessions` | Create a persistent session and ask its first question |
| POST | `/api/integration/sessions/:id/messages` | Ask a follow-up in an existing session |
| GET | `/api/integration/sessions/:id?agentProfileId=default` | Retrieve status and the last assistant answer |

Both POST endpoints accept `prompt` (required, nonblank, up to 200,000 characters), `agentProfileId` (defaults to `default`), and `stream` (defaults to `false`). The create endpoint also accepts `cwd` (an existing directory, default: Pi Cloud's working directory) and an optional `modelProvider`/`modelId` pair. Follow-ups retain the session's existing model and context.

Save **both `sessionId` and `agentProfileId`** in your application and send the profile ID on subsequent requests. Session IDs are resolved inside that profile, not through caller-supplied session-file paths. Sessions with persisted history can be restored after Pi Cloud restarts, including sessions originally created in the WebUI. An unused WebUI session with no persisted response is not available through the integration API.

### Create and ask

For example, set `PI_CLOUD_URL` and `PI_CLOUD_TOKEN` in your integration application's server environment (these are example client-side configuration names, not Pi Cloud server settings):

```bash
curl "$PI_CLOUD_URL/api/integration/sessions" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/notes-project","agentProfileId":"default","prompt":"Explain this note: ..."}'
```

Successful JSON responses have this shape:

```json
{
  "sessionId": "019...",
  "agentProfileId": "default",
  "model": { "provider": "openai", "id": "configured-model" },
  "isStreaming": false,
  "answer": "The assistant's final text answer"
}
```

The HTTP request waits for the entire agent run, including tool calls and automatic recovery. `answer` contains only the final assistant message's text, not thinking or tool-result payloads. An extension command that produces no assistant message returns an empty answer.

### Follow-up and MCP note updates

```bash
curl "$PI_CLOUD_URL/api/integration/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agentProfileId":"default","prompt":"Here is a further note: ... Use yuque-mcp to update document <document-id> with the revised explanation."}'
```

Configure `yuque-mcp` in the selected Pi Cloud profile/project beforehand and allow the required tools. The API inherits the same MCP setup as normal sessions; it does not accept MCP server credentials in the prompt or dynamically configure servers. Include the target note/document ID explicitly. Your application can associate one note or question with the returned session/profile pair.

## Streaming

Set `"stream": true` on either POST and consume the response as **Server-Sent Events (SSE)**. Use `fetch` or an HTTP streaming client, not browser `EventSource` (which cannot POST with a Bearer header).

```bash
curl -N "$PI_CLOUD_URL/api/integration/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agentProfileId":"default","prompt":"Expand the explanation","stream":true}'
```

Each event has `event: <name>` and `data: <JSON>`, followed by a blank line:

- `session`: session/profile/model metadata; save the session ID immediately.
- `text_delta`: `{ "delta": "..." }`, incremental assistant text.
- `tool_start`: `{ "toolCallId": "...", "toolName": "..." }`.
- `tool_end`: the same fields plus `isError`.
- `ping`: keepalive, every 15 seconds while running.
- `done`: the complete authoritative JSON response shown above.
- `error`: `{ "sessionId": "...", "error": "...", "statusCode": 502 }` (status may differ); terminal failure, with no `done`.

Streamed text can include intermediate tool turns or retries. Use `done.answer` as the final answer rather than blindly saving all deltas. Validation/authentication failures before streaming are ordinary HTTP JSON errors; after headers are sent, failures use the SSE `error` event and HTTP status remains 200.

## Errors and lifecycle

- `400`: invalid request or unknown profile.
- `401`: missing authentication or invalid/expired/revoked token.
- `403`: token-restricted operation, rejected browser origin, or working directory outside allowed roots.
- `404`: session not found in the selected profile.
- `409`: another integration request or the WebUI is already running that session; no automatic queueing.
- `502`: agent/model run failure. The response includes the session ID when creation succeeded; history may not exist if the first run failed before persistence.

Disconnecting either a JSON or SSE question request aborts its active run. It does **not** undo tool operations already performed. Reconnect with GET to inspect the last answer/status; requests are not idempotent, so do not blindly retry note-writing prompts. Idle sessions are released from memory after the normal cleanup interval and persisted history remains available. Adjust reverse-proxy/client timeouts for long tool runs and disable proxy buffering for SSE (the API also sends `X-Accel-Buffering: no`).
