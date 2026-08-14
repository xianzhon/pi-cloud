# Developer Notes

## Architecture

**pnpm monorepo** with two packages:

- **server/** — Fastify + WebSocket backend wrapping the `@earendil-works/pi-coding-agent` SDK. SQLite (better-sqlite3) for auth/session storage, argon2 for password hashing, and a prebuilt node-pty distribution for embedded terminals.
- **client/** — Vue 3 + Vite frontend with Monaco editor and xterm.js terminal.

Each browser tab gets its own `clientId` and independent session state — no synchronization between tabs.

## API

The server exposes REST APIs under `/api/*` and WebSocket endpoints at `/ws/chat` and `/ws/terminal`. Route definitions live in `server/src/routes/` and `server/src/ws/`.

## Test a local package

To test the same package artifact that users will install:

```bash
make package               # equivalent to npm pack
npm install -g ./pi-webui-1.0.0.tgz
pi-webui --help
```

Replace the tarball filename if the package version is different. The tarball path is required; without it, npm tries to install the current directory and may report that `package.json` is missing.

## Project Layout

```text
server/src/            # Fastify backend
  routes/              #   REST API handlers
  ws/                  #   WebSocket handlers
  services/            #   Business logic
  auth/                #   Authentication (password, TOTP, rate limiting)
  db/                  #   SQLite database
  config/              #   Environment config

client/src/            # Vue 3 frontend
  components/          #   Vue components (*.vue + *.test.ts)
  composables/         #   Vue composables (stateful hooks)
  services/            #   Client-side services
  types/               #   TypeScript type definitions
```

Tests are co-located with source files as `*.test.ts`. Use `vitest` to run a single file during development:

```bash
cd server && pnpm exec vitest src/routes/auth.test.ts
```
