# Agent Guidance

## Project Overview

Pi Cloud is a pnpm monorepo providing a browser interface for the Pi coding agent.

- `server/`: Fastify REST and WebSocket backend, Pi SDK integration, SQLite persistence, authentication, terminal sessions, memory, tasks, skills, and messaging gateways.
- `client/`: Vue 3 and Vite frontend with chat, session management, Monaco editor, xterm.js terminal, task queue, memory center, settings, and gateway setup.
- `bin/pi-cloud.mjs`: CLI entry point for the npm package.
- `docs/manuals-en/` and `docs/manuals-cn/`: English and Chinese user manuals. Keep corresponding translations aligned when changing user-facing documentation.

Node.js 22 or newer is required. Use pnpm for workspace commands.

## Common Commands

```bash
pnpm install                    # install workspace dependencies
pnpm dev                        # run client and server in development
pnpm build                      # type-check and build both packages
pnpm test                       # run all tests once
pnpm test:watch                 # run workspace tests in watch mode

cd server && pnpm dev           # backend only
cd client && pnpm dev           # frontend only
cd server && pnpm build         # server type-check and bundle
cd client && pnpm build         # client type-check and Vite build
cd server && pnpm exec vitest run src/path/file.test.ts
cd client && pnpm exec vitest run src/path/file.test.ts

./start.sh                      # start source deployment
./status.sh                     # show deployment status
./stop.sh                       # stop source deployment
make package                    # build and create the npm tarball
```

Development endpoints:

- Frontend: `http://localhost:5173`; Vite proxies `/api` and `/ws` to the backend.
- Backend: `http://localhost:3000` by default.
- Runtime logs and PID files: `.logs/` and `.pids/`.

## Architecture and Source Layout

### Server

- `server/src/index.ts`: application entry point and route/plugin registration.
- `server/src/routes/`: REST API handlers under `/api/*`.
- `server/src/ws/`: chat and terminal WebSocket handlers.
- `server/src/services/`: application and Pi session services.
- `server/src/auth/`: password, TOTP, sessions, rate limiting, and audit logging.
- `server/src/db/`: SQLite setup and persistence.
- `server/src/memory/`: memory storage, recall, extraction, and evaluation.
- `server/src/extensions/`: Pi agent extensions.
- `server/src/config/`: environment configuration.

The server uses ESM TypeScript and bundles with esbuild after `tsc --noEmit`. It wraps `@earendil-works/pi-coding-agent`; each browser tab has an independent `clientId` and agent session state.

### Client

- `client/src/main.ts`: frontend entry point.
- `client/src/App.vue`: application shell.
- `client/src/components/`: Vue components and co-located tests.
- `client/src/composables/`: reusable stateful UI logic.
- `client/src/services/`: browser-side services and API helpers.
- `client/src/i18n/`: localization setup and messages.
- `client/src/router.ts`: route definitions.

The client uses Vue 3, TypeScript, Vue I18n, Monaco, and xterm.js. Tests run with Vitest and happy-dom.

## Development Guidelines

- Make the smallest change that satisfies the request; do not refactor unrelated code.
- Match the style and patterns in neighboring files.
- Keep tests co-located as `*.test.ts` and add or update focused tests for behavior changes.
- Run the narrowest relevant tests while iterating, then run `pnpm build` and `pnpm test` when the scope warrants it.
- Do not edit generated output in `client/dist/`, `server/dist/`, package tarballs, `.logs/`, or `.pids/`.
- Keep REST endpoints under `/api/*` and WebSocket endpoints under `/ws/*`.
- Preserve authentication and allowed-root checks on filesystem, terminal, session, and gateway changes.
- Never commit `.env`, credentials, tokens, databases, or other local runtime state.
- Update `.env.example`, the relevant manual, and both language versions when adding or changing user-facing configuration.

## Configuration and Documentation

Configuration comes from shell environment variables and `.env` files; shell variables take precedence. Important defaults include `PORT=3000`, `FRONTEND_PORT=5173`, and `HOST=127.0.0.1`. Authentication requires `PI_CLOUD_AUTH_USERNAME` and exactly one of `PI_CLOUD_AUTH_PASSWORD` or `PI_CLOUD_AUTH_PASSWORD_HASH`.

Use these references instead of duplicating detailed operational guidance here:

- `README.md` / `README.zh-CN.md`: setup and feature overview.
- `docs/manuals-en/configuration.md` / `docs/manuals-cn/configuration.md`: configuration and security.
- `docs/manuals-en/deployment.md` / `docs/manuals-cn/deployment.md`: source, npm, service, SSH, and reverse-proxy deployment.
- `docs/to-developers/developer-notes.md`: package testing, API summary, and project layout.
