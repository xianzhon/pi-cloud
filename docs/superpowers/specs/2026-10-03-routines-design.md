# Scheduled routines MVP

Status: approved and implemented. The user requested direct implementation without a separate implementation plan.

## Intent and scope

Allow the owner of a self-hosted Pi Cloud instance to configure a prompt that runs without an open browser, inspect each execution, and receive its result through an existing WeCom notification channel. Reuse Pi sessions, agent profiles, model selection, memory, authentication and allowed-root validation. Keep existing tasks, gateways and model-window kickoffs working as they do today.

Include one-time, daily and fixed-interval schedules; enable/disable; manual run; cancellation; execution history; persistent notification retries. Exclude arbitrary cron expressions, model-driven heartbeat, external event subscriptions, new gateways, Feishu proactive delivery, MCP, approvals, new memory storage, automatic worktrees and automatic execution retries.

This is a single-server scheduler, not a distributed worker system. Routines execute with the existing Pi agent tool permissions. This release does not claim read-only execution or filesystem sandboxing. New routines are disabled by default; enabling them authorizes unattended execution of their configured prompt. The editor and both manuals state this explicitly. Disabling a routine prevents future scheduled work and cancels its queued scheduled runs; it does not silently abort an already running execution.

## Existing foundations

- `ProjectTaskStarter.start` creates a session and returns a prompt; it is not a background runner. Tasks remain independent of routines.
- `ModelWindowKickoffScheduler` demonstrates server-owned execution and provider proxy handling. Keep its quota-window semantics independent.
- `NotificationChannelService` already stores encrypted WeCom group-bot credentials and sends notifications. Reuse this service and its existing channel configuration.
- The memory extension already recalls durable memories and queues extraction after agent settlement. Routines use that existing behavior.

## Architecture decision

owner: A routines module owns routine definitions, runs and notification delivery records through one RoutineStore. RoutineScheduler orchestrates transitions; routes only submit commands.

command path: authenticated REST route -> routines service/store; timer -> routines scheduler -> store -> session executor. Both manual and scheduled launches create runs through the same command path.

derived views: settings list and paginated history read SQLite records; Pi transcripts remain managed by PiSessionService. No new WebSocket state channel.

ordering/idempotency: atomic SQLite transactions materialize a due occurrence and advance the schedule; a unique routine/occurrence key prevents duplicate scheduled runs. Only queued runs can be claimed. One routine has at most one queued/running run. Worker concurrency is one for this MVP. Delivery retries never execute the prompt again.

delivery: completed outcomes create durable delivery records in the same transaction as run settlement. Startup recovers queued runs and deliveries; running runs become interrupted and are not automatically replayed.

contracts/tests: fake clock and injected executor/notifier tests cover scheduling, state transitions, cancellation, restarts and notification failures. Route tests cover authentication, validation and allowed roots. Vue tests cover editor and history behavior.

Create `server/src/routines/` with an owning architecture-policy module. Declare dependencies on server core types, services, database and path utilities as needed by actual imports; declare callers in server composition and routes. Separate persistence, schedule calculation, orchestration and Pi execution into focused files. Database migrations remain in server-db. Client components/types/localization use their existing modules.

## Data model

### Routine

Fields: ID, name, prompt, canonical project path, profile ID, model provider/ID, enabled, schedule definition, next scheduled UTC instant, optional existing notification channel ID, execution timeout, timestamps and revision.

Schedules:

- Once: an explicit future UTC instant, displayed in the user's local time.
- Interval: first scheduled instant and integer interval minutes, minimum 5. Subsequent times remain anchored to the schedule, rather than execution completion.
- Daily: hour/minute in server local time, displayed as such in the editor. The user explicitly removed time-zone selection and special daylight-saving handling from scope.

All persisted occurrence instants are UTC. An overdue routine materializes at most one run on startup and advances directly to its next future occurrence, rather than replaying all missed intervals. A consumed one-time schedule has no next instant. Schedule edits increment revision and recalculate the next instant; queued scheduled runs from the prior revision are cancelled. Running executions keep the immutable configuration snapshot they started with.

### Run

Fields: ID, routine ID, trigger (`scheduled` or `manual`), occurrence key, immutable execution snapshot, status, session ID/path when available, queued/start/finish times, summary, error and cancellation reason.

States: queued -> running -> succeeded / failed / cancelled / timed_out / interrupted. Cancelling a queued run is immediate. Cancelling a running run requests agent abort and settles only after execution stops; a cancellation request wins over a racing successful completion. A pending abort must retain its worker slot until the underlying execution finishes.

