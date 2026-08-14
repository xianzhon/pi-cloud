import { describe, expect, it } from 'vitest';
import { openPiuiDatabase } from '../db/database';
import { SessionActivityStore } from './session-activity-store';

describe('SessionActivityStore', () => {
  it('stores commit and PR activity for a session', () => {
    const db = openPiuiDatabase(':memory:');
    const store = new SessionActivityStore(db, { now: () => '2026-07-22T00:00:00.000Z' });

    store.recordCommit({
      sessionId: 'session-1',
      cwd: '/repo/app',
      message: 'Add feature',
      commit: 'abcdef1234567890',
      files: [{ status: 'M', path: 'src/app.ts' }],
      mode: 'commit',
    });
    store.recordPr({
      sessionId: 'session-1',
      cwd: '/repo/app',
      owner: 'owner',
      repo: 'repo',
      number: 17,
      url: 'https://git.example.com/owner/repo/pulls/17',
      title: 'Add feature',
      sourceBranch: 'feature/app',
      targetBranch: 'main',
      commit: 'abcdef1234567890',
    });
    store.recordBranchDeleted({
      sessionId: 'session-1',
      cwd: '/repo/app',
      branch: 'feature/app',
      commit: 'abcdef1234567890',
    });

    expect(store.listForSession('session-1')).toMatchObject([
      {
        sessionId: 'session-1',
        kind: 'commit_created',
        data: { cwd: '/repo/app', message: 'Add feature', commit: 'abcdef1234567890', files: [{ status: 'M', path: 'src/app.ts' }] },
        createdAt: '2026-07-22T00:00:00.000Z',
      },
      {
        sessionId: 'session-1',
        kind: 'pr_created',
        data: { number: 17, url: 'https://git.example.com/owner/repo/pulls/17', title: 'Add feature', sourceBranch: 'feature/app', targetBranch: 'main', commit: 'abcdef1234567890' },
        createdAt: '2026-07-22T00:00:00.000Z',
      },
      {
        sessionId: 'session-1',
        kind: 'branch_deleted',
        data: { cwd: '/repo/app', branch: 'feature/app', commit: 'abcdef1234567890' },
        createdAt: '2026-07-22T00:00:00.000Z',
      },
    ]);
    expect(store.listForSession('other-session')).toEqual([]);
    expect(store.listLatestPrForSessions(['session-1', 'other-session']).get('session-1')).toMatchObject({
      kind: 'pr_created',
      data: { number: 17, url: 'https://git.example.com/owner/repo/pulls/17' },
    });
    expect(store.listLatestPrForSessions(['other-session'])).toEqual(new Map());
    const prActivity = store.listLatestPrForSessions(['session-1']).get('session-1');
    expect(prActivity).toBeDefined();
    expect(store.updatePrStatus(prActivity!.id, 'merged', '2026-07-22T00:05:00.000Z')).toMatchObject({
      data: { status: 'merged', checkedAt: '2026-07-22T00:05:00.000Z' },
    });

    db.close();
  });

  it('ignores activity without a session id', () => {
    const db = openPiuiDatabase(':memory:');
    const store = new SessionActivityStore(db);

    expect(store.recordCommit({
      sessionId: undefined,
      cwd: '/repo/app',
      message: 'Add feature',
      commit: 'abcdef1234567890',
      files: [],
      mode: 'commit',
    })).toBeNull();

    db.close();
  });
});
