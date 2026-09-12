import type { DatabaseMigration } from './migration.js';

export const applicationSettingsTableMigration: DatabaseMigration = {
  version: 8,
  name: 'application-settings-table',
  up(db) {
    db.exec('ALTER TABLE security_settings RENAME TO application_settings');
  },
};
