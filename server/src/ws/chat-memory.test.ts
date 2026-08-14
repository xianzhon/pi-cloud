import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendJson = vi.hoisted(() => vi.fn());
const getSessionFromRequest = vi.hoisted(() => vi.fn(() => ({ username: 'me' })));
const getRequestContext = vi.hoisted(() => vi.fn(() => ({})));
const sessionService = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSessions: vi.fn(async () => []),
  resumeSession: vi.fn(),
  getClientAgentProfile: vi.fn(),
  runWithClientProfileProxy: vi.fn(async (_clientId: string, work: () => Promise<unknown>) => work()),
  runForegroundWithClientProfileProxy: vi.fn(async (_clientId: string, work: () => Promise<unknown>) => work()),
  cancelCleanup: vi.fn(),
  scheduleCleanup: vi.fn(),
  getRuntimeStatus: vi.fn(() => ({ contextUsage: undefined })),
  forceDisposeBySessionId: vi.fn(),
}));

vi.mock('./safe-send.js', () => ({ sendJson }));
vi.mock('../auth/request.js', () => ({ getSessionFromRequest, getRequestContext }));
vi.mock('../services/session-manager.js', () => ({ sessionService }));

class FakeSocket {
  handlers = new Map<string, Function>();
  on = vi.fn((event: string, handler: Function) => { this.handlers.set(event, handler); });
  close = vi.fn();
}

function createAgentSession() {
  const unsubscribe = vi.fn();
  const session = {
    sessionId: 'session-1',
    subscribe: vi.fn(() => unsubscribe),
    prompt: vi.fn(async () => {}),
    compact: vi.fn(async () => ({ tokensBefore: 10, firstKeptEntryId: 'entry-1' })),
    abort: vi.fn(async () => {}),
    abortCompaction: vi.fn(),
  };
  return { session, unsubscribe };
}

async function setup() {
  let updateListener: Function | undefined;
  let recallListener: Function | undefined;
  const unsubscribeMemory = vi.fn();
  const unsubscribeRecall = vi.fn();
  const runtime = {
    onUpdated: vi.fn((listener: Function) => {
      updateListener = listener;
      return unsubscribeMemory;
    }),
    onRecall: vi.fn((listener: Function) => {
      recallListener = listener;
      return unsubscribeRecall;
    }),
  };
  const routes = new Map<string, Function>();
  const app = {
    authServices: {
      authConfig: { trustProxy: false },
      sessions: {},
      audit: { record: vi.fn() },
    },
    memoryRuntime: runtime,
    get: vi.fn((path: string, _options: unknown, handler: Function) => routes.set(path, handler)),
  };
  const { chatWebSocket } = await import('./chat.js');
  await chatWebSocket(app as any);
  const socket = new FakeSocket();
  routes.get('/ws/chat')!(socket, { query: { clientId: 'client-1' } });
  return {
    socket,
    runtime,
    unsubscribeMemory,
    unsubscribeRecall,
    get updateListener() { return updateListener!; },
    get recallListener() { return recallListener!; },
  };
}

