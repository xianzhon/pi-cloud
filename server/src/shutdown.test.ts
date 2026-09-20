import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown } from './shutdown.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
});

describe('graceful shutdown', () => {
  it('removes signal handlers without exiting when the application is closed directly', async () => {
    app = Fastify();
    const runtime = Object.assign(new EventEmitter(), { exit: vi.fn() });
    installGracefulShutdown(app, runtime);
    await app.ready();

    await app.close();

    expect(runtime.listenerCount('SIGINT')).toBe(0);
    expect(runtime.listenerCount('SIGTERM')).toBe(0);
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it('cancels the deadline after successful shutdown', async () => {
    vi.useFakeTimers();
    app = Fastify();
    const runtime = Object.assign(new EventEmitter(), { exit: vi.fn() });
    installGracefulShutdown(app, runtime);
    await app.ready();

    runtime.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(4_000);

    expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits with failure when a cleanup hook throws', async () => {
    app = Fastify();
    const runtime = Object.assign(new EventEmitter(), { exit: vi.fn() });
    app.addHook('onClose', async () => { throw new Error('Cleanup failed'); });
    installGracefulShutdown(app, runtime);
    await app.ready();

    runtime.emit('SIGTERM');
    await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(runtime.listenerCount('SIGINT')).toBe(0);
    expect(runtime.listenerCount('SIGTERM')).toBe(0);
  });

  it('exits with failure if cleanup exceeds four seconds', async () => {
    vi.useFakeTimers();
    app = Fastify();
    const runtime = Object.assign(new EventEmitter(), { exit: vi.fn() });
    let finishCleanup!: () => void;
    app.addHook('onClose', () => new Promise<void>((resolve) => { finishCleanup = resolve; }));
    installGracefulShutdown(app, runtime);
    await app.ready();

    runtime.emit('SIGTERM');
    try {
      await vi.advanceTimersByTimeAsync(3_999);
      expect(runtime.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      finishCleanup();
    }
    await vi.runAllTimersAsync();
    expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(['SIGINT', 'SIGTERM'])('waits for cleanup before exiting on %s', async (signal) => {
    app = Fastify();
    const runtime = Object.assign(new EventEmitter(), { exit: vi.fn() });
    let finishCleanup!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { finishCleanup = resolve; }));
    app.addHook('onClose', cleanup);
    installGracefulShutdown(app, runtime);
    await app.ready();

    runtime.emit(signal);
    runtime.emit(signal);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(runtime.exit).not.toHaveBeenCalled();
    try {
      expect(runtime.emit('SIGINT')).toBe(true);
      expect(runtime.emit('SIGTERM')).toBe(true);
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      finishCleanup();
    }
    await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(runtime.listenerCount('SIGINT')).toBe(0);
    expect(runtime.listenerCount('SIGTERM')).toBe(0);
  });
});
