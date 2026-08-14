import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expandHomePath } from '../utils/paths.js';
import { MemoryStore } from './store.js';
import type { MemoryProject } from './types.js';

export interface WorktreeLookup {
  get(sessionId: string): { baseRepoPath: string } | null;
}

export class MemoryProjectResolver {
  constructor(
    private readonly store: MemoryStore,
    private readonly worktrees: WorktreeLookup,
  ) {}

  async resolve(input: { profileId: string; cwd: string; sessionId?: string }): Promise<MemoryProject> {
    const worktree = input.sessionId ? this.worktrees.get(input.sessionId) : null;
    const scopedPath = worktree?.baseRepoPath || input.cwd;
    const absolutePath = resolve(expandHomePath(scopedPath));
    const canonicalPath = await realpath(absolutePath).catch(() => absolutePath);
    return this.store.getOrCreateProject(input.profileId, canonicalPath);
  }
}
