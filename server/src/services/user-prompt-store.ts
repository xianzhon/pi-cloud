import { randomUUID } from 'crypto';
import type { PiCloudDatabase } from '../db/database';

export interface UserPromptRecord {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface UserPromptRow {
  id: string;
  name: string;
  content: string;
  built_in: number;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class UserPromptStore {
  constructor(private readonly db: PiCloudDatabase) {}

  list(): UserPromptRecord[] {
    return (this.db.prepare(`
      SELECT *
      FROM user_prompts
      ORDER BY sort_order, lower(name), id
    `).all() as UserPromptRow[]).map(mapRow);
  }

  create(input: { name: string; content: string }): UserPromptRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO user_prompts (id, name, content, created_at, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM user_prompts))
    `).run(id, input.name.trim(), input.content.trim(), now, now);
    return this.get(id)!;
  }

  update(id: string, input: { name: string; content: string; enabled?: boolean }): UserPromptRecord {
    const result = this.db.prepare(`
      UPDATE user_prompts SET name = ?, content = ?, enabled = COALESCE(?, enabled), updated_at = ?
      WHERE id = ?
    `).run(input.name.trim(), input.content.trim(), input.enabled === undefined ? null : Number(input.enabled), new Date().toISOString(), id);
    if (!result.changes) throw new Error(`User prompt not found: ${id}`);
    return this.get(id)!;
  }

  delete(id: string): void {
    if (this.get(id)?.builtIn) throw new Error('Built-in prompts cannot be deleted');
    this.db.prepare('DELETE FROM user_prompts WHERE id = ?').run(id);
  }

  reorder(ids: string[]): void {
    this.db.transaction(() => {
      const prompts = this.list();
      if (ids.length !== prompts.length || new Set(ids).size !== ids.length
        || ids.some((id) => !prompts.some((prompt) => prompt.id === id))) {
        throw new Error('Order must contain every prompt exactly once');
      }
      const statement = this.db.prepare('UPDATE user_prompts SET sort_order = ? WHERE id = ?');
      ids.forEach((id, index) => statement.run(index, id));
    })();
  }

  private get(id: string): UserPromptRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM user_prompts WHERE id = ?
    `).get(id) as UserPromptRow | undefined;
    return row ? mapRow(row) : null;
  }
}

function mapRow(row: UserPromptRow): UserPromptRecord {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    builtIn: Boolean(row.built_in),
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
