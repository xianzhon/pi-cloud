# Changelog

All notable changes to Pi Cloud are documented here.

## [1.0.6] - 2026-08-27

### Added

- Added a paginated Git history viewer with commit metadata, change statistics, and per-file diffs.
- Added PDF previews in the editor with page navigation and zoom controls.

### Changed

- The Git changes panel now identifies non-repository folders and disables unavailable Git actions instead of showing a Git command error.

### Fixed

- Fixed published npm package dependency metadata to use resolvable versions instead of pnpm catalog references.
- Prevented the `Ctrl+E` editor shortcut from also triggering keyboard handlers on selected messages.

## [1.0.5] - 2026-08-27

### Added

- Added a Git changes panel, shown by default, with changed-file navigation, per-file diffs, and shortcuts for common Git actions.
- Added collapsible pin groups for organizing, moving, and unpinning agent-profile and review-source sessions.
- Added a project history tab with last-accessed details, session counts, and confirmed removal of saved session history without deleting project files.
- Added an option to generate commit messages from and commit only staged changes.
- Added `PI_CLOUD_ENABLE_SYSTEM_OPEN` for enabling **Open with system tool** through trusted non-localhost URLs.

### Changed

- Reduced the initial session page from 30 sessions to 10 and limited pull request status refreshes to the visible page for faster session loading.
- Lazy-load heavy interface features such as the editor, terminal, settings, memory center, and task queue.
- Local LLM endpoints outside the loopback interface must now be explicitly allowed with `PI_CLOUD_LOCAL_LLM_ALLOWED_ORIGINS`; endpoint credentials and redirects are rejected.
- Database schema updates now use tracked, transactional versioned migrations.

### Fixed

- Ensured newly created sessions use the explicitly selected agent profile.
- Improved virtual diff formatting with clearer file headers and correct multi-file navigation and line tracking.
- Hardened path validation for session relocation and project moves, and stopped the file tree from traversing symlinked directories.
- Hardened URL and rendered HTML handling, including host validation, heading sanitization, and attribute escaping.
- Open files safely on Windows without invoking a shell.

## [1.0.4] - 2026-08-23

### Added

- Added local LLM endpoint and model discovery/configuration, plus removal controls for local LLM settings and stored API keys.
- Added unified and split diff views, multi-file diff tabs and navigation, and GitHub-style diff coloring in the editor.
- Added clickable commit references in chat that open the corresponding commit diff in the editor.
- Added a resizable message input for review sessions.
- Added persistent skill preset references for queued tasks.

### Changed

- Pinned memories now default to applying only when matched to the current prompt.

### Fixed

- Enabled word wrapping for virtual diffs.
- Corrected directory sort toggle labels in the folder picker.

## [1.0.3] - 2026-08-19

### Added

- Added review-session integrations for Devin, Claude Code, and Codex, with source configuration, session search, and transcript viewing.
- Added secure HTML file previews with sandboxing and support for local page assets.
- Added new-folder creation to the folder picker.
- Added an action to move saved sessions to another folder.

### Changed

- Improved review transcript rendering, including tool-call details, patch display, output indentation, and PDF export.

### Fixed

- Wait for the chat connection before starting tasks in newly opened tabs.
- Select the correct review session from the compact session rail.
- Normalize terminal progress output before rendering tool results.
- Normalize Windows file paths across file links, the editor, and file-tree navigation.
- Prefer the `origin` remote when resolving GitHub or Gitea integrations, while falling back to other matching remotes.

## [1.0.2] - 2026-08-16

### Added

- Added global and per-project prompt customization for AI-generated Git commit messages.
- Added a shallow-clone option when cloning repositories.
- Added Mermaid diagram rendering to the Markdown preview.
- Added modified-time sorting to the folder picker and file tree.
- Added `pi-cloud --version` and `pi-cloud -v` commands.

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
- Added `pi-cloud service restart` support on Linux, macOS, and Windows.

### Changed

- Always use Pi Cloud's bundled session auto-rename extension instead of disabling it when an external auto-rename plugin is detected.
- Upgraded `better-sqlite3` from version 12 to 13 and removed the deprecated `prebuild-install` dependency.
- Added a GitHub social preview image and refreshed the main interface screenshots.

### Fixed

- Respect `PORT` and `HOST` values from `~/.config/pi-cloud/.env` when the CLI starts Pi Cloud, while preserving explicit CLI option precedence.
- Open home-relative (`~/`) file links from chat in the editor instead of resolving them against the workspace.
- Open relative links and heading anchors within the Markdown preview instead of navigating to browser routes.
- Improved user-message link contrast and hover/focus visibility in the light theme.
- Allow the GitHub Pages workflow to enable Pages during deployment.

## [1.0.0] - 2026-07-23

### Added

- **Packaging and deployment** — install with the `pi-cloud` executable, run from source, deploy behind a reverse proxy, and use Apache-2.0 licensing.
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
