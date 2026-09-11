import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prompt = vi.fn(async (_text: string, options?: { preflightResult?: (accepted: boolean) => void }) => {
    options?.preflightResult?.(true);
  });
  const session = {
    sessionId: 'session-1',
    model: { provider: 'test', id: 'vision', input: ['text', 'image'] },
    sessionManager: { getCwd: vi.fn(() => '/project') },
    subscribe: vi.fn((_callback?: (event: unknown) => void) => () => {}),
    prompt,
    compact: vi.fn(),
    abort: vi.fn(),
    abortCompaction: vi.fn(),
  };
  const saveUploadedImages = vi.fn(async () => ['/project/tmp/upload_images/chart.png']);
  const sessionService = {
    getSession: vi.fn(() => session),
    listSessions: vi.fn(async () => []),
    resumeSession: vi.fn(),
    cancelCleanup: vi.fn(),
    scheduleCleanup: vi.fn(),
    runWithClientProfileProxy: vi.fn(async (_clientId: string, fn: () => Promise<unknown>) => fn()),
    runForegroundWithClientProfileProxy: vi.fn(async (_clientId: string, fn: () => Promise<unknown>) => fn()),
    getRuntimeStatus: vi.fn(),
    isSessionStreaming: vi.fn(() => false),
    markSessionStreamingStarted: vi.fn(() => 1_000),
    getSessionStreamingStartedAt: vi.fn(() => 1_000),
    markSessionStreamingFinished: vi.fn(),
    forceDisposeBySessionId: vi.fn(),
  };
  return { prompt, saveUploadedImages, session, sessionService };
});

vi.mock('../auth/request.js', () => ({
  getSessionFromRequest: vi.fn(() => ({ username: 'me' })),
  getRequestContext: vi.fn(() => ({})),
}));

vi.mock('../services/uploaded-image-store.js', () => ({
  saveUploadedImages: mocks.saveUploadedImages,
}));

class FakeSocket {
  readonly OPEN = 1;
  readonly readyState = 1;
  readonly sent: string[] = [];
  private handlers = new Map<string, (data?: any) => void>();

  on(type: string, handler: (data?: any) => void) {
    this.handlers.set(type, handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  emit(type: string, data?: any) {
    this.handlers.get(type)?.(data);
  }
}

async function createSocketServer() {
  const routes = new Map<string, Function>();
  const app = {
    memoryRuntime: { onUpdated: vi.fn(() => () => {}), onRecall: vi.fn(() => () => {}) },
    authServices: {
      authConfig: { trustProxy: false },
      sessions: {},
      audit: { record: vi.fn() },
    },
    services: { sessions: mocks.sessionService },
    get: vi.fn((path: string, _options: unknown, handler: Function) => routes.set(path, handler)),
  };
  const { chatWebSocket } = await import('./chat.js');
  await chatWebSocket(app as any);
  return (clientId = 'client-1') => {
    const socket = new FakeSocket();
    routes.get('/ws/chat')!(socket, { query: { clientId } });
    return socket;
  };
}

async function openSocket() {
  return (await createSocketServer())();
}

describe('chat websocket', () => {
  it('keeps a streaming session running when the client disconnects', async () => {
    const session = mocks.session as typeof mocks.session & { isStreaming?: boolean };
    session.isStreaming = true;
    mocks.session.abort.mockClear();
    const cancelCleanupCalls = mocks.sessionService.cancelCleanup.mock.calls.length;
    const scheduleCleanupCalls = mocks.sessionService.scheduleCleanup.mock.calls.length;
    const socket = await openSocket();

    socket.emit('close');

    expect(mocks.session.abort).not.toHaveBeenCalled();
    expect(mocks.sessionService.cancelCleanup).toHaveBeenCalledTimes(cancelCleanupCalls + 1);
    expect(mocks.sessionService.scheduleCleanup).toHaveBeenCalledTimes(scheduleCleanupCalls + 1);
    expect(mocks.sessionService.scheduleCleanup).toHaveBeenLastCalledWith('client-1');
    delete session.isStreaming;
  });

  it('broadcasts stream events and completion to every client watching the session', async () => {
    const open = await createSocketServer();
    const desktop = open('desktop');
    const mobile = open('mobile');
    mobile.emit('message', Buffer.from(JSON.stringify({
      type: 'watch', payload: { sessionId: 'session-1' },
    })));

    let publishEvent: ((event: unknown) => void) | undefined;
    mocks.session.subscribe.mockImplementationOnce((callback?: (event: unknown) => void) => {
      publishEvent = callback;
      return () => {};
    });
    let finishPrompt: (() => void) | undefined;
    mocks.prompt.mockImplementationOnce(() => new Promise<void>((resolve) => { finishPrompt = resolve; }));

    desktop.emit('message', Buffer.from(JSON.stringify({
      type: 'prompt', payload: { text: 'Implement', sessionId: 'session-1' },
    })));
    await vi.waitFor(() => expect(publishEvent).toBeDefined());
    publishEvent!({ type: 'agent_start' });
    publishEvent!({ type: 'agent_end' });
    finishPrompt!();

    await vi.waitFor(() => expect(mobile.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: 'status', sessionId: 'session-1', status: 'idle',
    }));
    expect(mobile.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: 'event', sessionId: 'session-1', event: { type: 'agent_start' }, streamingStartedAt: 1_000,
    });
    expect(mobile.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: 'event', sessionId: 'session-1', event: { type: 'agent_end' }, streamingStartedAt: 1_000,
    });
    mocks.prompt.mockClear();
  });

