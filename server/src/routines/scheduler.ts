import type { RoutineStore } from './store.js';
import type { Run, RunStatus } from './types.js';
interface Dependencies {
  store: RoutineStore;
  now?: () => string;
  busy: (path: string) => boolean;
  execute: (run: Run, signal: AbortSignal) => Promise<string>;
  send: (id: string, message: string) => Promise<void>;
  log?: (error: unknown) => void;
}
export class RoutineScheduler {
  private timer?: NodeJS.Timeout;
  private execution?: Promise<void>;
  private delivery?: Promise<void>;
  private current?: {
    id: string;
    controller: AbortController;
    reason: RunStatus;
  };
  private stopped = false;
  constructor(private deps: Dependencies) {}
  private now() {
    return this.deps.now?.() || new Date().toISOString();
  }
  start() {
    if (this.timer) return;
    this.deps.store.recover(this.now());
    this.stopped = false;
    this.wake();
    this.timer = setInterval(() => this.wake(), 60000);
    this.timer.unref();
  }
  wake() {
    void this.tick().catch((error) => this.deps.log?.(error));
  }
  async tick(): Promise<void> {
    if (this.stopped) return;
    this.deps.store.materialize(this.now());
    if (!this.execution) {
      const run = this.deps.store
        .queued()
        .find((r) => !this.deps.busy(r.snapshot.projectPath));
      if (run) {
        this.execution = this.execute(run).finally(() => {
          this.execution = undefined;
          // Drain eligible queued work promptly, including commands received during execution.
          if (!this.stopped) this.wake();
        });
      }
    }
    if (!this.delivery) {
      this.delivery = this.deliver().finally(() => {
        this.delivery = undefined;
        // Settlement may have queued a result while this pump was sending earlier deliveries.
        if (
          !this.stopped &&
          this.deps.store.pendingDeliveries(this.now()).length
        )
          this.wake();
      });
    }
    await Promise.all([this.execution, this.delivery]);
  }
  cancel(id: string) {
    const run = this.deps.store.run(id);
    if (run.status === 'queued')
      this.deps.store.settle(
        id,
        'cancelled',
        '',
        'Cancelled by user',
        this.now(),
      );
    else if (this.current?.id === id) {
      this.current.reason = 'cancelled';
      this.current.controller.abort();
    } else throw new Error('Run is not active');
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.current) {
      this.current.reason = 'interrupted';
      this.current.controller.abort();
    }
    await Promise.all([this.execution, this.delivery]);
  }
  private async execute(run: Run) {
    const claimed = this.deps.store.claim(run.id, this.now());
    const current = {
      id: run.id,
      controller: new AbortController(),
      reason: 'cancelled' as RunStatus,
    };
    this.current = current;
    const timer = setTimeout(() => {
      if (!current.controller.signal.aborted) {
        current.reason = 'timed_out';
        current.controller.abort();
      }
    }, run.snapshot.timeoutMinutes * 60000);
    try {
      const summary = await this.deps.execute(
        claimed,
        current.controller.signal,
      );
      this.deps.store.settle(
        run.id,
        current.controller.signal.aborted ? current.reason : 'succeeded',
        summary,
        null,
        this.now(),
      );
    } catch (error) {
      this.deps.store.settle(
        run.id,
        current.controller.signal.aborted ? current.reason : 'failed',
        '',
        error instanceof Error ? error.message : String(error),
        this.now(),
      );
    } finally {
      clearTimeout(timer);
      this.current = undefined;
    }
  }
  private async deliver() {
    for (const d of this.deps.store.pendingDeliveries(this.now())) {
      if (this.stopped) break;
      if (d.attempts >= 4) {
        this.deps.store.saveDelivery({
          ...d,
          status: 'failed',
          error: d.error || 'Delivery attempt limit reached',
        });
        continue;
      }
      this.deps.store.saveDelivery({
        ...d,
        status: 'sending',
        attempts: d.attempts + 1,
      });
      try {
        await this.deps.send(d.channelId, d.message);
        this.deps.store.saveDelivery({
          ...d,
          status: 'sent',
          attempts: d.attempts + 1,
          error: null,
        });
      } catch (error) {
        const attempts = d.attempts + 1;
        this.deps.store.saveDelivery({
          ...d,
          attempts,
          status: attempts >= 4 ? 'failed' : 'pending',
          nextAttemptAt: new Date(
            Date.parse(this.now()) +
              [60000, 300000, 1800000][Math.min(attempts - 1, 2)],
          ).toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
