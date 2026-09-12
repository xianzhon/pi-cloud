import type { PiCloudDatabase } from '../database.js';
import { applicationSchemaMigration } from './001-application-schema.js';
import { gatewaySchemaMigration } from './002-gateway-schema.js';
import { projectHistorySchemaMigration } from './003-project-history-schema.js';
import { wecomGatewaySchemaMigration } from './004-wecom-gateway-schema.js';
import { modelWindowKickoffSchemaMigration } from './005-model-window-kickoff-schema.js';
import { modelWindowKickoffProjectPathMigration } from './006-model-window-kickoff-project-path.js';
import { userPromptsSchemaMigration } from './007-user-prompts-schema.js';
import { applicationSettingsTableMigration } from './008-application-settings-table.js';
import { pinnedFilesSchemaMigration } from './009-pinned-files-schema.js';
import type { DatabaseMigration } from './migration.js';

const migrations: DatabaseMigration[] = [
  applicationSchemaMigration,
  gatewaySchemaMigration,
  projectHistorySchemaMigration,
  wecomGatewaySchemaMigration,
  modelWindowKickoffSchemaMigration,
  modelWindowKickoffProjectPathMigration,
  userPromptsSchemaMigration,
  applicationSettingsTableMigration,
  pinnedFilesSchemaMigration,
];

export function runDatabaseMigrations(db: PiCloudDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Map(
    (db.prepare('SELECT version, name FROM schema_migrations').all() as Array<{ version: number; name: string }>)
      .map((migration) => [migration.version, migration.name]),
  );

  for (const migration of migrations) {
    const appliedName = applied.get(migration.version);
    if (appliedName) {
      if (appliedName !== migration.name) {
        throw new Error(`Database migration ${migration.version} is recorded as "${appliedName}", expected "${migration.name}"`);
      }
      continue;
    }

    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}
