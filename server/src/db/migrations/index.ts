import type { PiuiDatabase } from '../database.js';
import { applicationSchemaMigration } from './001-application-schema.js';
import { gatewaySchemaMigration } from './002-gateway-schema.js';
import type { DatabaseMigration } from './migration.js';

const migrations: DatabaseMigration[] = [
  applicationSchemaMigration,
  gatewaySchemaMigration,
];

export function runDatabaseMigrations(db: PiuiDatabase): void {
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
