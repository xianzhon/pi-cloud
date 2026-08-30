import type { PiCloudDatabase } from '../database.js';

export interface DatabaseMigration {
  version: number;
  name: string;
  up(db: PiCloudDatabase): void;
}
