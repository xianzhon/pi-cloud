import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prompt = vi.fn(async (_text: string, options?: { preflightResult?: (accepted: boolean) => void }) => {
    options?.preflightResult?.(true);
  });
  const session = {
    sessionId: 'session-1',
    model: { provider: 'test', id: 'vision', input: ['text', 'image'] },
    sessionManager: { getCwd: vi.fn(() => '/project') },
    subscribe: vi.fn(() => () => {}),
    prompt,
    compact: vi.fn(),
    abort: vi.fn(),
    abortCompaction: vi.fn(),
  };
  const saveUploadedImages = vi.fn(async () => ['/project/tmp/upload_images/chart.png']);
  return { prompt, saveUploadedImages, session };
});

vi.mock('../auth/request.js', () => ({
  getSessionFromRequest: vi.fn(() => ({ username: 'me' })),
  getRequestContext: vi.fn(() => ({})),
}));

vi.mock('../services/uploaded-image-store.js', () => ({
  saveUploadedImages: mocks.saveUploadedImages,
}));

vi.mock('../services/session-manager.js', () => ({
  sessionService: {
    getSession: vi.fn(() => mocks.session),
    listSessions: vi.fn(async () => []),
    resumeSession: vi.fn(),
    cancelCleanup: vi.fn(),
    scheduleCleanup: vi.fn(),
    runWithClientProfileProxy: vi.fn(async (_clientId: string, fn: () => Promise<unknown>) => fn()),
    runForegroundWithClientProfileProxy: vi.fn(async (_clientId: string, fn: () => Promise<unknown>) => fn()),
    getRuntimeStatus: vi.fn(),
    forceDisposeBySessionId: vi.fn(),
  },
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

async function openSocket() {
  const routes = new Map<string, Function>();
  const app = {
    memoryRuntime: { onUpdated: vi.fn(() => () => {}), onRecall: vi.fn(() => () => {}) },
    authServices: {
      authConfig: { trustProxy: false },
      sessions: {},
      audit: { record: vi.fn() },
    },
    get: vi.fn((path: string, _options: unknown, handler: Function) => routes.set(path, handler)),
  };
  const { chatWebSocket } = await import('./chat.js');
  await chatWebSocket(app as any);
  const socket = new FakeSocket();
  routes.get('/ws/chat')!(socket, { query: { clientId: 'client-1' } });
  return socket;
}

describe('chat websocket', () => {
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
