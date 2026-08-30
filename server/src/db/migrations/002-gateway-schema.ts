import type { PiCloudDatabase } from '../database.js';
import type { DatabaseMigration } from './migration.js';

export const gatewaySchemaMigration: DatabaseMigration = {
  version: 2,
  name: 'gateway-schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_gateway_sessions (
        session_key TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        pi_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feishu_gateway_configs (
        client_id TEXT PRIMARY KEY,
        agent_profile TEXT,
        default_cwd TEXT,
        skill_mode TEXT,
        skill_preset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weixin_gateway_sessions (
        session_key TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        pi_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weixin_gateway_configs (
        client_id TEXT PRIMARY KEY,
        agent_profile TEXT,
        default_cwd TEXT,
        skill_mode TEXT,
        skill_preset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weixin_gateway_state (
        account_id TEXT PRIMARY KEY,
        sync_buf TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weixin_gateway_context_tokens (
        account_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        context_token TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, peer_id)
      );

      CREATE TABLE IF NOT EXISTS weixin_gateway_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        account_id TEXT NOT NULL,
        token TEXT NOT NULL,
        base_url TEXT NOT NULL,
        user_id TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    ensureColumn(db, 'feishu_gateway_configs', 'skill_mode', 'TEXT');
    ensureColumn(db, 'feishu_gateway_configs', 'skill_preset_id', 'TEXT');
    ensureColumn(db, 'weixin_gateway_configs', 'skill_mode', 'TEXT');
    ensureColumn(db, 'weixin_gateway_configs', 'skill_preset_id', 'TEXT');
  },
};

function ensureColumn(db: PiCloudDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
