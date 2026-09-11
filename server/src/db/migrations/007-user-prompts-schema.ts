import type { DatabaseMigration } from './migration.js';

export const userPromptsSchemaMigration: DatabaseMigration = {
  version: 7,
  name: 'user-prompts-schema',
  up(db) {
    db.exec(`
      CREATE TABLE user_prompts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  },
};
