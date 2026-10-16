import { describe, expect, it, vi } from 'vitest';
import { GatewayMessageQueue, requestGatewayAbort } from './gateway-message-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('GatewayMessageQueue', () => {
  it('projects active duration and waiting count without blocking', async () => {
    let now = 1000;
    const queue = new GatewayMessageQueue(() => now);
    const blocked = deferred();
    const first = queue.enqueue('a', async () => blocked.promise);
    await vi.waitFor(() => expect(queue.status('a').running).toBe(true));
    now = 4500;
    const second = queue.enqueue('a', async () => {});
    expect(queue.status('a')).toEqual({ running: true, stopping: false, elapsedSeconds: 3, pending: 1 });
    expect(queue.status('b').running).toBe(false);
    blocked.resolve();
    await Promise.all([first, second]);
    expect(queue.status('a')).toEqual({ running: false, stopping: false, elapsedSeconds: 0, pending: 0 });
  });

  it('cancels queued work and signals preparation but serializes new messages behind settlement', async () => {
    const queue = new GatewayMessageQueue();
    const blocked = deferred();
    let signal!: AbortSignal;
    const first = queue.enqueue('a', async (current) => { signal = current; await blocked.promise; });
    await vi.waitFor(() => expect(signal).toBeDefined());
    const skipped = vi.fn();
    const second = queue.enqueue('a', skipped);
    expect(queue.stop('a')).toBe(2);
    expect(signal.aborted).toBe(true);
    expect(queue.status('a')).toMatchObject({ stopping: true, pending: 0 });
    const later = vi.fn();
    const third = queue.enqueue('a', later);
    await queue.enqueue('b', async () => {});
    expect(later).not.toHaveBeenCalled();
    blocked.resolve();
    await Promise.all([first, second, third]);
    expect(skipped).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledOnce();
    expect(queue.stop('a')).toBe(0);
  });

  it('bounds cancellation acknowledgement when a provider ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const abort = vi.fn(() => new Promise<void>(() => {}));
      const stopped = requestGatewayAbort({ abort });
      await vi.advanceTimersByTimeAsync(1000);
      await stopped;
      expect(abort).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('does not leak a timer or swallow abort failures', async () => {
    await expect(requestGatewayAbort({ abort: async () => { throw new Error('abort failed'); } })).rejects.toThrow('abort failed');
    await requestGatewayAbort(undefined);
  });

  it('continues after a rejected message', async () => {
    const queue = new GatewayMessageQueue();
    await expect(queue.enqueue('a', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    const work = vi.fn();
    await queue.enqueue('a', work);
    expect(work).toHaveBeenCalledOnce();
  });
});
