---
name: architecture-governance
description: Apply Pi Cloud architecture policy when code changes create or move modules, add cross-module dependencies, change mutable-state ownership, introduce queues, caches, or persistence, or alter asynchronous WebSocket, retry, reconnect, or recovery behavior. Skip documentation, localization, styling, and isolated changes that do not affect boundaries.
---

# Architecture Governance

Use this workflow for architecture-significant Pi Cloud changes. The executable policy is `architecture-policy.json`; do not duplicate its dependency declarations here.

## Before Editing

1. Run `pnpm architecture:check -- --changed`.
2. Identify affected modules from `architecture-policy.json` and run `pnpm architecture:context <module-id>` for each one.
3. Read the relevant source, focused tests, public types, and any existing specification. Do not assume a spec or contract exists.
4. Make a compact design decision before implementation:

   ```text
   owner: <single owner of mutable state>
   command path: <entrypoint -> owner>
   derived views: <projections/caches and their source>
   ordering/idempotency: <ordering, duplicate, retry, cancellation, stale-result rules>
   delivery: <connected behavior and reconnect/recovery behavior>
   contracts/tests: <boundary and focused validation>
   ```

5. Apply these rules:
   - **One owner:** one component or service accepts writes for each mutable state concern. Other layers send commands or consume derived views.
   - **One path:** reuse an existing route, WebSocket handler, service, composable, command, or adapter instead of creating a parallel implementation.
   - **Explicit boundaries:** every new source file has an owning module; every cross-module import must be declared in `requires`.
   - **Explicit time:** asynchronous changes define ordering, cancellation, duplicate handling, stale-result handling, retry boundaries, and reconnect behavior.
   - **Small context:** inspect relevant contracts and tests first, then open broader implementations only when needed.

Do not impose a speculative domain/app/adapter hierarchy, mandatory contract files, or unrelated file splitting on legacy code.

## During and After Editing

1. Keep the change within existing boundaries where possible.
2. If a new dependency is necessary, update `architecture-policy.json` and explain the dependency in the change summary.
3. For a new product-responsibility module, declare its roots, owner, dependencies, and any public entrypoints before adding callers.
4. Add or update focused tests for changed behavior.
5. Run:

   ```bash
   pnpm architecture:check -- --changed
   pnpm architecture:test
   ```

6. Report affected modules, state owners, ordering/recovery assumptions, policy changes, and tests run.

Use `pnpm architecture:baseline:update` only for reviewed legacy violations. Never use it to accept an unexplained new dependency.

See [`docs/to-developers/architecture-governance.md`](../../../docs/to-developers/architecture-governance.md) for policy details and rollout guidance.
