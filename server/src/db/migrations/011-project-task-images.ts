import type { DatabaseMigration } from './migration.js';

export const projectTaskImagesMigration: DatabaseMigration = {
  version: 11,
  name: 'project-task-images',
  up(db) {
    db.exec("ALTER TABLE project_tasks ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'");
  },
};
