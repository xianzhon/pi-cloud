import { describe, expect, it, vi } from 'vitest';
import { createWebuiAutoRenameExtension } from './auto-rename';

function createPiMock() {
  return {
    on: vi.fn(),
    getSessionName: vi.fn(),
    setSessionName: vi.fn(),
  };
}

describe('createWebuiAutoRenameExtension', () => {
  it('always registers auto-rename lifecycle hooks', () => {
    const pi = createPiMock();
    const extension = createWebuiAutoRenameExtension({
      model: { provider: 'anthropic', id: 'claude-haiku-4-5' },
      language: 'english',
    }) as { factory: (pi: unknown) => void };

    extension.factory(pi as any);

    expect(pi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith('message_end', expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
  });
});
