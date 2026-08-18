import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiuiDatabase } from '../db/database.js';
import { reviewSourceProviders } from './review-source-providers.js';
import { ReviewSourceStore } from './review-source-store.js';

describe('ReviewSourceStore', () => {
  let dbPath: string;
  let db: Database.Database;
  let store: ReviewSourceStore;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `piui-review-source-test-${Date.now()}.db`);
    db = openPiuiDatabase(dbPath);
    store = new ReviewSourceStore(db, []);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
    try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
  });

  it('creates and lists a source', () => {
    const source = store.create({ type: 'devin', label: 'Devin', dataPath: '/tmp/devin' });
    expect(source.id).toBeTypeOf('string');
    expect(source.type).toBe('devin');
    expect(source.dataPath).toBe('/tmp/devin');
    expect(store.list()).toHaveLength(1);
  });

  it('deletes a custom source', () => {
    const source = store.create({ type: 'devin', label: 'Devin', dataPath: '/tmp/devin' });
    store.delete(source.id);
    expect(store.list()).toHaveLength(0);
  });

  it('prevents deleting auto-detected default devin source', () => {
    const source = store.create({ type: 'devin', label: 'Devin', dataPath: '/tmp/devin' });
    store.markAutoDetected(source.id);
    expect(() => store.delete(source.id)).toThrow('Cannot delete an auto-detected review source');
  });

  it('auto-detects default devin source when sessions.db exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-data-'));
    fs.writeFileSync(path.join(tempDir, 'sessions.db'), '');
    const devinProvider = reviewSourceProviders.find((provider) => provider.type === 'devin')!;
    const s = new ReviewSourceStore(db, [{ ...devinProvider, defaultDataPath: tempDir }]);
    const sources = s.list();
    expect(sources.some((item) => item.type === 'devin' && item.dataPath === tempDir)).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('auto-detects the default path when another Devin source already exists', () => {
    const custom = store.create({ type: 'devin', label: 'Custom', dataPath: '/tmp/custom-devin' });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-data-'));
    fs.writeFileSync(path.join(tempDir, 'sessions.db'), '');

    const devinProvider = reviewSourceProviders.find((provider) => provider.type === 'devin')!;
    const detectedStore = new ReviewSourceStore(db, [{ ...devinProvider, defaultDataPath: tempDir }]);

    expect(detectedStore.list().map((source) => source.dataPath)).toEqual(['/tmp/custom-devin', tempDir]);
    expect(() => detectedStore.delete(custom.id)).not.toThrow();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves relative and home-relative data paths to absolute', () => {
    const relative = store.create({ type: 'devin', label: 'Relative', dataPath: './devin-data' });
    const homeRelative = store.create({ type: 'claude-code', label: 'Claude Code', dataPath: '~/.claude/projects' });
    expect(path.isAbsolute(relative.dataPath)).toBe(true);
    expect(homeRelative.dataPath).toBe(path.join(os.homedir(), '.claude', 'projects'));
  });
});
