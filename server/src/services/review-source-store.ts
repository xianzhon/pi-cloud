import * as os from 'os';
import * as path from 'path';
import type { PiCloudDatabase } from '../db/database.js';
import type { CreateReviewSourceRequest, ReviewSource } from '../types.js';
import { reviewSourceProviders, type ReviewSourceProvider } from './review-source-providers.js';

interface ReviewSourceRow {
  id: string;
  type: string;
  label: string;
  data_path: string;
  created_at: string;
  updated_at: string;
}

type StoredReviewSource = Omit<ReviewSource, 'capabilities'>;

function rowToReviewSource(row: ReviewSourceRow): StoredReviewSource {
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
    private db: PiCloudDatabase,
    private providers: ReviewSourceProvider[] = reviewSourceProviders,
  ) {
    this.ensureDefaultSources();
  }

  list(): StoredReviewSource[] {
    const rows = this.db.prepare('SELECT * FROM review_sources ORDER BY label').all() as ReviewSourceRow[];
    return rows.map(rowToReviewSource);
  }

  get(id: string): StoredReviewSource | undefined {
    const row = this.db.prepare('SELECT * FROM review_sources WHERE id = ?').get(id) as ReviewSourceRow | undefined;
    return row ? rowToReviewSource(row) : undefined;
  }

  create(request: CreateReviewSourceRequest): StoredReviewSource {
    const now = new Date().toISOString();
    const id = this.generateId(request.type, request.label);
    const dataPath = this.resolveDataPath(request.dataPath);
    this.db.prepare(`
      INSERT INTO review_sources (id, type, label, data_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, request.type, request.label, dataPath, now, now);
    return this.get(id)!;
  }

  delete(id: string): void {
    if (this.autoDetectedIds.has(id)) {
      throw new Error('Cannot delete an auto-detected review source');
    }
    this.db.prepare('DELETE FROM review_sources WHERE id = ?').run(id);
  }

  markAutoDetected(id: string): void {
    this.autoDetectedIds.add(id);
  }

  isAutoDetected(id: string): boolean {
    return this.autoDetectedIds.has(id);
  }

  private ensureDefaultSources(): void {
    for (const provider of this.providers) {
      if (!provider.isAvailable(provider.defaultDataPath)) continue;
      const existing = this.db.prepare(
        'SELECT id FROM review_sources WHERE type = ? AND data_path = ?',
      ).get(provider.type, provider.defaultDataPath) as { id: string } | undefined;
      if (existing) {
        this.autoDetectedIds.add(existing.id);
        continue;
      }
      const source = this.create({ type: provider.type, label: provider.label, dataPath: provider.defaultDataPath });
      this.autoDetectedIds.add(source.id);
    }
  }

  private resolveDataPath(dataPath: string): string {
    if (dataPath === '~') return os.homedir();
    if (dataPath.startsWith(`~${path.sep}`)) return path.join(os.homedir(), dataPath.slice(2));
    return path.resolve(dataPath);
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
