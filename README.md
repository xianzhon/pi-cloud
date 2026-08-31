# Pi Cloud

English | [简体中文](README.zh-CN.md)

A web-based, mobile-friendly interface for the [Pi coding agent](http://pi.dev). It complements the terminal-first CLI with a persistent workspace for agent sessions and development workflows.

| Dark theme                                                                    | Light theme                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ![Pi Cloud main window in dark theme](docs/images/main-window-dark-theme.png) | ![Pi Cloud main window in light theme](docs/images/main-window-white-theme.png) |

**[▶ Watch Pi Cloud handle a Git bugfix workflow](https://xianzhon.github.io/pi-cloud-website/assets/videos/demo-git-bugfix-workflow.mp4)**

## Features

- **Mobile-friendly access** — use Pi from a desktop, phone, or tablet without needing a local terminal.
- **Skill control** — configure presets and enable or disable skills per session.
- **Session management** — search, resume, rename, branch, and run independent sessions in separate tabs.
- **Task queue** — save and configure tasks, then start them when ready.
- **Completion notifications** — receive a sound alert and see a bell indicator in the browser tab when a task finishes.
- **AI-assisted writing** — generate or polish prompts, commit messages, pull request content, and other workflow text.
- **Git workflows** — use `/branch`, `/commit`, `/push`, and related commands from the WebUI.
- **GitHub and Gitea integration** — review changes and create pull requests with `/pr`.
- **Memory support** — maintain project and global memories with optional automatic extraction and adaptive recall.
- **Messaging gateways** — connect Feishu, WeCom, and WeChat through a focused setup.
- **Workspace tools** — browse and search files, edit code, and use an embedded terminal alongside the conversation.
- **Secure access** — protect the WebUI with password and optional TOTP authentication.

## Quick Start

### Prerequisites

- Node.js 22 or newer
- pnpm 9 or newer (source development only)

Pi Cloud includes the [Pi coding agent](http://pi.dev), so a separate `pi` installation is not required when using API-key authentication. API keys can be configured from the agent profile dialog.

OAuth subscription sign-in is not currently available in the WebUI; native OAuth support is a planned future improvement. For now, install the standalone Pi CLI and complete `/login` in the terminal as the same OS user that runs Pi Cloud:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
# Enter /login and select a provider
```

Pi Cloud then detects the OAuth credentials stored in the default `~/.pi/agent` profile.

### Run without installing

If npm fails while building native dependencies, install system build tools such as `build-essential` and `python3`, then retry.

Set login credentials, then run the latest release:

```bash
PI_CLOUD_AUTH_USERNAME=pi PI_CLOUD_AUTH_PASSWORD='change-this-password' npx pi-cloud@latest
```

Open http://127.0.0.1:3000. The CLI opens the browser automatically after the server is ready.

### Install globally

```bash
npm install -g pi-cloud
pi-cloud
```

On first run, Pi Cloud creates a protected configuration file with username `admin` and prints a randomly generated password once.

See the [Configuration Manual](docs/manuals-en/configuration.md) to customize credentials, ports, and other settings. For remote or public access, see the [Deployment Manual](docs/manuals-en/deployment.md).

### Run as a system service

Install Pi Cloud as a startup service on Linux, macOS, or Windows:

```bash
pi-cloud service install
pi-cloud service status
```

On Windows, antivirus software may block `pi-cloud service install` because it creates an automatic-start scheduled task. Review the antivirus detection before allowing it; do not disable antivirus or exclude the entire npm directory.

### Run from source

```bash
git clone https://github.com/xianzhon/pi-cloud && cd pi-cloud
pnpm install
cp .env.example .env    # set PI_CLOUD_AUTH_USERNAME and PI_CLOUD_AUTH_PASSWORD
pnpm dev
```

Open http://localhost:5173 during development. The production server listens on `PORT` (default `3000`).

## Configuration

The essential settings are:

| Variable                   | Description                          |
| -------------------------- | ------------------------------------ |
| `PI_CLOUD_AUTH_USERNAME` | Login username                       |
| `PI_CLOUD_AUTH_PASSWORD` | Login password for a simple setup    |
| `PORT`                   | Backend port (default:`3000`)      |
| `HOST`                   | Bind address (default:`127.0.0.1`) |

For production, use `PI_CLOUD_AUTH_PASSWORD_HASH` instead of a plaintext password. See the [Configuration Manual](docs/manuals-en/configuration.md) for configuration files, security, session, storage, workspace, memory, provider, and gateway settings.

## Deployment

See the [Deployment Manual](docs/manuals-en/deployment.md) for source and npm package deployments, plus nginx reverse proxy configuration.

## Documentation

Browse the [documentation index](docs/README.md) for all user manuals and developer references.

## Development

```bash
pnpm dev                  # start both servers
pnpm build                # typecheck + bundle both
pnpm test                 # run all tests
```

- Frontend: http://localhost:5173 (Vite, proxies `/api` and `/ws` to backend)
- Backend: http://localhost:3000 (Fastify)
- Logs: `.logs/`
- PIDs: `.pids/`

For architecture, API, local package testing, and project layout notes, see [Developer Notes](docs/to-developers/developer-notes.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch and pull request conventions, testing, documentation requirements, and security reporting.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for details.
