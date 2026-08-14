import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { MemoryProjectResolver } from './project-resolver.js';
import { MemoryStore } from './store.js';

describe('MemoryProjectResolver', () => {
  let tempDir: string;
  let db: PiuiDatabase;
  let store: MemoryStore;
  const worktrees = new Map<string, { baseRepoPath: string }>();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'piui-memory-project-'));
    db = openPiuiDatabase(':memory:');
    store = new MemoryStore(db);
    worktrees.clear();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function createResolver() {
    return new MemoryProjectResolver(store, {
      get: (sessionId) => worktrees.get(sessionId) || null,
    });
  }

  it('maps managed worktrees to the canonical base project', async () => {
    const basePath = join(tempDir, 'app');
    const worktreePath = join(tempDir, 'feature');
    await mkdir(basePath);
    await mkdir(worktreePath);
    worktrees.set('session-1', { baseRepoPath: basePath });

    const project = await createResolver().resolve({
      profileId: 'default',
      cwd: worktreePath,
      sessionId: 'session-1',
    });

    expect(project.canonicalPath).toBe(await realpath(basePath));
  });

  it('canonicalizes symlinks and keeps separate clones distinct', async () => {
    const basePath = join(tempDir, 'app');
    const clonePath = join(tempDir, 'app-clone');
    const linkPath = join(tempDir, 'app-link');
    await mkdir(basePath);
    await mkdir(clonePath);
    await symlink(basePath, linkPath);
    const resolver = createResolver();

    const base = await resolver.resolve({ profileId: 'default', cwd: basePath });
    const linked = await resolver.resolve({ profileId: 'default', cwd: linkPath });
    const clone = await resolver.resolve({ profileId: 'default', cwd: clonePath });

    expect(linked.id).toBe(base.id);
    expect(clone.id).not.toBe(base.id);
  });

  it('falls back to an absolute normalized path when it does not exist', async () => {
    const missingPath = join(tempDir, 'missing', '..', 'moved-app');

    const project = await createResolver().resolve({ profileId: 'default', cwd: missingPath });

    expect(project.canonicalPath).toBe(resolve(missingPath));
  });

  it('isolates the same canonical path by profile', async () => {
    const basePath = join(tempDir, 'app');
    await mkdir(basePath);
    const resolver = createResolver();

    const defaultProject = await resolver.resolve({ profileId: 'default', cwd: basePath });
    const workProject = await resolver.resolve({ profileId: 'work', cwd: basePath });

    expect(workProject.id).not.toBe(defaultProject.id);
  });
});
