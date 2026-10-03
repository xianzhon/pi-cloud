import { expect, it, vi } from 'vitest';
import { createRoutineExecutor } from './executor.js';
it('rejects a model error even when prompt resolves and disposes the runtime', async () => {
  const session = {
    sessionId: 's1',
    sessionManager: { getSessionFile: () => '/tmp/session' },
    prompt: async () => {},
    abort: async () => {},
    messages: [
      {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'provider failed',
      },
    ],
  };
  let disposed = false;
  const sessions = {
    listAgentProfileModels: async () => [{ provider: 'p', id: 'm' }],
    setClientAgentProfile: async () => {},
    createSession: async () => ({ session }),
    runForegroundWithClientProfileProxy: async (
      _: string,
      fn: () => Promise<void>,
    ) => fn(),
    releaseClient: () => {
      disposed = true;
    },
  };
  const store = { attachSession: vi.fn() };
  const execute = createRoutineExecutor(
    sessions as never,
    store as never,
    async () => '/tmp',
  );
  await expect(
    execute(
      {
        id: 'r1',
        snapshot: {
          projectPath: '/tmp',
          profileId: 'default',
          provider: 'p',
          modelId: 'm',
          prompt: 'check',
        },
      } as never,
      new AbortController().signal,
    ),
  ).rejects.toThrow('provider failed');
  expect(disposed).toBe(true);
  expect(store.attachSession).toHaveBeenCalledWith('r1', 's1', '/tmp/session');
});

it('does not prompt after cancellation while waiting for the profile execution context', async () => {
  const controller = new AbortController();
  let prompted = false;
  const session = {
    sessionId: 's1',
    sessionManager: { getSessionFile: () => '/tmp/session' },
    prompt: async () => {
      prompted = true;
    },
    abort: async () => {},
    messages: [
      {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'done' }],
      },
    ],
  };
  const sessions = {
    listAgentProfileModels: async () => [{ provider: 'p', id: 'm' }],
    setClientAgentProfile: async () => {},
    createSession: async () => ({ session }),
    runForegroundWithClientProfileProxy: async (
      _: string,
      fn: () => Promise<void>,
    ) => {
      controller.abort();
      return fn();
    },
    releaseClient: () => {},
  };
  const execute = createRoutineExecutor(
    sessions as never,
    { attachSession: () => {} } as never,
    async () => '/tmp',
  );
  await expect(
    execute(
      {
        id: 'r1',
        snapshot: {
          projectPath: '/tmp',
          profileId: 'default',
          provider: 'p',
          modelId: 'm',
          prompt: 'check',
        },
      } as never,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(prompted).toBe(false);
});
