import type { DatabaseMigration } from './migration.js';

export const modelWindowKickoffProjectPathMigration: DatabaseMigration = {
  version: 6,
  name: 'model-window-kickoff-project-path',
  up(db) {
    db.exec(`
      ALTER TABLE model_window_kickoffs
      ADD COLUMN project_path TEXT NOT NULL DEFAULT '~';
    `);
  },
};
