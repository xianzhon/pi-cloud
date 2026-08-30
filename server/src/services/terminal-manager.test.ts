import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn(() => ({
  onData: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}));

vi.mock('@lydell/node-pty', () => ({ default: { spawn }, spawn }));

const { TerminalManager } = await import('./terminal-manager.js');

describe('TerminalManager', () => {
  beforeEach(() => {
    spawn.mockClear();
    vi.stubEnv('PI_CLOUD_TERMINAL_SHELL', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses process.env directly and does not read profile proxy files', () => {
    const manager = new TerminalManager();
    manager.create('client-1', '/workspace');

    expect(spawn).toHaveBeenCalledWith(expect.any(String), [], expect.objectContaining({
      env: process.env,
    }));
  });

  it('uses the configured terminal shell', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('PI_CLOUD_TERMINAL_SHELL', 'pwsh.exe');
    vi.stubEnv('COMSPEC', 'C:\\Windows\\System32\\cmd.exe');

    const manager = new TerminalManager();
    const terminal = manager.create('client-1', 'D:\\develop\\project');

    expect(spawn).toHaveBeenCalledWith('pwsh.exe', [], expect.any(Object));
    expect(terminal.shell).toBe('pwsh.exe');
  });

  it('uses the Windows command shell from COMSPEC', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('COMSPEC', 'C:\\Windows\\System32\\cmd.exe');

    const manager = new TerminalManager();
    const terminal = manager.create('client-1', 'D:\\develop\\project');

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      [],
      expect.objectContaining({ cwd: 'D:\\develop\\project' }),
    );
    expect(terminal.shell).toBe('cmd.exe');
  });
});
