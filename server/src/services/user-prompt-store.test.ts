import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openPiCloudDatabase } from '../db/database';
import { runDatabaseMigrations } from '../db/migrations/index';
import { builtInPromptsMigration } from '../db/migrations/015-built-in-prompts';
import { UserPromptStore } from './user-prompt-store';

describe('built-in prompts', () => {
  it('preserves edits, disabled state, and ordering when migrations run again', () => {
    const db = openPiCloudDatabase(':memory:');
    try {
      const store = new UserPromptStore(db);
      const builtin = store.list()[0]!;
      expect(builtin.content).toBe('先不要实现。请把我们刚才讨论并确认的需求整理成任务，保存到 Task Inbox，包含背景、范围、约束和验收标准。');
      const user = store.create({ name: 'Review', content: 'Review code.' });
      store.update(builtin.id, { name: 'Later', content: 'Edited.', enabled: false });
      store.reorder([user.id, builtin.id]);
      runDatabaseMigrations(db);
      expect(new UserPromptStore(db).list()).toMatchObject([
        { id: user.id, builtIn: false, enabled: true },
        { id: builtin.id, name: 'Later', content: 'Edited.', builtIn: true, enabled: false },
      ]);
      expect(() => store.delete(builtin.id)).toThrow('cannot be deleted');
    } finally {
      db.close();
    }
  });

  it('upgrades legacy prompts in alphabetical order without overwriting a colliding name', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE user_prompts (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      const insert = db.prepare('INSERT INTO user_prompts VALUES (?, ?, ?, ?, ?)');
      insert.run('z', 'Zebra', 'Original Z', 'old', 'old');
      insert.run('a', 'Save to Task Inbox', 'Original A', 'old', 'old');
      builtInPromptsMigration.up(db);
      expect(new UserPromptStore(db).list()).toMatchObject([
        { id: 'a', content: 'Original A', builtIn: false, enabled: true },
        { id: 'z', content: 'Original Z', builtIn: false, enabled: true },
        { id: 'pi-cloud:save-to-task-inbox', builtIn: true, enabled: true },
      ]);
    } finally {
      db.close();
    }
  });
});
