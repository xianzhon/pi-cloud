import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTerminal, createTerminalInstance, disconnectTerminal } from './useTerminal';

const { MockTerminal } = vi.hoisted(() => {
  class MockTerminal {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }

    cols = 80;
    rows = 24;
    writes: string[] = [];
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    write = vi.fn((data: string) => this.writes.push(data));
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
  }
  return { MockTerminal };
});

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor(public readonly url: string) {}
}

describe('useTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('uses the bundled Nerd Font before system fallbacks', () => {
    const instance = createTerminalInstance();

    expect(instance.terminal.options.fontFamily).toContain("'Pi Terminal Nerd Font'");
  });

  it('notifies unexpected websocket disconnects so the stale tab can be removed', () => {
    const instance = createTerminalInstance();
    const onDisconnect = vi.fn();

    connectTerminal(instance, 'client-1', '/workspace', undefined, undefined, onDisconnect);

    const socket = instance.socket as unknown as MockWebSocket;
    socket.onclose?.();

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(instance.socket).toBeNull();
    expect(instance.terminalId.value).toBeUndefined();
  });

  it('does not notify expected websocket closes', () => {
    const instance = createTerminalInstance();
    const onDisconnect = vi.fn();

    connectTerminal(instance, 'client-1', '/workspace', undefined, undefined, onDisconnect);
    disconnectTerminal(instance);

    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
