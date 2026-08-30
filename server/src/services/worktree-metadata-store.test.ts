import { rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { WorktreeMetadataStore } from './worktree-metadata-store';

describe('WorktreeMetadataStore', () => {
  let db: PiCloudDatabase;
  let dbPath: string;
  let store: WorktreeMetadataStore;

  beforeEach(() => {
    dbPath = join(process.cwd(), `.tmp-worktree-store-${Date.now()}-${Math.random()}.sqlite`);
    db = openPiCloudDatabase(dbPath);
    store = new WorktreeMetadataStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dbPath, { force: true });
  });

  it('saves and reads active managed worktree metadata', () => {
    store.save({
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });

    expect(store.get('session-1')).toMatchObject({
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });
    expect(store.get('session-1')?.createdAt).toEqual(expect.any(String));
  });

  it('marks metadata as finished', () => {
    store.save({
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'existing',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });

    store.markFinished('session-1');

    expect(store.get('session-1')).toMatchObject({
      worktreeStatus: 'finished',
      finishedAt: expect.any(String),
    });
  });

  it('indexes worktree metadata by base repository path', () => {
    const indexes = db.prepare("PRAGMA index_list('session_worktrees')").all() as Array<{ name: string }>;

    expect(indexes.map((index) => index.name)).toContain('session_worktrees_base_repo_path_idx');
  });

  it('lists metadata by session ids', () => {
    store.save({
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'existing',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });

    expect(store.getMany(['missing', 'session-1'])).toEqual(new Map([
      ['session-1', expect.objectContaining({ sessionId: 'session-1' })],
    ]));
  });
});
