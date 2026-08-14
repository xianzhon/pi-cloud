import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebuiAutoRenameExtension } from './auto-rename';

function createPiMock() {
  return {
    on: vi.fn(),
    getSessionName: vi.fn(),
    setSessionName: vi.fn(),
  };
}

describe('createWebuiAutoRenameExtension', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  function tempAgentDir() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-webui-auto-rename-'));
    dirs.push(dir);
    return dir;
  }

  it('registers auto-rename lifecycle hooks when no user plugin is installed', () => {
    const pi = createPiMock();

    const extension = createWebuiAutoRenameExtension({ model: { provider: 'anthropic', id: 'claude-haiku-4-5' }, language: 'english' }, tempAgentDir()) as { factory: (pi: unknown) => void };

    extension.factory(pi as any);

    expect(pi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith('message_end', expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
  });

  it('does not register hooks when the selected profile already has pi-auto-rename installed', () => {
    const agentDir = tempAgentDir();
    mkdirSync(join(agentDir, 'extensions', 'pi-auto-rename'), { recursive: true });
    writeFileSync(join(agentDir, 'extensions', 'pi-auto-rename', 'index.ts'), 'export default function () {}\n');
    const pi = createPiMock();

    const extension = createWebuiAutoRenameExtension({ model: { provider: 'anthropic', id: 'claude-haiku-4-5' }, language: 'english' }, agentDir) as { factory: (pi: unknown) => void };

    extension.factory(pi as any);

    expect(pi.on).not.toHaveBeenCalled();
  });
});
