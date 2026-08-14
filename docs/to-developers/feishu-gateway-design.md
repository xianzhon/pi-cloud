# Feishu Gateway Design

## Goal

Add Feishu/Lark as a messaging gateway so a Feishu bot can talk to the Pi WebUI server. Each Feishu chat maps to a persistent Pi agent session, letting users continue a conversation from Feishu without opening the browser UI.

## Prior art: Hermes gateway

Hermes implements Feishu as a platform adapter that:

1. Receives Feishu bot events by WebSocket or webhook.
2. Normalizes each event into a platform-neutral message event.
3. Builds a deterministic session key from `platform`, `chat_id`, `chat_type`, `thread_id`, and user identity.
4. Serializes work per session key so concurrent messages do not corrupt conversation state.
5. Runs the agent and routes the final response back through Feishu.

Pi WebUI can use the same core idea, but the implementation should integrate directly with `sessionService` instead of copying Hermes' full platform framework.

## MVP scope

The initial Pi WebUI Feishu gateway supports:

- Feishu event callback URL verification.
- `im.message.receive_v1` text messages.
- Verification-token validation when configured.
- In-memory event de-duplication by Feishu `event_id` / `message_id`.
- One Pi session per Feishu conversation key.
- Per-conversation serialization.
- Sending the final assistant text response back to Feishu.
- `/new` or `/reset` command to dispose the current Pi session for that Feishu chat.

Out of scope for MVP:

- Feishu encrypted webhook payloads.
- Feishu WebSocket long-connection mode.
- Images/files/audio/video.
- Interactive cards.
- Persistent dedup state across server restarts.
- Browser UI settings panel.

These can be added later without changing the session-binding model.

## Configuration

Use Pi WebUI-specific environment variables to avoid accidental coupling to an existing Hermes installation:

| Variable | Purpose |
| --- | --- |
| `PI_WEBUI_FEISHU_APP_ID` | Feishu/Lark app id. |
| `PI_WEBUI_FEISHU_APP_SECRET` | Feishu/Lark app secret. |
| `PI_WEBUI_FEISHU_VERIFICATION_TOKEN` | Optional callback verification token. |
| `PI_WEBUI_FEISHU_DOMAIN` | `feishu` or `lark`; defaults to `feishu`. |

Configure allowed folders plus the default gateway profile, model, and skillset in **Settings > Gateway**.

## HTTP route

Add a public callback route:

```text
POST /api/gateways/feishu/events
```

It must be public because Feishu cannot send the browser session cookie. The route remains safe by requiring gateway credentials and validating Feishu's verification token when configured.

## Session binding

Build a deterministic Pi WebUI `clientId` from Feishu message identity:

```text
feishu:<chat_type>:<chat_id>[:<thread_id>]
```

For MVP, group chats are shared by chat/thread rather than split per user. This matches the goal of binding a Feishu chat to a server-side chat session and avoids surprising separate conversations when several users mention the bot in the same group.

## Message flow

1. Feishu sends an event callback.
2. Server verifies challenge/token and deduplicates the event.
3. Text is extracted from `message.content`.
4. Server resolves the Feishu `clientId`.
5. A per-client promise chain serializes the turn.
6. The service creates or reuses a Pi session.
7. The text is sent to `session.prompt(...)`.
8. `message_update` `text_delta` events are collected.
9. The collected final answer is sent back to Feishu, preferably as a reply to the triggering message.

## Failure behavior

- Bad/missing credentials: route returns 503.
- Token mismatch: route returns 401.
- Duplicate event: route returns success and does not enqueue another turn.
- Agent or Feishu send failure: logged server-side; callback has already been acknowledged.

## Future improvements

- WebSocket mode with the official Feishu SDK.
- Encrypted webhook support.
- Persistent deduplication table.
- Media receive/send.
- UI settings and proxy controls.
- Group policy: require mention, allowed users, allowed chats.
- Streaming/progress updates via Feishu message edits or status reactions.