  it('acknowledges requested prompt preflight acceptance', async () => {
    const socket = await openSocket();

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'prompt',
      payload: { text: 'Implement', sessionId: 'session-1', requestId: 'request-1' },
    })));
    await vi.waitFor(() => expect(mocks.prompt).toHaveBeenCalled());

    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: 'prompt_preflight',
      sessionId: 'session-1',
      requestId: 'request-1',
      accepted: true,
    });
  });

  it('passes validated images to Pi for prompt, steer, and follow-up messages', async () => {
    const image = {
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
      name: 'chart.png',
    };
    const socket = await openSocket();

    for (const type of ['prompt', 'steer', 'followUp'] as const) {
      mocks.prompt.mockClear();
      socket.emit('message', Buffer.from(JSON.stringify({
        type,
        payload: { text: '', sessionId: 'session-1', requestId: `${type}-request`, images: [image] },
      })));
      await vi.waitFor(() => expect(mocks.prompt).toHaveBeenCalled());
      expect(mocks.saveUploadedImages).toHaveBeenCalledWith('/project', [
        { type: 'image', data: image.data, mimeType: image.mimeType },
      ], ['chart.png']);
      expect(mocks.prompt).toHaveBeenCalledWith(expect.stringContaining('/project/tmp/upload_images/chart.png'), expect.objectContaining({
        images: [{ type: 'image', data: image.data, mimeType: image.mimeType }],
        ...(type === 'prompt' ? {} : { streamingBehavior: type === 'steer' ? 'steer' : 'followUp' }),
      }));
      expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual(expect.objectContaining({
        type: 'prompt_preflight',
        requestId: `${type}-request`,
        accepted: true,
        imagePaths: ['/project/tmp/upload_images/chart.png'],
      }));
    }
  });

  it.each([
    ['unknown model capability', [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }], undefined, 'model_image_unsupported'],
    ['unsupported MIME type', [{ type: 'image', data: 'c3Zn', mimeType: 'image/svg+xml' }], ['text', 'image'], 'image_type_unsupported'],
    ['malformed base64', [{ type: 'image', data: 'not base64!', mimeType: 'image/png' }], ['text', 'image'], 'image_malformed'],
    ['more than four images', Array.from({ length: 5 }, () => ({ type: 'image', data: 'eA==', mimeType: 'image/png' })), ['text', 'image'], 'image_limit_exceeded'],
    ['an oversized image', [{ type: 'image', data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/png' }], ['text', 'image'], 'image_too_large'],
  ])('rejects %s before calling Pi', async (_label, images, input, code) => {
    mocks.session.model = { provider: 'test', id: 'vision', ...(input ? { input } : {}) } as any;
    mocks.prompt.mockClear();
    const socket = await openSocket();

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'prompt',
      payload: { text: 'inspect', sessionId: 'session-1', requestId: 'reject-request', images },
    })));

    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual(expect.objectContaining({
      type: 'prompt_preflight', requestId: 'reject-request', accepted: false, code,
    }));
  });
});
