# Contributing

Thank you for contributing to Pi WebUI. By contributing to this project, you agree that your contributions are licensed under the Apache License, Version 2.0.

## Development setup

Pi WebUI is a pnpm monorepo with a Vue client and a Fastify server. You need:

- Node.js 22 or newer
- pnpm 9 or newer
- Git
- System build tools such as `build-essential` and `python3` if native dependencies cannot be built

Fork the repository on GitHub, then clone your fork and install dependencies:

```bash
git clone https://github.com/xianzhon/pi-webui.git
cd pi-webui
pnpm install --frozen-lockfile
cp .env.example .env
```

Set `PI_WEBUI_AUTH_USERNAME` and `PI_WEBUI_AUTH_PASSWORD` in `.env`, then start both development servers:

```bash
pnpm dev
```

The client runs at http://localhost:5173 and proxies `/api` and `/ws` to the server at http://localhost:3000. See the [configuration manual](docs/manuals-en/configuration.md) for additional settings and the [developer notes](docs/to-developers/developer-notes.md) for architecture and project layout.

## Branches and pull requests

1. Create a focused branch from the latest `main`. Use a descriptive name such as `feat/session-filter`, `fix/websocket-reconnect`, or `docs/contributing`.
2. Keep changes scoped to one concern. Write clear commit messages and avoid committing generated output, package tarballs, credentials, databases, logs, or PID files.
3. Add or update focused tests for behavior changes. Tests should be co-located with source files as `*.test.ts`.
4. Update relevant documentation and translations when behavior, configuration, or user-facing text changes.
5. Before opening a pull request, run the relevant targeted tests followed by `pnpm build` and `pnpm test`.
6. In the pull request, explain what changed and why, link related issues, list verification performed, and include screenshots or recordings for visible UI changes.

Keep pull requests small enough to review. If a change is large, consider opening an issue first to discuss its scope and approach.

## Tests and checks

Run all checks used by CI:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Useful development commands include:

```bash
pnpm test:watch                                      # run workspace tests in watch mode
cd server && pnpm exec vitest run src/path/file.test.ts
cd client && pnpm exec vitest run src/path/file.test.ts
```

To test the package artifact that users install:

```bash
make package
npm install -g ./pi-webui-1.0.0.tgz
pi-webui --help
```

Replace the tarball filename if the package version has changed.

## Documentation and translations

Keep corresponding English and Simplified Chinese user documentation aligned:

- Update both `README.md` and `README.zh-CN.md` when changing shared README content.
- Update the matching files under `docs/manuals-en/` and `docs/manuals-cn/` when changing user-facing manuals.
- When adding or changing user-facing configuration, also update `.env.example` and both language versions of the relevant manual.
- Check relative links and command examples in every changed document.

Developer-only documentation under `docs/to-developers/` does not require a translation unless a translated counterpart already exists.

## Reporting security vulnerabilities

Do not disclose suspected vulnerabilities publicly. Follow the private reporting process in [SECURITY.md](SECURITY.md).
