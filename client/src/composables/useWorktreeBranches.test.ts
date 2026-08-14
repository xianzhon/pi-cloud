import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorktreeBranches } from './useWorktreeBranches';
import { invalidateLaunchResourceCache } from './useLaunchResourceCache';

describe('useWorktreeBranches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateLaunchResourceCache();
  });

  it('loads local branches and optional copy files for a project path', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes('worktree-copy-files')
        ? { files: ['.env'] }
        : { branches: ['main', 'feature/a'] },
    })));

    const state = useWorktreeBranches();
    await state.loadBranches('client-1', '/repo/app');
    await state.loadCopyFiles('client-1', '/repo/app');

    expect(fetch).toHaveBeenCalledWith('/api/sessions/worktree-branches?clientId=client-1&projectPath=%2Frepo%2Fapp');
    expect(fetch).toHaveBeenCalledWith('/api/sessions/worktree-copy-files?clientId=client-1&projectPath=%2Frepo%2Fapp');
    expect(state.branches.value).toEqual(['main', 'feature/a']);
    expect(state.copyFiles.value).toEqual(['.env']);
    expect(state.error.value).toBe('');
  });

  it('keeps worktree branches available when optional copy files cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('worktree-copy-files')
      ? { ok: false, json: async () => ({ error: 'failed' }) }
      : { ok: true, json: async () => ({ branches: ['main', 'feature/a'] }) }
    ));

    const state = useWorktreeBranches();
    await state.loadBranches('client-1', '/repo/app');
    await state.loadCopyFiles('client-1', '/repo/app');

    expect(state.branches.value).toEqual(['main', 'feature/a']);
    expect(state.copyFiles.value).toEqual([]);
    expect(state.error.value).toBe('');
  });
});