Execution failure is not retried automatically because tools may already have produced side effects. A user can launch a separate manual run. Store only a bounded summary (up to 8,000 characters) in the run row and keep the full transcript in the normal Pi session file. A model `error` or `aborted` stop reason cannot be recorded as success merely because `prompt()` resolved.

### Delivery

Fields: ID, run ID, channel ID snapshot, UTF-8 byte-bounded message, status (`pending`, `sending`, `sent`, `failed`), attempts, next attempt time, last error and timestamps. One initial result delivery per run/channel.

Send after settlement; retry transient failures independently with bounded backoff (1 minute, 5 minutes, 30 minutes; four total attempts). Startup returns unfinished `sending` records to `pending`. Missing/deleted channels fail visibly. Exhausted delivery can be retried explicitly from history without rerunning the task. Transport delivery is at least once: a crash after WeCom accepts a message but before local acknowledgment can cause a duplicate. Include the run ID in messages; do not promise exactly-once delivery.

## Execution and recovery

Poll SQLite every minute and also after manual-run commands. Materialize due work before executing it. Revalidate the project path against current allowed roots, directory existence, profile and model before every run; API validation alone is insufficient after configuration changes.

Use a unique server client ID for each run, set its profile, create a fresh persistent Pi session and invoke the existing profile-proxy execution wrapper. Save the session reference before prompting. Allow existing memory recall/extraction and explicitly selected skills/preset only if included in the final implementation plan; the MVP UI otherwise uses the profile's existing defaults. Dispose the server's in-memory session when execution ends while retaining its transcript.

Before launch, defer while PiSessionService reports foreground streaming in the same canonical directory. This reduces conflicts with existing interactive work but is not a universal filesystem lock: a user can begin an interactive run afterwards. Document this limitation and advise using a dedicated directory for unattended work. Do not introduce a global locking rewrite in this MVP.

Default execution timeout is 30 minutes, editable from 1 to 120 minutes. On timeout request agent abort; preserve the slot until the agent finishes. This is cooperative cancellation, not an OS sandbox or guaranteed termination of detached subprocesses.

During graceful shutdown stop accepting and claiming new work, request abort of active execution, settle it as interrupted, and stop notification dispatch before closing SQLite. After an unclean shutdown mark prior running runs interrupted, create their result deliveries once, preserve queued work and resume delivery attempts. Never reconstruct an active execution from its transcript and silently rerun its prompt.

Editing a routine does not mutate running snapshots. Disabling cancels queued scheduled runs. Manual run remains available for disabled routines and cannot overlap an existing queued/running run. Routine deletion is blocked while queued/running work exists; deletion removes the definition but retains run history and its display-name snapshot. Delivery retries remain possible for retained runs.

## API and UI

Add authenticated `/api/routines` endpoints for list/create/update/delete, manual run, paginated history, run cancellation and delivery retry. Use existing authentication hooks, typed validation and allowed-root utilities. Unknown resources return 404; active-run/edit conflicts return 409; invalid schedules/models/channels/paths return appropriate validation errors. Use revision checks to reject stale routine edits.

Add a Settings > Routines section following existing settings styles. Include name, prompt, project picker, profile/model selection, schedule controls, server-local daily time, timeout, enable switch and notification channel selector. Reuse existing WeCom notification configuration; no second credentials store or new messaging gateway. Use existing toasts and ConfirmModal for errors/notices and deletion/cancellation confirmations.

Show next execution, last result and a history view with queued/running/final statuses, timestamps, summary/error, session reference, notification status, cancellation and notification retry actions. Refresh while the section is visible; stop timers on unmount. Surface the unattended tool-permission limitation beside enabling. English and Chinese strings and manuals must stay aligned.

## Verification and completion criteria

1. Browser closure does not affect a scheduled run.
2. Once, interval and daily schedules have deterministic fake-clock tests, including overdue coalescing.
3. Repeated/concurrent scheduler ticks produce one occurrence/run; one routine cannot overlap itself.
4. A fresh session is linked to every launched run; model errors and cancellation cannot appear as success.
5. Restart keeps queued runs, marks running runs interrupted and never replays already started work.
6. Execution settlement survives notification failure; retrying delivery never calls the executor.
7. Deleted channels, deleted projects and changed allowed roots fail visibly without launching tools.
8. Editing/disabling/deleting routines and cancellation races obey the stated snapshot/revision rules.
9. UI covers creation/editing, schedules, history, confirmations and failure states. Existing kickoff and task behavior remains covered.
10. Run focused tests, architecture checks/tests, full build and full test suite. Update both language manuals and configuration documentation where affected; no environment variable is required for this feature.

## Execution authorization

The user approved this specification and explicitly requested direct code implementation without an implementation plan or further continuation approvals.
