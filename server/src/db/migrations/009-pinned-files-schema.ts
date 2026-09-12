import type { DatabaseMigration } from './migration.js';

export const pinnedFilesSchemaMigration: DatabaseMigration = {
  version: 9,
  name: 'pinned-files-schema',
  up(db) {
    db.exec(`
      CREATE TABLE pinned_files (
        owner_type TEXT NOT NULL CHECK (owner_type = 'profile'),
        owner_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        group_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_type, owner_id, file_path),
        FOREIGN KEY (owner_type, owner_id, group_id)
          REFERENCES session_pin_groups(owner_type, owner_id, id) ON DELETE CASCADE
      );

      CREATE INDEX pinned_files_group_idx
        ON pinned_files(owner_type, owner_id, group_id, created_at);
    `);
  },
};
