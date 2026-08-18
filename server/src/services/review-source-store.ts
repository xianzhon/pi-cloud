import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PiuiDatabase } from '../db/database.js';
import type { CreateReviewSourceRequest, ReviewSource } from '../types.js';

const DEFAULT_DEVIN_DATA_PATH = path.join(os.homedir(), '.local', 'share', 'devin', 'cli');
const DEFAULT_DEVIN_LABEL = 'Devin';

interface ReviewSourceRow {
  id: string;
  type: string;
  label: string;
  data_path: string;
  created_at: string;
  updated_at: string;
}

function rowToReviewSource(row: ReviewSourceRow): ReviewSource {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    dataPath: row.data_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ReviewSourceStore {
  private autoDetectedIds = new Set<string>();

  constructor(
    private db: PiuiDatabase,
    private defaultDevinPath: string = DEFAULT_DEVIN_DATA_PATH,
  ) {
    this.ensureDefaultDevin();
  }

  list(): ReviewSource[] {
    const rows = this.db.prepare('SELECT * FROM review_sources ORDER BY label').all() as ReviewSourceRow[];
    return rows.map(rowToReviewSource);
  }

  get(id: string): ReviewSource | undefined {
    const row = this.db.prepare('SELECT * FROM review_sources WHERE id = ?').get(id) as ReviewSourceRow | undefined;
    return row ? rowToReviewSource(row) : undefined;
  }

  create(request: CreateReviewSourceRequest): ReviewSource {
    const now = new Date().toISOString();
    const id = this.generateId(request.type, request.label);
    const dataPath = path.resolve(request.dataPath);
    this.db.prepare(`
      INSERT INTO review_sources (id, type, label, data_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, request.type, request.label, dataPath, now, now);
    return this.get(id)!;
  }

  delete(id: string): void {
    if (this.autoDetectedIds.has(id)) {
      throw new Error('Cannot delete the auto-detected Devin review source');
    }
    this.db.prepare('DELETE FROM review_sources WHERE id = ?').run(id);
  }

  markAutoDetected(id: string): void {
    this.autoDetectedIds.add(id);
  }

  private ensureDefaultDevin(): void {
    const sessionsDbPath = path.join(this.defaultDevinPath, 'sessions.db');
    if (!fs.existsSync(sessionsDbPath)) return;
    const existing = this.db.prepare(
      'SELECT id FROM review_sources WHERE type = ? AND data_path = ?',
    ).get('devin', this.defaultDevinPath) as { id: string } | undefined;
    if (existing) {
      this.autoDetectedIds.add(existing.id);
      return;
    }
    const now = new Date().toISOString();
    const id = this.generateId('devin', DEFAULT_DEVIN_LABEL);
    this.db.prepare(`
      INSERT INTO review_sources (id, type, label, data_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, 'devin', DEFAULT_DEVIN_LABEL, this.defaultDevinPath, now, now);
    this.autoDetectedIds.add(id);
  }

  private generateId(type: string, label: string): string {
    const slug = `${type}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
    let id = slug;
    let counter = 2;
    while (this.get(id)) {
      id = `${slug}-${counter++}`;
    }
    return id;
  }
}
