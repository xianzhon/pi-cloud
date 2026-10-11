import type { DatabaseMigration } from './migration.js';

export const passkeysMigration: DatabaseMigration = {
  version: 13,
  name: 'passkeys',
  up(db) {
    db.exec(`
      CREATE TABLE auth_passkey_users (
        username TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (username, rp_id)
      );
      CREATE TABLE auth_passkeys (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        public_key BLOB NOT NULL,
        counter INTEGER NOT NULL,
        transports TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX auth_passkeys_owner ON auth_passkeys (username, rp_id);
    `);
  },
};
