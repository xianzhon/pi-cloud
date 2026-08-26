import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { MemoryExtractionCoordinator } from './coordinator.js';
import { RetryableExtractionError } from './extractor.js';
import { MemoryStore } from './store.js';
import type { EnqueueExtractionRunInput, MemoryUpdatedEvent } from './types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('MemoryExtractionCoordinator', () => {
  let db: PiuiDatabase;
  let store: MemoryStore;
  let projectId: string;
  let sequence: number;
  let emit: ReturnType<typeof vi.fn<(event: MemoryUpdatedEvent) => void>>;

  beforeEach(() => {
    db = openPiuiDatabase(':memory:');
    store = new MemoryStore(db);
    projectId = store.getOrCreateProject('default', '/repo/app').id;
    sequence = 0;
    emit = vi.fn<(event: MemoryUpdatedEvent) => void>();
  });

  afterEach(() => {
    db.close();
  });

  function input(overrides: Partial<EnqueueExtractionRunInput> = {}): EnqueueExtractionRunInput {
    sequence += 1;
    return {
      profileId: 'default', projectId,
      sourceSessionId: `session-${sequence}`, sourceSessionPath: `/sessions/${sequence}.jsonl`,
      sourceKind: 'automatic', endingLeafId: `leaf-${sequence}`,
      ...overrides,
    };
  }

  it('serializes runs per profile and emits completion counts', async () => {
    const first = deferred<{ candidates: []; discarded: number }>();
    const execute = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ candidates: [], discarded: 0 });
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();

    const runOne = await coordinator.enqueue(input());
    const runTwo = await coordinator.enqueue(input());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    first.resolve({ candidates: [], discarded: 0 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getExtractionRun(runTwo.id)?.status).toBe('completed'));

    expect(store.getExtractionRun(runOne.id)?.status).toBe('completed');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'default', projectId, failed: false,
    }));
    await coordinator.stop();
  });

  it('allows different profiles to extract independently', async () => {
    const otherProjectId = store.getOrCreateProject('work', '/repo/app').id;
    const defaultGate = deferred<any>();
    const workGate = deferred<any>();
    const execute = vi.fn((run) => run.profileId === 'default' ? defaultGate.promise : workGate.promise);
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();

    await coordinator.enqueue(input());
    await coordinator.enqueue(input({ profileId: 'work', projectId: otherProjectId }));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    defaultGate.resolve({ candidates: [], discarded: 0 });
    workGate.resolve({ candidates: [], discarded: 0 });
    await coordinator.stop();
  });

  it('aborts and requeues extraction before foreground work', async () => {
    let firstAborted = false;
    const execute = vi.fn()
      .mockImplementationOnce((_run, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          firstAborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }))
      .mockResolvedValue({ candidates: [], discarded: 0 });
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();
    const run = await coordinator.enqueue(input());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    const result = await coordinator.withForeground('default', async () => {
      expect(firstAborted).toBe(true);
      expect(store.getExtractionRun(run.id)?.status).toBe('queued');
      return 'foreground-result';
    });

    expect(result).toBe('foreground-result');
    await vi.waitFor(() => expect(store.getExtractionRun(run.id)?.status).toBe('completed'));
    expect(store.getExtractionRun(run.id)?.attempts).toBe(1);
    await coordinator.stop();
  });

  it('retries one failure and then completes', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new RetryableExtractionError('schema', 'invalid JSON'))
      .mockResolvedValue({ candidates: [], discarded: 2 });
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();

    const run = await coordinator.enqueue(input());

    await vi.waitFor(() => expect(store.getExtractionRun(run.id)?.status).toBe('completed'));
    expect(store.getExtractionRun(run.id)).toMatchObject({ attempts: 2, discardedCount: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
    await coordinator.stop();
  });

  it('does not retry deterministic configuration or application failures', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('No memory extraction model is available'));
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();

    const run = await coordinator.enqueue(input());

    await vi.waitFor(() => expect(store.getExtractionRun(run.id)?.status).toBe('failed'));
    expect(store.getExtractionRun(run.id)?.attempts).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await coordinator.stop();
  });

  it('marks a second retryable failure and emits a warning event', async () => {
    const execute = vi.fn().mockRejectedValue(new RetryableExtractionError('transport', 'provider unavailable'));
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();

    const run = await coordinator.enqueue(input());

    await vi.waitFor(() => expect(store.getExtractionRun(run.id)?.status).toBe('failed'));
    expect(store.getExtractionRun(run.id)?.attempts).toBe(2);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      extractionRunId: run.id, failed: true,
    }));
    await coordinator.stop();
  });

  it('recovers interrupted runs at startup', async () => {
    const queued = store.enqueueExtractionRun(input()).run;
    store.claimNextExtractionRun('default');
    const execute = vi.fn().mockResolvedValue({ candidates: [], discarded: 0 });
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });

    coordinator.start();

    await vi.waitFor(() => expect(store.getExtractionRun(queued.id)?.status).toBe('completed'));
    await coordinator.stop();
  });

  it('requeues active work during shutdown', async () => {
    const execute = vi.fn((_run, signal: AbortSignal) => new Promise<{ candidates: []; discarded: number }>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const coordinator = new MemoryExtractionCoordinator({ store, extractor: { execute }, emit });
    coordinator.start();
    const run = await coordinator.enqueue(input());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    await coordinator.stop();

    expect(store.getExtractionRun(run.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
