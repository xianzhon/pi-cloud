import { randomUUID } from 'crypto';
import type { PiuiDatabase } from '../db/database.js';

export const DEFAULT_PIN_GROUP_ID = 'default';

export interface SessionPinGroup {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

interface PinGroupRow {
  id: string;
  name: string;
  is_default: number;
  created_at: string;
}

export class SessionPinStore {
  constructor(private readonly db: PiuiDatabase) {
    this.ensureDefaultGroup();
  }

  listGroups(): SessionPinGroup[] {
    const rows = this.db.prepare(`
      SELECT id, name, is_default, created_at
      FROM session_pin_groups
      ORDER BY is_default DESC, created_at, id
    `).all() as PinGroupRow[];
    return rows.map(mapGroup);
  }

  createGroup(name: string): SessionPinGroup {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Group name is required');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO session_pin_groups (id, name, is_default, created_at)
      VALUES (?, ?, 0, ?)
    `).run(id, trimmed, createdAt);
    return { id, name: trimmed, isDefault: false, createdAt };
  }

  pinSession(sessionId: string, groupId: string, sourceId = ''): void {
    if (!this.db.prepare('SELECT 1 FROM session_pin_groups WHERE id = ?').get(groupId)) {
      throw new Error('Pin group not found');
    }
    this.db.prepare(`
      INSERT INTO session_pins (session_id, source_id, group_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, source_id) DO UPDATE SET group_id = excluded.group_id
    `).run(sessionId, sourceId, groupId, new Date().toISOString());
  }

  unpinSession(sessionId: string, sourceId = ''): void {
    this.db.prepare('DELETE FROM session_pins WHERE session_id = ? AND source_id = ?').run(sessionId, sourceId);
  }

  listSessionIdsByGroup(sourceId = ''): Map<string, string[]> {
    const rows = this.db.prepare(`
      SELECT group_id, session_id FROM session_pins WHERE source_id = ? ORDER BY created_at, session_id
    `).all(sourceId) as Array<{ group_id: string; session_id: string }>;
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const ids = result.get(row.group_id) || [];
      ids.push(row.session_id);
      result.set(row.group_id, ids);
    }
    return result;
  }

  private ensureDefaultGroup(): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO session_pin_groups (id, name, is_default, created_at)
      VALUES (?, 'Default', 1, ?)
    `).run(DEFAULT_PIN_GROUP_ID, new Date().toISOString());
  }
}

function mapGroup(row: PinGroupRow): SessionPinGroup {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}
