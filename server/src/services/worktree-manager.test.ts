import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeManager } from './worktree-manager';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

type ExecFile = (file: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
const execFile = vi.fn<ExecFile>();

function manager() {
  return new WorktreeManager({ execFile });
}

describe('WorktreeManager', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  it('lists local branches without current-branch marker', async () => {
    execFile.mockResolvedValueOnce({ stdout: 'main\nfeature/a\n', stderr: '' });

    await expect(manager().listLocalBranches('/repo/app')).resolves.toEqual(['main', 'feature/a']);
    expect(execFile).toHaveBeenCalledWith('git', ['branch', '--format=%(refname:short)'], { cwd: '/repo/app' });
  });

  it('returns the current branch for a git project', async () => {
    execFile
      .mockResolvedValueOnce({ stdout: '/repo/app\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'feature/a\n', stderr: '' });

    await expect(manager().getGitStatus('/repo/app')).resolves.toEqual({
      isGitRepo: true,
      branch: 'feature/a',
      detached: false,
    });
  });

  it('returns a detached short hash when no branch is checked out', async () => {
    execFile
      .mockResolvedValueOnce({ stdout: '/repo/app\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'abc1234\n', stderr: '' });

    await expect(manager().getGitStatus('/repo/app')).resolves.toEqual({
      isGitRepo: true,
      branch: 'abc1234',
      detached: true,
    });
  });

  it('returns non-git status when the path is not in a git project', async () => {
    execFile.mockRejectedValueOnce(new Error('not a git repository'));

    await expect(manager().getGitStatus('/tmp')).resolves.toEqual({ isGitRepo: false });
  });

  it('creates a hidden sibling worktree for a new branch', async () => {
    execFile
      .mockResolvedValueOnce({ stdout: '/tmp/repo/app\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await manager().resolveSessionCwd('/tmp/repo/app', {
      mode: 'managed',
      branchMode: 'new',
      branchName: 'feature/a',
      baseBranch: 'main',
    });

    expect(result.cwd).toBe('/tmp/repo/.app-worktrees/feature-a');
    expect(result.metadata).toMatchObject({
      baseRepoPath: '/tmp/repo/app',
      worktreePath: '/tmp/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });
    expect(execFile).toHaveBeenLastCalledWith('git', ['worktree', 'add', '-b', 'feature/a', '/tmp/repo/.app-worktrees/feature-a', 'main'], { cwd: '/tmp/repo/app' });
  });

  it('reuses an existing worktree for the branch', async () => {
    execFile
      .mockResolvedValueOnce({ stdout: '/repo/app\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'worktree /repo/.app-worktrees/feature-a\nbranch refs/heads/feature/a\n\n', stderr: '' });

    const result = await manager().resolveSessionCwd('/repo/app', {
      mode: 'managed',
      branchMode: 'existing',
      branchName: 'feature/a',
    });

    expect(result.cwd).toBe('/repo/.app-worktrees/feature-a');
    expect(execFile).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']), expect.anything());
  });

  it('force removes managed worktrees during cleanup', async () => {
    execFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await manager().removeWorktree('/repo/app', '/repo/.app-worktrees/feature-a');

    expect(execFile).toHaveBeenCalledWith('git', ['worktree', 'remove', '--force', '/repo/.app-worktrees/feature-a'], { cwd: '/repo/app' });
  });

  it('pulls the base repository with fast-forward only', async () => {
    execFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await manager().pullFastForwardOnly('/repo/app');

    expect(execFile).toHaveBeenCalledWith('git', ['pull', '--ff-only'], { cwd: '/repo/app' });
  });

  it('returns no copy-file candidates when the path is not in a git project', async () => {
    execFile.mockRejectedValueOnce(new Error('not a git repository'));

    await expect(manager().listRootIgnoredFiles('/tmp')).resolves.toEqual([]);
  });

  it('lists ignored root files including .env', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'worktree-manager-'));
    try {
      await writeFile(join(repoPath, '.env'), 'TOKEN=secret\n');
      await writeFile(join(repoPath, '.env.example'), 'TOKEN=\n');
      await mkdir(join(repoPath, '.cache'));
      await writeFile(join(repoPath, '.cache', 'state'), 'ignored directory\n');
      execFile.mockImplementation(async (_file, args) => {
        if (args[0] === 'rev-parse') return { stdout: `${repoPath}\n`, stderr: '' };
        if (args[0] === 'check-ignore' && args.at(-1) === '.env') return { stdout: '', stderr: '' };
        throw new Error('not ignored');
      });

      await expect(manager().listRootIgnoredFiles(repoPath)).resolves.toEqual(['.env']);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it('copies a selected ignored root file into a managed worktree', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'worktree-manager-'));
    let worktreePath = '';
    try {
      await writeFile(join(repoPath, '.env'), 'TOKEN=secret\n');
      execFile.mockImplementation(async (_file, args) => {
        if (args[0] === 'rev-parse') return { stdout: `${repoPath}\n`, stderr: '' };
        if (args[0] === 'worktree' && args[1] === 'list') return { stdout: '', stderr: '' };
        if (args[0] === 'worktree' && args[1] === 'add') {
          worktreePath = args[2];
          await mkdir(worktreePath, { recursive: true });
          return { stdout: '', stderr: '' };
        }
        if (args[0] === 'check-ignore' && args.at(-1) === '.env') return { stdout: '', stderr: '' };
        throw new Error('unexpected git command');
      });

      const result = await manager().resolveSessionCwd(repoPath, {
        mode: 'managed',
        branchMode: 'existing',
        branchName: 'feature/a',
        copyFile: '.env',
      });

      expect(result.cwd).toBe(worktreePath);
      await expect(readFile(join(worktreePath, '.env'), 'utf8')).resolves.toBe('TOKEN=secret\n');
    } finally {
      await rm(repoPath, { recursive: true, force: true });
      if (worktreePath) await rm(worktreePath, { recursive: true, force: true });
    }
  });

  it('rejects unsafe branch names', async () => {
    await expect(manager().resolveSessionCwd('/repo/app', {
      mode: 'managed',
      branchMode: 'existing',
      branchName: '../bad',
    })).rejects.toThrow('Invalid branch name');
  });
});
