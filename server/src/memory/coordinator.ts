import { isRetryableExtractionError } from './extractor.js';
import { MemoryStore } from './store.js';
import type {
  EnqueueExtractionRunInput,
  MemoryExtractionRun,
  MemoryUpdatedEvent,
  ValidatedExtractionCandidate,
} from './types.js';

interface ExtractionExecutor {
  execute(run: MemoryExtractionRun, signal: AbortSignal): Promise<{
    candidates: ValidatedExtractionCandidate[];
    emittedCount?: number;
    discarded: number;
  }>;
}

interface CoordinatorDependencies {
  store: MemoryStore;
  extractor: ExtractionExecutor;
  emit(event: MemoryUpdatedEvent): void;
}

interface ProfileQueueState {
  foregroundCount: number;
  draining?: Promise<void>;
  controller?: AbortController;
}

export class MemoryExtractionCoordinator {
  private readonly states = new Map<string, ProfileQueueState>();
  private stopped = true;

  constructor(private readonly dependencies: CoordinatorDependencies) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.dependencies.store.recoverInterruptedRuns();
    for (const profileId of this.dependencies.store.listQueuedProfiles()) this.kick(profileId);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const active = Array.from(this.states.values());
    for (const state of active) state.controller?.abort();
    await Promise.allSettled(active.map((state) => state.draining).filter(Boolean) as Promise<void>[]);
  }

  async enqueue(input: EnqueueExtractionRunInput): Promise<MemoryExtractionRun> {
    const { run } = this.dependencies.store.enqueueExtractionRun(input);
    if (run.status === 'queued') this.kick(run.profileId);
    return run;
  }

  retry(runId: string): void {
    const run = this.dependencies.store.getExtractionRun(runId);
    if (!run) throw new Error('Extraction run not found');
    this.dependencies.store.retryRun(runId);
    this.kick(run.profileId);
  }

  async withForeground<T>(profileId: string, work: () => Promise<T>): Promise<T> {
    const state = this.getState(profileId);
    state.foregroundCount += 1;
    state.controller?.abort();
    if (state.draining) await state.draining;

    try {
      return await work();
    } finally {
      state.foregroundCount -= 1;
      this.kick(profileId);
    }
  }

  private getState(profileId: string): ProfileQueueState {
    const existing = this.states.get(profileId);
    if (existing) return existing;
    const state: ProfileQueueState = { foregroundCount: 0 };
    this.states.set(profileId, state);
    return state;
  }

  private kick(profileId: string): void {
    const state = this.getState(profileId);
    if (this.stopped || state.foregroundCount > 0 || state.draining) return;
    const draining = this.drain(profileId, state).finally(() => {
      if (state.draining === draining) state.draining = undefined;
      if (!this.stopped && state.foregroundCount === 0) {
        const stillQueued = this.dependencies.store.listQueuedProfiles().includes(profileId);
        if (stillQueued) this.kick(profileId);
      }
    });
    state.draining = draining;
  }

  private async drain(profileId: string, state: ProfileQueueState): Promise<void> {
    while (!this.stopped && state.foregroundCount === 0) {
      const run = this.dependencies.store.claimNextExtractionRun(profileId);
      if (!run) return;
      const controller = new AbortController();
      state.controller = controller;

      try {
        const extraction = await this.dependencies.extractor.execute(run, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const applied = this.dependencies.store.applyExtractionCandidates(
          run.id,
          extraction.candidates,
          extraction.emittedCount ?? extraction.candidates.length,
        );
        this.dependencies.store.completeRun(run.id, extraction.discarded + applied.discardedCount);
        this.emitRun(run, {
          activeProjectCount: applied.activeProjectCount,
          pendingGlobalCount: applied.pendingGlobalCount,
          failed: false,
        });
      } catch (error) {
        const current = this.dependencies.store.getExtractionRun(run.id);
        if (current?.status !== 'running') continue;
        if (controller.signal.aborted) {
          this.dependencies.store.requeueRun(run.id, this.stopped ? 'Server shutdown' : 'Foreground request', true);
        } else if (isRetryableExtractionError(error) && current.attempts < 2) {
          this.dependencies.store.requeueRun(run.id, errorMessage(error));
        } else {
          this.dependencies.store.failRun(run.id, errorMessage(error));
          this.emitRun(run, { activeProjectCount: 0, pendingGlobalCount: 0, failed: true });
        }
      } finally {
        if (state.controller === controller) state.controller = undefined;
      }
    }
  }

  private emitRun(
    run: MemoryExtractionRun,
    result: Pick<MemoryUpdatedEvent, 'activeProjectCount' | 'pendingGlobalCount' | 'failed'>,
  ): void {
    this.dependencies.emit({
      profileId: run.profileId,
      projectId: run.projectId,
      extractionRunId: run.id,
      ...result,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
