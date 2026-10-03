import type { DatabaseMigration } from './migration.js';
export const routinesMigration: DatabaseMigration = {
  version: 12,
  name: 'routines',
  up(db) {
    db.exec(`CREATE TABLE routines (id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE routine_runs (id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, occurrence TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(routine_id, occurrence));
 CREATE INDEX routine_runs_status ON routine_runs(status);
 CREATE INDEX routine_runs_active ON routine_runs(routine_id,status);
 CREATE TABLE routine_deliveries (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, data TEXT NOT NULL);
 CREATE INDEX routine_deliveries_status ON routine_deliveries(status);`);
  },
};
