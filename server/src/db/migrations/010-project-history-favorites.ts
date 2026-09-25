import type { DatabaseMigration } from './migration.js';

export const projectHistoryFavoritesMigration: DatabaseMigration = {
  version: 10,
  name: 'project-history-favorites',
  up(db) {
    db.exec('ALTER TABLE project_history ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  },
};
