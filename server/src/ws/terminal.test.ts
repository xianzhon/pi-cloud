import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  terminal: { id: 'term-owned', shell: 'bash', pty: { onData: vi.fn(), onExit: vi.fn() } },
  create: vi.fn(),
  writeTo: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../auth/request.js', () => ({
  getSessionFromRequest: vi.fn(() => ({ username: 'me' })),
  getRequestContext: vi.fn(() => ({})),
}));

vi.mock('../services/terminal-manager.js', () => ({
  terminalManager: {
    create: mocks.create,
    writeTo: mocks.writeTo,
    resize: mocks.resize,
    dispose: mocks.dispose,
  },
}));

class FakeSocket {
  readonly sent: string[] = [];
  readonly close = vi.fn();
  private handlers = new Map<string, (data?: any) => void>();

  on(type: string, handler: (data?: any) => void) {
    this.handlers.set(type, handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  emit(type: string, data?: any) {
    this.handlers.get(type)?.(data);
  }
}

async function openSocket(cwd: string) {
  const routes = new Map<string, Function>();
  const app = {
    authServices: {
      authConfig: { trustProxy: false },
      sessions: {},
      audit: { record: vi.fn() },
    },
    get: vi.fn((routePath: string, _options: unknown, handler: Function) => routes.set(routePath, handler)),
  };
  const { terminalWebSocket } = await import('./terminal.js');
  await terminalWebSocket(app as any);
  const socket = new FakeSocket();
  await routes.get('/ws/terminal')!(socket, { query: { clientId: 'client-1', cwd }, headers: { host: 'localhost:3000' } });
  return socket;
}

describe('terminal websocket', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-terminal-'));
    process.env.PI_WEBUI_ALLOWED_ROOTS = tempDir;
    mocks.create.mockReturnValue(mocks.terminal);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    delete process.env.PI_WEBUI_ALLOWED_ROOTS;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('only writes to the terminal created for this socket', async () => {
    const socket = await openSocket(tempDir);

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', terminalId: 'term-other', data: 'bad' })));
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', terminalId: 'term-owned', data: 'ok' })));

    expect(mocks.writeTo).toHaveBeenCalledTimes(1);
    expect(mocks.writeTo).toHaveBeenCalledWith('term-owned', 'ok');
  });

  it('rejects cwd outside the configured allowed roots', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-terminal-outside-'));

    try {
      const socket = await openSocket(outsideDir);

      expect(socket.close).toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(socket.sent.map(message => JSON.parse(message))).toContainEqual(expect.objectContaining({ type: 'error' }));
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
