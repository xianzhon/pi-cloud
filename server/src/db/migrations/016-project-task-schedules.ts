import type { DatabaseMigration } from './migration.js';

export const projectTaskSchedulesMigration: DatabaseMigration = {
  version: 16,
  name: 'project-task-schedules',
  up(db) {
    db.exec(`
      ALTER TABLE project_tasks ADD COLUMN scheduled_at TEXT;
      ALTER TABLE project_tasks ADD COLUMN schedule_error TEXT;
      CREATE INDEX project_tasks_schedule ON project_tasks(scheduled_at) WHERE status = 'waiting' AND scheduled_at IS NOT NULL;
    `);
  },
};
