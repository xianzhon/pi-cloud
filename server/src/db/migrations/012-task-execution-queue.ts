import type { DatabaseMigration } from './migration.js';

export const taskExecutionQueueMigration: DatabaseMigration = {
  version: 12,
  name: 'task-execution-queue',
  up(db) {
    db.exec(`CREATE TABLE task_execution_queue (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    )`);
  },
};
