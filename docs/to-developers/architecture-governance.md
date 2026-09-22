# Architecture Governance

Pi Cloud uses a lightweight, incremental architecture policy. The policy protects existing source-area boundaries without requiring a rewrite of the current codebase.

## Goals

Architecture governance should make these decisions explicit before implementation:

- which component or service owns mutable state;
- which existing route, WebSocket handler, service, composable, or command is the single write path;
- which source areas a module may depend on;
- how asynchronous work handles ordering, cancellation, retries, duplicate delivery, and stale results;
- how connected browser delivery differs from reconnect or recovery behavior.

It is not a requirement to introduce domain/app/adapter layers, create a contract file for every directory, or split an existing large file as part of an unrelated change.

## Policy

[`architecture-policy.json`](../../architecture-policy.json) declares source modules, their owners, and allowed dependencies. More-specific roots take precedence over broader roots, so files directly under `server/src` and `client/src` belong to their respective `*-core` modules while nested source areas have their own module IDs.

The current policy records the existing dependency graph. Cycles and public-entrypoint enforcement remain disabled during the initial adoption phase because the current technical-directory structure contains intentional bidirectional relationships. New dependency edges must be reviewed and added deliberately rather than appearing accidentally.

The checker:

- scans TypeScript, JavaScript, and Vue files;
- resolves relative imports, dynamic imports, server-side `.js` specifiers that map to TypeScript sources, and configured aliases such as `@/`;
- reports undeclared cross-module dependencies;
- uses repository-relative fingerprints for portable baselines.

A baseline is available for intentional legacy violations, but the initial policy has no baseline violations. Do not update `.architecture-baseline.json` merely to make a check pass.

## Commands

```bash
pnpm architecture:check                 # enforce the complete policy
pnpm architecture:check -- --changed    # check uncommitted and untracked files
pnpm architecture:report                # report without failing
pnpm architecture:context <module-id>   # show a module's owner and boundaries
pnpm architecture:test                  # test the checker
pnpm architecture:baseline:update       # accept reviewed legacy violations only
```

CI runs the report in non-blocking mode during initial adoption. Once the policy has proven stable, CI can switch from `architecture:report` to `architecture:check`.

## Workflow for Architecture-Significant Changes

Use this workflow when a change creates or moves modules, adds a cross-module dependency, changes mutable-state ownership, introduces a queue/cache/persistence path, or changes asynchronous delivery and recovery behavior.

1. Run `pnpm architecture:check -- --changed` and identify the affected module IDs.
2. Run `pnpm architecture:context <module-id>` for each affected module.
3. Read the relevant implementation, tests, public types, and existing specification before editing.
4. Record a short design decision:

   ```text
   owner: <single owner of mutable state>
   command path: <entrypoint -> owner>
   derived views: <projections/caches and their source>
   ordering/idempotency: <ordering, duplicate, retry, cancellation, stale-result rules>
   delivery: <connected behavior and reconnect/recovery behavior>
   contracts/tests: <boundary and focused validation>
   ```

5. Reuse an existing service, composable, command, or adapter when it already owns the responsibility.
6. If a new dependency is necessary, update the policy in the same change and explain why.
7. Run the architecture check and focused tests after editing.

Documentation, localization, styling, and isolated changes that do not affect a boundary do not need a design record.

## Adding or Reshaping Modules

Prefer modules based on product responsibilities over additional technical buckets. A new module declaration needs:

- a unique ID and source root;
- one named owner/responsibility;
- the smallest justified `requires` list;
- public entrypoints when callers should not deep-import implementation files.

Enable `forbidDeepImports` only after affected modules have intentional public entrypoints. Enable `forbidCycles` only after existing module cycles have been removed or represented through narrower contracts.
