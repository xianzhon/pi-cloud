import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  terminal: {
    id: 'term-owned',
    shell: 'bash',
    attachmentId: null as symbol | null,
    pty: {
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    },
  },
  create: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  get: vi.fn(),
  setOutputHandler: vi.fn(() => ''),
  writeTo: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../auth/request.js', () => ({
  getSessionFromRequest: vi.fn(() => ({ username: 'me' })),
  getRequestContext: vi.fn(() => ({})),
}));

class FakeSocket {
  readonly sent: string[] = [];
  readonly close = vi.fn();
  readonly ping = vi.fn();
  readyState = 1;
  private handlers = new Map<string, (...data: any[]) => void>();

  on(type: string, handler: (...data: any[]) => void) {
    this.handlers.set(type, handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  emit(type: string, ...data: any[]) {
    this.handlers.get(type)?.(...data);
  }
}

async function openSocket(cwd: string, terminalId?: string) {
  const routes = new Map<string, Function>();
  const app = {
    authServices: {
      authConfig: { trustProxy: false },
      sessions: {},
      audit: { record: vi.fn() },
    },
    services: {
      terminals: {
        create: mocks.create,
        attach: mocks.attach,
        detach: mocks.detach,
        get: mocks.get,
        setOutputHandler: mocks.setOutputHandler,
        writeTo: mocks.writeTo,
        resize: mocks.resize,
        dispose: mocks.dispose,
      },
    },
    get: vi.fn((routePath: string, _options: unknown, handler: Function) => routes.set(routePath, handler)),
  };
  const { terminalWebSocket } = await import('./terminal.js');
  await terminalWebSocket(app as any);
  const socket = new FakeSocket();
  await routes.get('/ws/terminal')!(socket, {
    query: { clientId: 'client-1', cwd, terminalId },
    headers: { host: 'localhost:3000' },
    log: { info: vi.fn(), warn: vi.fn() },
  });
  return socket;
}

describe('terminal websocket', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-terminal-'));
    process.env.PI_CLOUD_ALLOWED_ROOTS = tempDir;
    vi.clearAllMocks();
    mocks.create.mockImplementation((_clientId, _cwd, _owner, attachmentId) => {
      mocks.terminal.attachmentId = attachmentId;
      return mocks.terminal;
    });
    mocks.attach.mockImplementation((_terminalId, _clientId, _owner, attachmentId) => {
      mocks.terminal.attachmentId = attachmentId;
      return mocks.terminal;
    });
    mocks.get.mockReturnValue(mocks.terminal);
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.PI_CLOUD_ALLOWED_ROOTS;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('only writes to the terminal created for this socket', async () => {
    const socket = await openSocket(tempDir);

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', terminalId: 'term-other', data: 'bad' })));
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', terminalId: 'term-owned', data: 'ok' })));

    expect(mocks.writeTo).toHaveBeenCalledTimes(1);
    expect(mocks.writeTo).toHaveBeenCalledWith('term-owned', 'ok');
  });

  it('sends server-originated heartbeat pings', async () => {
    vi.useFakeTimers();
    const socket = await openSocket(tempDir);

    vi.advanceTimersByTime(25_000);

    expect(socket.ping).toHaveBeenCalledOnce();
    socket.emit('close', 1000, Buffer.from('done'));
  });

  it('detaches on network loss and only disposes on an explicit close', async () => {
    const socket = await openSocket(tempDir);

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'dispose', terminalId: 'term-owned' })));
    expect(mocks.dispose).toHaveBeenCalledWith('term-owned');

    socket.emit('close', 1006, Buffer.from('network lost'));
    expect(mocks.detach).toHaveBeenCalledWith('term-owned', expect.any(Symbol));
  });

  it('reattaches an existing terminal without creating a new PTY', async () => {
    const socket = await openSocket(tempDir, 'term-owned');

    expect(mocks.attach).toHaveBeenCalledWith('term-owned', 'client-1', 'me', expect.any(Symbol));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(socket.sent.map(message => JSON.parse(message))).toContainEqual(expect.objectContaining({
      type: 'reattached',
      terminalId: 'term-owned',
    }));
  });

  it('rejects cwd outside the configured allowed roots', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-terminal-outside-'));

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
