import type { DatabaseMigration } from './migration.js';

export const projectHistorySchemaMigration: DatabaseMigration = {
  version: 3,
  name: 'project-history-schema',
  up(db) {
    db.exec(`
      CREATE TABLE project_history (
        agent_profile_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        PRIMARY KEY (agent_profile_id, project_path)
      );

      CREATE INDEX project_history_recent
        ON project_history (agent_profile_id, last_accessed_at DESC);
    `);
  },
};
