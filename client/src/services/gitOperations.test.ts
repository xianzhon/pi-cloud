import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitOperations } from './gitOperations';

describe('gitOperations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) })));
  });

  it('encodes status options without changing the working directory', async () => {
    await createGitOperations().getStatus({ cwd: '/work tree', message: 'fix it', stagedOnly: true });

    expect(fetch).toHaveBeenCalledWith('/api/git/status?cwd=%2Fwork+tree&message=fix+it&stagedOnly=true');
  });

  it('encodes history pagination options', async () => {
    await createGitOperations().getHistory({ cwd: '/work tree', page: 2 });

    expect(fetch).toHaveBeenCalledWith('/api/git/history?cwd=%2Fwork+tree&page=2');
  });

  it('sends branch switching options as JSON', async () => {
    await createGitOperations().switchBranch({
      cwd: '/workspace', name: 'feature/test', pull: true, deleteOriginal: false, sessionId: 'session-1',
    });

    expect(fetch).toHaveBeenCalledWith('/api/git/switch-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/workspace', name: 'feature/test', pull: true, deleteOriginal: false, sessionId: 'session-1' }),
    });
  });
});
