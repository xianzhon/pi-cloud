import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function createStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

async function importComposable() {
  vi.resetModules();
  return import('./useWebSocket');
}

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    MockWebSocket.instances = [];
    vi.stubGlobal('localStorage', createStorageStub());
    vi.stubGlobal('sessionStorage', createStorageStub());
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', { randomUUID: () => 'client-1' });
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost', host: 'localhost:5173', protocol: 'http:' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a singleton connection using the tab client id', async () => {
    const { useWebSocket } = await importComposable();

    const first = useWebSocket();
    const second = useWebSocket();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:5173/ws/chat?clientId=client-1');
    expect(first.clientId).toBe(second.clientId);
  });

  it('emits connected and typed message events', async () => {
    const { useWebSocket } = await importComposable();
    const ws = useWebSocket();
    const connected = vi.fn();
    const message = vi.fn();

    ws.on('connected', connected);
    ws.on('agent_message', message);

    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].receive({ type: 'agent_message', content: 'hello' });

    expect(ws.isConnected.value).toBe(true);
    expect(connected).toHaveBeenCalledOnce();
    expect(message).toHaveBeenCalledWith({ type: 'agent_message', content: 'hello' });
  });

  it('sends JSON only when the socket is open', async () => {
    const { useWebSocket } = await importComposable();
    const ws = useWebSocket();

    expect(ws.send({ type: 'prompt', content: 'before-open' })).toBe(false);
    expect(MockWebSocket.instances[0].sent).toEqual([]);

    MockWebSocket.instances[0].open();
    expect(ws.send({ type: 'prompt', content: 'after-open' })).toBe(true);

    expect(MockWebSocket.instances[0].sent).toEqual([
      JSON.stringify({ type: 'prompt', content: 'after-open' }),
    ]);
  });

  it('does not reconnect after manual close', async () => {
    const { useWebSocket } = await importComposable();
    const ws = useWebSocket();

    ws.close();
    vi.runOnlyPendingTimers();

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
