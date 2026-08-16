# Changelog

All notable changes to Pi WebUI are documented here.

## [1.0.2] - 2026-08-16

### Added

- Added global and per-project prompt customization for AI-generated Git commit messages.
- Added a shallow-clone option when cloning repositories.
- Added Mermaid diagram rendering to the Markdown preview.
- Added modified-time sorting to the folder picker and file tree.
- Added `pi-webui --version` and `pi-webui -v` commands.

### Changed

- Generate the complete sample configuration with random login credentials on the first run of a global installation.
- Replaced Argon2 password hashing with Node.js's built-in scrypt implementation, removing the native Argon2 dependency.
- Added a favicon to the project website.

### Fixed

- Stop panel resize interactions when the browser window loses focus.
- Include `CHANGELOG.md` in the npm package so the changelog remains available in global installations.

## [1.0.1] - 2026-08-15

### Added

- Added a responsive GitHub Pages website with an illustrated feature guide, updated product screenshots, and automated deployment.
- Added `pi-webui service restart` support on Linux, macOS, and Windows.

### Changed

- Always use Pi WebUI's bundled session auto-rename extension instead of disabling it when an external auto-rename plugin is detected.
- Upgraded `better-sqlite3` from version 12 to 13 and removed the deprecated `prebuild-install` dependency.
- Added a GitHub social preview image and refreshed the main interface screenshots.

### Fixed

- Respect `PORT` and `HOST` values from `~/.config/pi-webui/.env` when the CLI starts Pi WebUI, while preserving explicit CLI option precedence.
- Open home-relative (`~/`) file links from chat in the editor instead of resolving them against the workspace.
- Open relative links and heading anchors within the Markdown preview instead of navigating to browser routes.
- Improved user-message link contrast and hover/focus visibility in the light theme.
- Allow the GitHub Pages workflow to enable Pages during deployment.

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
