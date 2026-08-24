import type { PiuiDatabase } from '../database.js';

export interface DatabaseMigration {
  version: number;
  name: string;
  up(db: PiuiDatabase): void;
}
