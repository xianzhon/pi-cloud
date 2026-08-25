import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { runDatabaseMigrations } from './migrations/index.js';

export type PiuiDatabase = Database.Database;

export function openPiuiDatabase(dbPath: string): PiuiDatabase {
  const isPersistent = dbPath !== ':memory:';

  if (isPersistent) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }

  // SQLite creates the database and journal sidecars using the process umask.
  // Restrict creation before any credentials or TOTP secrets can be persisted.
  const previousUmask = process.umask(0o077);
  let db: PiuiDatabase;
  try {
    db = new Database(dbPath);
  } finally {
    process.umask(previousUmask);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  runDatabaseMigrations(db);

  if (isPersistent) {
    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, 0o600);
      }
    }
  }

  return db;
}
