import type { DatabaseMigration } from './migration.js';

export const wecomGatewaySchemaMigration: DatabaseMigration = {
  version: 4,
  name: 'wecom-gateway-schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wecom_gateway_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        corp_id TEXT NOT NULL,
        corp_secret TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        callback_token TEXT NOT NULL,
        encoding_aes_key TEXT NOT NULL,
        allowed_users_json TEXT NOT NULL DEFAULT '[]',
        callback_verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wecom_gateway_sessions (
        session_key TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        pi_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wecom_gateway_configs (
        client_id TEXT PRIMARY KEY,
        agent_profile TEXT,
        default_cwd TEXT,
        skill_mode TEXT,
        skill_preset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
