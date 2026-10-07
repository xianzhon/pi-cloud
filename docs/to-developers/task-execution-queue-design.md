# Decision: Persistent automatic task execution

Status: accepted. Specification: [Task Inbox manual](../manuals-en/01-task-inbox.md#automatic-execution).

## Owner

`TaskExecutionQueue` (`server-services`) exclusively owns queue configuration, active execution tracking, repository reservations, and shutdown cancellation. Its singleton SQLite row stores the enabled flag, ordered task IDs, active IDs, and latest error. `ProjectTaskStore` owns task lifecycle records; `ProjectTaskStarter` owns startup and session creation. `PiSessionService` owns session execution and cleanup, not queue ordering.

## Command path

Authenticated `/api/tasks/execution-queue` GET/PUT routes call the queue's `get`/`configure` methods. Configuration validates unique IDs and waiting status, persists the state, and starts or wakes the runner. The runner resolves allowed paths and Git repository identity, calls the existing starter, executes the prompt through the session service, verifies completion and Git state, then calls the task store to complete the task. No new cross-module dependency is required.

## Derived views

The execution dialog polls the queue and task records. Its selected list and enabled switch are drafts, not authoritative state. Polling removes finished queue entries while retaining unsaved additions and locally edited enabled state. The inbox derives lifecycle and linked-session actions from task records. `activeTaskId` is a compatibility projection of the first entry in `activeTaskIds`.

## Ordering and idempotency

A single runner admits at most three tasks across independent canonical Git common directories. Tasks sharing a repository, including linked worktrees, execute serially in selected order; independent repositories can finish out of order. While running, configuration may only append tasks or change enabled state. Task startup claims prevent duplicate starts. Missing/non-waiting IDs are pruned when idle; invalid enabled configurations are rejected.

Same-profile agent execution may overlap. Different environment contexts serialize because agent directory, proxy environment, and the Undici dispatcher are process-wide. Removing this constraint requires isolation rather than bypassing the profile lock.

Successful completion requires a normal final response ending with a per-execution random marker. Git HEAD and branch are checked before staging. After committing, the actual commit parent, branch, current HEAD, and clean worktree are verified before completing the task. This detects a concurrent checkout or commit during staging/committing, but is not an external Git lock: a raced commit remains for manual review, and arbitrary changes after the checks cannot be prevented. Users must avoid concurrent repository edits; automatic commits stage all changes.

## Cancellation, delivery, and recovery

Browser disconnection does not cancel server work. Saving a pause stops new launches while admitted tasks finish. Errors pause admission and retain the failed task as started; other active tasks may finish. There are no automatic retries or replay of started work.

Shutdown disables admission, aborts pending operations and active prompts, and waits for the runner with bounded session-abort waiting. Interrupted tasks remain started. On construction after restart, a saved enabled/active queue is disabled and active IDs cleared with a review notice. Users review persisted sessions and repository state, manually recover work, and remove non-waiting tasks before re-enabling.

Opening a task session carries its stored profile ID. Cross-profile navigation reloads the page with an explicit profile (including `default`) so sidebar initialization selects the right persisted session store even after cleanup or restart. Same-profile navigation retains the existing client session context. Poll request generations discard responses from closed/reopened dialogs.

## Contracts and tests

- `server/src/services/task-execution-queue.test.ts`: ordered commits, no-change success, concurrency bound, shared-repository serialization, branch/parent races during staging, failures, pause during lookup, shutdown, restart, and configuration validation.
- `client/src/components/TaskExecutionDialog.test.ts`: queue drafts, locks, active tasks, errors, and unsaved pause preservation across polling/reopening.
- `client/src/components/TaskInboxPanel.test.ts`: linked-session events include task profile ownership.
- `client/src/App.test.ts`: cross-profile linked-session navigation includes the persisted profile, including an explicit default profile.
- `pnpm architecture:check -- --changed`: verifies affected `server-services`, `client-components`, and `client-core` boundaries.
