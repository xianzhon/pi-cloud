import type { DatabaseMigration } from './migration.js';

export const modelWindowKickoffSchemaMigration: DatabaseMigration = {
  version: 5,
  name: 'model-window-kickoff-schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_window_kickoffs (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        window_duration_minutes INTEGER NOT NULL,
        safety_buffer_seconds INTEGER NOT NULL,
        notification_channel_id TEXT REFERENCES notification_channels(id) ON DELETE SET NULL,
        next_run_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS model_window_kickoffs_due_idx
      ON model_window_kickoffs(enabled, next_run_at);
    `);
  },
};
