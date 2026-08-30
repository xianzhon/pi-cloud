import { afterEach, describe, expect, it } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { ProjectHistoryStore } from './project-history-store.js';

describe('ProjectHistoryStore', () => {
  let db: PiuiDatabase;

  afterEach(() => db?.close());

  it('stores project history per agent profile in most-recent order', () => {
    db = openPiuiDatabase(':memory:');
    let now = '2026-08-30T01:00:00.000Z';
    const store = new ProjectHistoryStore(db, { now: () => now });

    store.touch('default', '/workspace/first');
    now = '2026-08-30T02:00:00.000Z';
    store.touch('default', '/workspace/second');
    store.touch('work', '/workspace/work');

    expect(store.list('default')).toEqual([
      { path: '/workspace/second', lastAccessed: '2026-08-30T02:00:00.000Z' },
      { path: '/workspace/first', lastAccessed: '2026-08-30T01:00:00.000Z' },
    ]);
    expect(store.list('work')).toEqual([
      { path: '/workspace/work', lastAccessed: '2026-08-30T02:00:00.000Z' },
    ]);
  });

  it('updates an existing project access time and removes it explicitly', () => {
    db = openPiuiDatabase(':memory:');
    let now = '2026-08-30T01:00:00.000Z';
    const store = new ProjectHistoryStore(db, { now: () => now });

    store.touch('default', '/workspace/project');
    now = '2026-08-30T03:00:00.000Z';
    store.touch('default', '/workspace/project');

    expect(store.list('default')).toEqual([
      { path: '/workspace/project', lastAccessed: '2026-08-30T03:00:00.000Z' },
    ]);

    store.remove('default', '/workspace/project');
    expect(store.list('default')).toEqual([]);
  });
});
