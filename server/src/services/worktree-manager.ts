import { execFile as execFileCallback } from 'child_process';
import { copyFile, mkdir, readdir } from 'fs/promises';
import { basename, dirname, isAbsolute, join } from 'path';
import { promisify } from 'util';
import type { CreateSessionWorktreeOptions, ResolvedWorktreeSession } from '../types';

const defaultExecFile = promisify(execFileCallback);

interface WorktreeManagerOptions {
  execFile?: (file: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
}

interface GitWorktreeEntry {
  path: string;
  branch?: string;
}

export type GitStatus =
  | { isGitRepo: true; branch: string; detached: boolean }
  | { isGitRepo: false };

export class WorktreeManager {
  private readonly execFile: NonNullable<WorktreeManagerOptions['execFile']>;

  constructor(options: WorktreeManagerOptions = {}) {
    this.execFile = options.execFile || defaultExecFile;
  }

  async listLocalBranches(projectPath: string): Promise<string[]> {
    const { stdout } = await this.execFile('git', ['branch', '--format=%(refname:short)'], { cwd: projectPath });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async getGitStatus(projectPath: string): Promise<GitStatus> {
    try {
      await this.getRepoRoot(projectPath);
      const branchResult = await this.execFile('git', ['branch', '--show-current'], { cwd: projectPath });
      const branch = branchResult.stdout.trim();
      if (branch) return { isGitRepo: true, branch, detached: false };

      const hashResult = await this.execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectPath });
      return { isGitRepo: true, branch: hashResult.stdout.trim(), detached: true };
    } catch {
      return { isGitRepo: false };
    }
  }

  async listRootIgnoredFiles(projectPath: string): Promise<string[]> {
    const baseRepoPath = await this.getRepoRoot(projectPath).catch(() => undefined);
    if (!baseRepoPath) return [];

    const files: string[] = [];
    const entries = await readdir(baseRepoPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !this.isRootFileName(entry.name)) continue;
      if (await this.isIgnored(baseRepoPath, entry.name)) files.push(entry.name);
    }

    return files.sort((a, b) => a.localeCompare(b));
  }

  async resolveSessionCwd(projectPath: string, worktree?: CreateSessionWorktreeOptions): Promise<ResolvedWorktreeSession> {
    if (!worktree || worktree.mode === 'none') return { cwd: projectPath };

    this.assertSafeBranchName(worktree.branchName);
    if (worktree.branchMode === 'new') this.assertSafeBranchName(worktree.baseBranch);

    const baseRepoPath = await this.getRepoRoot(projectPath);
    const existing = await this.findWorktreeForBranch(baseRepoPath, worktree.branchName);
    const worktreePath = existing || this.getManagedWorktreePath(baseRepoPath, worktree.branchName);

    if (!existing) {
      await mkdir(dirname(worktreePath), { recursive: true });
      if (worktree.branchMode === 'new') {
        await this.execFile('git', ['worktree', 'add', '-b', worktree.branchName, worktreePath, worktree.baseBranch], { cwd: baseRepoPath });
      } else {
        await this.execFile('git', ['worktree', 'add', worktreePath, worktree.branchName], { cwd: baseRepoPath });
      }
    }

    if (worktree.copyFile?.trim()) {
      await this.copyRootIgnoredFile(baseRepoPath, worktreePath, worktree.copyFile.trim());
    }

    return {
      cwd: worktreePath,
      metadata: {
        baseRepoPath,
        worktreePath,
        branchName: worktree.branchName,
        branchMode: worktree.branchMode,
        baseBranch: worktree.branchMode === 'new' ? worktree.baseBranch : undefined,
        worktreeManaged: true,
        worktreeStatus: 'active',
      },
    };
  }

  async removeWorktree(baseRepoPath: string, worktreePath: string): Promise<void> {
    await this.execFile('git', ['worktree', 'remove', '--force', worktreePath], { cwd: baseRepoPath });
  }

  async pullFastForwardOnly(baseRepoPath: string): Promise<void> {
    await this.execFile('git', ['pull', '--ff-only'], { cwd: baseRepoPath });
  }

  private async getRepoRoot(projectPath: string): Promise<string> {
    const { stdout } = await this.execFile('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
    return stdout.trim();
  }

  private getManagedWorktreePath(baseRepoPath: string, branchName: string): string {
    const repoName = basename(baseRepoPath);
    return join(dirname(baseRepoPath), `.${repoName}-worktrees`, this.safeBranchDir(branchName));
  }

  private async findWorktreeForBranch(baseRepoPath: string, branchName: string): Promise<string | undefined> {
    const { stdout } = await this.execFile('git', ['worktree', 'list', '--porcelain'], { cwd: baseRepoPath });
    return this.parseWorktrees(stdout).find((entry) => entry.branch === branchName)?.path;
  }

  private async copyRootIgnoredFile(baseRepoPath: string, worktreePath: string, fileName: string): Promise<void> {
    if (!this.isRootFileName(fileName)) throw new Error('Invalid worktree copy file');
    const candidates = await this.listRootIgnoredFiles(baseRepoPath);
    if (!candidates.includes(fileName)) throw new Error('Worktree copy file must be an ignored root-level file');
    await copyFile(join(baseRepoPath, fileName), join(worktreePath, fileName));
  }

  private async isIgnored(baseRepoPath: string, fileName: string): Promise<boolean> {
    try {
      await this.execFile('git', ['check-ignore', '--quiet', '--', fileName], { cwd: baseRepoPath });
      return true;
    } catch {
      return false;
    }
  }

  private parseWorktrees(output: string): GitWorktreeEntry[] {
    return output.split('\n\n').map((block) => {
      const entry: GitWorktreeEntry = { path: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length);
        if (line.startsWith('branch refs/heads/')) entry.branch = line.slice('branch refs/heads/'.length);
      }
      return entry;
    }).filter((entry) => entry.path);
  }

  private safeBranchDir(branchName: string): string {
    const sanitized = branchName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    let start = 0;
    let end = sanitized.length;
    while (sanitized[start] === '-') start += 1;
    while (end > start && sanitized[end - 1] === '-') end -= 1;
    return sanitized.slice(start, end) || 'branch';
  }

  private assertSafeBranchName(branchName: string): void {
    if (!branchName.trim() || branchName.includes('..') || branchName.startsWith('/') || branchName.includes('\\')) {
      throw new Error('Invalid branch name');
    }
  }

  private isRootFileName(name: string): boolean {
    return Boolean(name.trim()) && !isAbsolute(name) && !name.includes('/') && !name.includes('\\') && basename(name) === name;
  }
}

export const worktreeManager = new WorktreeManager();
