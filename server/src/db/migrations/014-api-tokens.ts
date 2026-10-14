import type { DatabaseMigration } from './migration.js';

export const apiTokensMigration: DatabaseMigration = {
  version: 14,
  name: 'api-tokens',
  up(db) {
    db.exec(`
      CREATE TABLE auth_api_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        username TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX auth_api_tokens_owner ON auth_api_tokens (username);
    `);
  },
};
