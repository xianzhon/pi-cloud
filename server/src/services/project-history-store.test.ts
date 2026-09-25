import { afterEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { ProjectHistoryStore } from './project-history-store.js';

describe('ProjectHistoryStore', () => {
  let db: PiCloudDatabase;

  afterEach(() => db?.close());

  it('stores project history per agent profile in most-recent order', () => {
    db = openPiCloudDatabase(':memory:');
    let now = '2026-08-30T01:00:00.000Z';
    const store = new ProjectHistoryStore(db, { now: () => now });

    store.touch('default', '/workspace/first');
    now = '2026-08-30T02:00:00.000Z';
    store.touch('default', '/workspace/second');
    store.touch('work', '/workspace/work');

    expect(store.list('default')).toEqual([
      { path: '/workspace/second', lastAccessed: '2026-08-30T02:00:00.000Z', isFavorite: false },
      { path: '/workspace/first', lastAccessed: '2026-08-30T01:00:00.000Z', isFavorite: false },
    ]);
    expect(store.list('work')).toEqual([
      { path: '/workspace/work', lastAccessed: '2026-08-30T02:00:00.000Z', isFavorite: false },
    ]);
  });

  it('keeps favorites above recent projects without changing access time or other profiles', () => {
    db = openPiCloudDatabase(':memory:');
    let now = '2026-08-30T01:00:00.000Z';
    const store = new ProjectHistoryStore(db, { now: () => now });
    store.touch('default', '/old');
    now = '2026-08-30T02:00:00.000Z';
    store.touch('default', '/new');
    store.touch('work', '/old');

    expect(store.setFavorite('default', '/old', true)).toBe(true);
    expect(store.list('default').map((entry) => [entry.path, entry.isFavorite])).toEqual([
      ['/old', true], ['/new', false],
    ]);
    expect(store.list('default')[0].lastAccessed).toBe('2026-08-30T01:00:00.000Z');
    expect(store.list('work')[0].isFavorite).toBe(false);
    expect(store.setFavorite('default', '/missing', true)).toBe(false);

    now = '2026-08-30T03:00:00.000Z';
    store.touch('default', '/new');
    expect(store.setFavorite('default', '/new', true)).toBe(true);
    expect(store.list('default').map((entry) => entry.path)).toEqual(['/new', '/old']);
    now = '2026-08-30T04:00:00.000Z';
    store.touch('default', '/old');
    expect(store.list('default').map((entry) => entry.path)).toEqual(['/old', '/new']);
    expect(store.setFavorite('default', '/old', false)).toBe(true);
    expect(store.list('default').map((entry) => entry.path)).toEqual(['/new', '/old']);
  });

  it('updates an existing project access time and removes it explicitly', () => {
    db = openPiCloudDatabase(':memory:');
    let now = '2026-08-30T01:00:00.000Z';
    const store = new ProjectHistoryStore(db, { now: () => now });

    store.touch('default', '/workspace/project');
    now = '2026-08-30T03:00:00.000Z';
    store.touch('default', '/workspace/project');

    expect(store.list('default')).toEqual([
      { path: '/workspace/project', lastAccessed: '2026-08-30T03:00:00.000Z', isFavorite: false },
    ]);

    store.remove('default', '/workspace/project');
    expect(store.list('default')).toEqual([]);
  });
});
