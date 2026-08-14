# Changelog

All notable changes to Pi WebUI are documented here.

## [1.0.0] - 2026-07-23

### Added

- **Packaging and deployment** — install with the `pi-webui` executable, run from source, deploy behind a reverse proxy, and use Apache-2.0 licensing.
- **Authentication** — protect the WebUI with password/TOTP authentication, renewable sessions, absolute session lifetime, and production cookie settings.
- **Settings** — manage model defaults, automation model, shortcuts, gateway profiles, skillsets, Git hosting, and session launch preferences.
- **Workspace tools** — browse files, search workspace paths with `@`, edit code with Monaco, and use an embedded xterm terminal.
- **Streaming chat** — receive real-time Pi responses over WebSocket with reconnect support, thinking/details controls, and local command result messages.
- **Session management** — create, resume, rename, compact, summarize, inspect, branch, and navigate session trees from the WebUI.
- **Multi-tab support** — run independent sessions per browser tab/client.
- **Model selection** — inspect and change the active model for a session.
- **Chat composer enhancements** — attach images to chat messages, polish prompts with AI, and choose model/thinking level directly from the composer.
- **Slash commands** — use built-in commands for Git, sessions, models, skills, summaries, changelog display, and Pi-discovered skill/prompt commands.
- **Git workflows** — inspect diff/status, create branches, commit, amend, push, pull, open read-only diffs, remember branch selections per project, and generate AI branch names.
- **Git hosting workflows** — configure Git hosting, create issues and pull requests, check proxies, preserve configured repository ports, and surface pull request status in the session UI.
- **Pull request authoring** — preview pull requests, generate PR titles and descriptions, push branches, and create PRs from `/pr`.
- **Project onboarding** — clone repositories from the project picker and open projects or queued tasks in new tabs.
- **Worktree development** — create inherited worktree sessions for isolated implementation work while preserving the source session context.
- **Skill preset management** — configure enabled and disabled skills per session, refresh slash-command suggestions after changes, and use `skill:<name>` commands directly from chat.
- **Memory system** — manage project and global memories with automatic extraction, adaptive recall, recall details, and reusable remembered context.
- **Task queue and notifications** — queue project tasks, edit tasks, start pending work, track task state, and configure sound notifications.
- **Gateway integrations** — add Feishu and WeChat gateway support, including pairing, messaging, command aliases, centralized gateway settings, and WeChat image ingestion/decryption.
- **Agent proxy configuration** — configure proxy environment variables per Pi profile for model/agent traffic.
