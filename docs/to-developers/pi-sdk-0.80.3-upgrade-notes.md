# Pi SDK 0.80.3 Upgrade Notes

Upgrade date: 2026-07-05

This project upgraded `@earendil-works/pi-coding-agent` from `0.78.0` to `0.80.3` to match the installed Pi CLI version.

Source changelog: `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.3_ws@8.21.0_zod@4.4.3/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`

Published versions in this range: `0.78.1`, `0.79.0` through `0.79.10`, `0.80.1`, `0.80.2`, `0.80.3`.

Note: the changelog contains a `0.80.0` section, but npm did not list `0.80.0` as a published version when checked.

## Highlights from 0.78.1 to 0.80.3

### 0.80.3

- Added Claude Sonnet 5 support.
- Added RPC `get_entries` and `get_tree`.
- Added `./rpc-entry` export.
- Added extension `session_info_changed`.
- Added `externalEditor` and `outputPad` settings.
- Changed the default OpenAI model to `gpt-5.5`.
- Fixed many provider, compaction, session, tool, image, retry, and rendering issues.

### 0.80.2

- Changed inherited `ApiKeyCredential` format to `type: "api_key"`.
- Renamed `ExecutionEnvExecOptions` to `ShellExecOptions`.
- Fixed custom provider auth/env handling.
- Restored legacy compat stream aliases.

### 0.80.1

- Fixed Bedrock `AWS_PROFILE` endpoint resolution.
- Fixed Fireworks Anthropic-compatible custom-model handling.
- Fixed Together MiniMax M2.7 metadata.

### 0.80.0

- Added `Ctrl+J` as a default newline keybinding.
- Renamed displayed `zai` provider label.
- Moved old `@earendil-works/pi-ai` global API to `@earendil-works/pi-ai/compat`.
- Removed selective-provider `@earendil-works/pi-ai/base` and `@earendil-works/pi-agent-core/base` entrypoints.
- Fixed session names, session selector ordering, extension startup errors, provider auth, theme loading, and custom-provider credential handling.

### 0.79.10

- Added compaction event context: `reason` and `willRetry`.
- Made `pi update` install the exact checked Pi version.
- Fixed nested git repo handling in `find`.
- Fixed extension reload/session-start UI messages.
- Fixed update notification changelog links.

### 0.79.9

- Added chat-template thinking compatibility for OpenAI-compatible providers.
- Improved GLM-5.2 provider metadata.
- Fixed same-directory session switches with extensions.
- Fixed deep session branch performance.
- Fixed fuzzy `edit` preserving untouched blocks.

### 0.79.8

- Added selective provider base entry points.
- Added Mistral prompt caching.
- Added post-compaction token estimates.
- Added OpenRouter Fusion alias.
- Updated vulnerable runtime dependencies.
- Fixed compaction edge cases.

### 0.79.7

- Added automatic theme mode.
- Changed bare `pi update` to update only Pi; `pi update --all` updates packages too.
- Exported `CONFIG_DIR_NAME` and edit diff helpers.
- Added Warp inline image support.
- Fixed RPC unknown-command errors missing request IDs.

### 0.79.6

- Fixed HTTP dispatcher behavior when callers override `fetch`.
- Fixed OpenCode Go DeepSeek V4 thinking-off request payloads.

### 0.79.5

- Added provider-scoped API key environment overrides in `auth.json`.
- Added global `httpProxy` setting.
- Added Vercel AI Gateway attribution headers.
- Fixed provider metadata, auth, and streaming issues.

### 0.79.4

- Added first-run automatic theme detection.
- Added release asset SHA256 checksums.
- Fixed bash output truncation.
- Fixed signal shutdown terminal cleanup.
- Fixed extension/package install/update behavior.
- Fixed custom provider uppercase key/header literal handling.

### 0.79.3

- Fixed OpenAI GPT-5.4/GPT-5.5 and Codex context-window metadata.

### 0.79.2

- Added clearer Bedrock validation guidance.
- Added experimental first-time setup behind `PI_EXPERIMENTAL=1`.
- Fixed project trust detection.
- Fixed model metadata, prompt history, CJK wrapping, `/fork`, `/share`, `/export`, and custom fallback thinking levels.

### 0.79.1

- Added Claude Fable 5 support.
- Added prompt-template default positional args such as `${1:-7}`.
- Added `defaultProjectTrust`.
- Added extension autocomplete trigger characters.
- Added `ctx.isProjectTrusted()`.
- Fixed provider, UI, `/reload`, help/version, and ephemeral-session issues.

### 0.79.0

- Added project trust for local settings, resources, instructions, and packages.
- Added `project_trust` extension event.
- Added cache-hit visibility in the footer.
- Exported RPC extension UI types and package asset helpers.
- Fixed package exports and several TUI/session/prompt/model issues.

### 0.78.1

- Added Ant Ling and NVIDIA NIM provider setup.
- Added MiniMax-M3 support.
- Added extension `ctx.mode`.
- Added `ctx.getSystemPromptOptions()`.
- Fixed SDK embedding in bundled Node apps without adjacent `package.json`.
- Fixed HTTP timeout handling for non-Codex providers.
- Fixed large JSONL session loading/listing.

## Verification after upgrade

- `cd server && pnpm build` passed.
- `cd server && pnpm test:run` passed with 194 tests.