describe('chat memory integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionFromRequest.mockReturnValue({ username: 'me' });
    sessionService.getClientAgentProfile.mockResolvedValue({
      id: 'default', label: 'default', path: '/profiles/default', isDefault: true,
    });
    sessionService.listSessions.mockResolvedValue([]);
    sessionService.runWithClientProfileProxy.mockImplementation(async (_clientId, work) => work());
    sessionService.runForegroundWithClientProfileProxy.mockImplementation(async (_clientId, work) => work());
  });

  it('sends metadata only to the currently matching profile and unsubscribes on close', async () => {
    const harness = await setup();
    const event = {
      profileId: 'default', projectId: 'project-1', extractionRunId: 'run-1',
      activeProjectCount: 2, pendingGlobalCount: 1, failed: false,
      memoryBody: 'must not cross the websocket',
    };

    await harness.updateListener(event);

    expect(sendJson).toHaveBeenCalledWith(harness.socket, {
      type: 'memory_updated',
      profileId: 'default',
      projectId: 'project-1',
      extractionRunId: 'run-1',
      activeProjectCount: 2,
      pendingGlobalCount: 1,
      failed: false,
    });

    sendJson.mockClear();
    sessionService.getClientAgentProfile.mockResolvedValueOnce({
      id: 'work', label: 'work', path: '/profiles/work', isDefault: false,
    });
    await harness.updateListener(event);
    expect(sendJson).not.toHaveBeenCalled();

    harness.socket.handlers.get('close')!();
    expect(harness.unsubscribeMemory).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeRecall).toHaveBeenCalledTimes(1);
    expect(sessionService.scheduleCleanup).toHaveBeenCalledWith('client-1');
    expect(harness.unsubscribeMemory.mock.invocationCallOrder[0])
      .toBeLessThan(sessionService.scheduleCleanup.mock.invocationCallOrder[0]);
  });

  it('sends recall traces only to the matching profile', async () => {
    const harness = await setup();
    const event = {
      profileId: 'default', projectId: 'project-1', sessionId: 'session-1', injected: true,
      tokenCount: 42, memories: [{ id: 'memory-1', content: 'Remembered', scope: 'project', category: 'fact', reason: 'query-match' }],
      diagnostics: {
        candidateIds: ['memory-1'], rejectedBelowThresholdIds: [], redundancyRejectedIds: [],
        selected: [{ id: 'memory-1', score: 1.2, components: { exactEntity: 0.55 } }],
        budgetCeiling: 800, usedTokens: 42, overflow: false,
        countingMethod: 'local-unicode-v1', rankingPolicyVersion: 'adaptive-lexical-v1',
        promptFormatVersion: 'memory-prompt-v2',
      },
      prompt: 'must not cross the websocket', createdAt: '2026-08-09T00:00:00.000Z',
    };

    await harness.recallListener(event);

    expect(sendJson).toHaveBeenCalledWith(harness.socket, {
      type: 'memory_recall',
      profileId: 'default',
      projectId: 'project-1',
      sessionId: 'session-1',
      injected: true,
      tokenCount: 42,
      memories: event.memories,
      diagnostics: event.diagnostics,
      createdAt: '2026-08-09T00:00:00.000Z',
    });

    sendJson.mockClear();
    sessionService.getClientAgentProfile.mockResolvedValueOnce({
      id: 'work', label: 'work', path: '/profiles/work', isDefault: false,
    });
    await harness.recallListener(event);
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('runs prompts, compaction, steering, and follow-ups through foreground priority', async () => {
    const { session } = createAgentSession();
    sessionService.getSession.mockReturnValue(session);
    let insideForeground = false;
    sessionService.runForegroundWithClientProfileProxy.mockImplementation(async (_clientId, work) => {
      insideForeground = true;
      try {
        return await work();
      } finally {
        insideForeground = false;
      }
    });
    session.prompt.mockImplementation(async () => {
      expect(insideForeground).toBe(true);
    });
    session.compact.mockImplementation(async () => {
      expect(insideForeground).toBe(true);
      return { tokensBefore: 10, firstKeptEntryId: 'entry-1' };
    });
    const harness = await setup();
    const handleMessage = harness.socket.handlers.get('message')!;

    await handleMessage(Buffer.from(JSON.stringify({ type: 'prompt', payload: { text: 'hello' } })));
    await handleMessage(Buffer.from(JSON.stringify({ type: 'prompt', payload: { text: '/compact focus' } })));
    await handleMessage(Buffer.from(JSON.stringify({ type: 'steer', payload: { text: 'change course' } })));
    await handleMessage(Buffer.from(JSON.stringify({ type: 'followUp', payload: { text: 'then summarize' } })));

    expect(sessionService.runForegroundWithClientProfileProxy).toHaveBeenCalledTimes(4);
    expect(sessionService.runWithClientProfileProxy).not.toHaveBeenCalled();
    expect(session.prompt).toHaveBeenCalledWith('hello', { preflightResult: undefined });
    expect(session.prompt).toHaveBeenCalledWith('change course', { streamingBehavior: 'steer' });
    expect(session.prompt).toHaveBeenCalledWith('then summarize', { streamingBehavior: 'followUp' });
    expect(session.compact).toHaveBeenCalledWith('focus');
  });
});
