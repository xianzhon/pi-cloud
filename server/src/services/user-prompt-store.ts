import { randomUUID } from 'crypto';
import type { PiCloudDatabase } from '../db/database';

export interface UserPromptRecord {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface UserPromptRow {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export class UserPromptStore {
  constructor(private readonly db: PiCloudDatabase) {}

  list(): UserPromptRecord[] {
    return (this.db.prepare(`
      SELECT id, name, content, created_at, updated_at
      FROM user_prompts
      ORDER BY lower(name), id
    `).all() as UserPromptRow[]).map(mapRow);
  }

  create(input: { name: string; content: string }): UserPromptRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO user_prompts (id, name, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.name.trim(), input.content.trim(), now, now);
    return this.get(id)!;
  }

  update(id: string, input: { name: string; content: string }): UserPromptRecord {
    const result = this.db.prepare(`
      UPDATE user_prompts SET name = ?, content = ?, updated_at = ?
      WHERE id = ?
    `).run(input.name.trim(), input.content.trim(), new Date().toISOString(), id);
    if (!result.changes) throw new Error(`User prompt not found: ${id}`);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM user_prompts WHERE id = ?').run(id);
  }

  private get(id: string): UserPromptRecord | null {
    const row = this.db.prepare(`
      SELECT id, name, content, created_at, updated_at
      FROM user_prompts WHERE id = ?
    `).get(id) as UserPromptRow | undefined;
    return row ? mapRow(row) : null;
  }
}

function mapRow(row: UserPromptRow): UserPromptRecord {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
