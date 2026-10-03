# Scheduled routines

Open **Settings > Routines** to schedule unattended Pi work. The Pi Cloud server must remain running; the browser can be closed.

1. Add a routine with a name and prompt.
2. Select a project directory within the allowed roots, an agent profile and a model.
3. Select **Once**, **Fixed interval**, or **Daily**. First-run dates are entered in your browser's local time. Daily times use the server's local time, shown in the panel. The minimum interval is five minutes.
4. Set a timeout from 1 to 120 minutes (default: 30).
5. Optionally select a shared WeCom group-bot notification channel. Configure channels in **Settings > Model window kickoff**.
6. Save. New routines are disabled by default. Enable and save when you are ready to authorize unattended execution. **Run now** creates a manual run even for a disabled routine.

Routines use existing Pi tools, provider credentials and memory. Enabling a routine authorizes its prompt to execute shell commands and change files using the existing tool permissions. This feature does not provide a read-only sandbox or sensitive-action approval gate. Use a dedicated project directory for unattended work. The scheduler defers a run while an existing Pi session is streaming in that directory; it does not prevent another interactive session from starting later.

## Execution and history

The scheduler checks every minute and runs one routine at a time. Each run creates a fresh persistent Pi session. History shows status, timestamps, session ID, summary/error and notification delivery state. Full transcripts remain in the normal Pi session storage. History is paginated.

Intervals stay anchored to their configured first time. After downtime, at most one overdue occurrence is queued; missed intervals are not all replayed. A one-time schedule is consumed once. An unsuccessful execution is not automatically retried because tools may already have changed files or external systems. Use **Run now** to create a separate attempt.

Disabling a routine cancels its queued scheduled runs but does not stop a currently running execution. Editing cancels queued scheduled work from the previous configuration; running executions retain their original configuration. Cancel active work before deleting a routine. Deletion retains its run history.

Cancellation and timeouts request the Pi agent to abort. The worker remains occupied until execution stops. This is cooperative cancellation and cannot guarantee termination of detached subprocesses. A server restart marks previously running executions **Interrupted**, without replaying them. Queued runs remain available for execution.

## WeCom result delivery

Results and notifications are persisted separately. A notification failure never reruns the prompt. Delivery is attempted up to four times, with retry delays of one, five and thirty minutes. After exhaustion, **Retry notification** starts another delivery attempt sequence. A removed channel is shown as a delivery failure.

Messages include the run ID and a shortened result. Delivery is at least once: a crash after WeCom accepts a message but before Pi Cloud records it may produce a duplicate.

No additional environment variables are required. Existing authentication and allowed-root configuration apply. This scheduler supports a single Pi Cloud server process per database; do not run multiple scheduler instances against the same database.
