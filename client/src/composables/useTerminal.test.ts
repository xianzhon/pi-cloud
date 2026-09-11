import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTerminalTheme, connectTerminal, createTerminalInstance, disconnectTerminal, disposeTerminal, fitTerminal, openTerminal } from './useTerminal';

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

  it('opens, fits, themes, and disposes terminal instances', () => {
    const instance = createTerminalInstance();
    openTerminal(instance, document.createElement('div'));
    openTerminal(instance, document.createElement('div'));
    fitTerminal(instance);
    applyTerminalTheme(instance, 'light');
    const disposable = { dispose: vi.fn() };
    instance.disposables.push(disposable);
    disposeTerminal(instance);
    expect(instance.terminal.open).toHaveBeenCalledTimes(1);
    expect(instance.terminal.focus).toHaveBeenCalledTimes(2);
    expect(disposable.dispose).toHaveBeenCalled();
    expect(instance.terminal.dispose).toHaveBeenCalled();
    disposeTerminal(instance);
  });

  it('handles created, output, exit, input, and resize socket events', () => {
    const instance = createTerminalInstance();
    let onData: (data: string) => void = () => undefined;
    let onResize: (size: { cols: number; rows: number }) => void = () => undefined;
    vi.mocked(instance.terminal.onData).mockImplementation((callback: any) => { onData = callback; return { dispose: vi.fn() }; });
    vi.mocked(instance.terminal.onResize).mockImplementation((callback: any) => { onResize = callback; return { dispose: vi.fn() }; });
    const created = vi.fn();
    const exited = vi.fn();
    connectTerminal(instance, 'client id', '/a b', created, exited);
    const socket = instance.socket as unknown as MockWebSocket;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: 'created', terminalId: 't1', shell: '' }) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'output', data: 'hello' }) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'exit', terminalId: 't1', exitCode: 2 }) });
    onData('ls');
    onResize({ cols: 100, rows: 40 });
    expect(socket.url).toContain('clientId=client id&cwd=%2Fa%20b');
    expect(created).toHaveBeenCalledWith('t1', 'bash');
    expect(exited).toHaveBeenCalledWith('t1', 2);
    expect(socket.send).toHaveBeenCalledTimes(3);

    connectTerminal(instance, 'other');
    expect(socket.close).toHaveBeenCalled();
  });

  it('does not send input before terminal creation or on a closed socket', () => {
    const instance = createTerminalInstance();
    let onData: (data: string) => void = () => undefined;
    vi.mocked(instance.terminal.onData).mockImplementation((callback: any) => { onData = callback; return { dispose: vi.fn() }; });
    connectTerminal(instance, 'client');
    const socket = instance.socket as unknown as MockWebSocket;
    onData('ignored');
    socket.readyState = 3;
    instance.terminalId.value = 't';
    onData('ignored');
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('does not notify expected websocket closes', () => {
    const instance = createTerminalInstance();
    const onDisconnect = vi.fn();

    connectTerminal(instance, 'client-1', '/workspace', undefined, undefined, onDisconnect);
    disconnectTerminal(instance);

    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
