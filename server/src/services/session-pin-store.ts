import { randomUUID } from 'crypto';
import type { PiCloudDatabase } from '../db/database.js';

export const DEFAULT_PIN_GROUP_ID = 'default';

export interface SessionPinOwner {
  type: 'profile' | 'review';
  id: string;
}

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
  constructor(private readonly db: PiCloudDatabase) {}

  listGroups(owner: SessionPinOwner): SessionPinGroup[] {
    this.ensureDefaultGroup(owner);
    const rows = this.db.prepare(`
      SELECT id, name, is_default, created_at
      FROM session_pin_groups
      WHERE owner_type = ? AND owner_id = ?
      ORDER BY is_default DESC, created_at, id
    `).all(owner.type, owner.id) as PinGroupRow[];
    return rows.map(mapGroup);
  }

  createGroup(owner: SessionPinOwner, name: string): SessionPinGroup {
    this.ensureDefaultGroup(owner);
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Group name is required');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO session_pin_groups (owner_type, owner_id, id, name, is_default, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(owner.type, owner.id, id, trimmed, createdAt);
    return { id, name: trimmed, isDefault: false, createdAt };
  }

  pinSession(owner: SessionPinOwner, sessionId: string, groupId: string): void {
    this.ensureDefaultGroup(owner);
    if (!this.db.prepare(`
      SELECT 1 FROM session_pin_groups WHERE owner_type = ? AND owner_id = ? AND id = ?
    `).get(owner.type, owner.id, groupId)) {
      throw new Error('Pin group not found');
    }
    this.db.prepare(`
      INSERT INTO session_pins (owner_type, owner_id, session_id, group_id, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_type, owner_id, session_id) DO UPDATE SET group_id = excluded.group_id
    `).run(owner.type, owner.id, sessionId, groupId, new Date().toISOString());
  }

  unpinSession(owner: SessionPinOwner, sessionId: string): void {
    this.db.prepare(`
      DELETE FROM session_pins WHERE owner_type = ? AND owner_id = ? AND session_id = ?
    `).run(owner.type, owner.id, sessionId);
  }

  pinFile(profileId: string, filePath: string, groupId: string): void {
    const owner = { type: 'profile' as const, id: profileId };
    this.ensureDefaultGroup(owner);
    if (!this.db.prepare(`
      SELECT 1 FROM session_pin_groups WHERE owner_type = 'profile' AND owner_id = ? AND id = ?
    `).get(profileId, groupId)) {
      throw new Error('Pin group not found');
    }
    this.db.prepare(`
      INSERT INTO pinned_files (owner_type, owner_id, file_path, group_id, created_at)
      VALUES ('profile', ?, ?, ?, ?)
      ON CONFLICT(owner_type, owner_id, file_path) DO UPDATE SET group_id = excluded.group_id
    `).run(profileId, filePath, groupId, new Date().toISOString());
  }

  unpinFile(profileId: string, filePath: string): void {
    this.db.prepare(`
      DELETE FROM pinned_files WHERE owner_type = 'profile' AND owner_id = ? AND file_path = ?
    `).run(profileId, filePath);
  }

  listFilePathsByGroup(profileId: string): Map<string, string[]> {
    const rows = this.db.prepare(`
      SELECT group_id, file_path
      FROM pinned_files
      WHERE owner_type = 'profile' AND owner_id = ?
      ORDER BY created_at, file_path
    `).all(profileId) as Array<{ group_id: string; file_path: string }>;
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const paths = result.get(row.group_id) || [];
      paths.push(row.file_path);
      result.set(row.group_id, paths);
    }
    return result;
  }

  listSessionIdsByGroup(owner: SessionPinOwner): Map<string, string[]> {
    const rows = this.db.prepare(`
      SELECT group_id, session_id
      FROM session_pins
      WHERE owner_type = ? AND owner_id = ?
      ORDER BY created_at, session_id
    `).all(owner.type, owner.id) as Array<{ group_id: string; session_id: string }>;
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const ids = result.get(row.group_id) || [];
      ids.push(row.session_id);
      result.set(row.group_id, ids);
    }
    return result;
  }

  private ensureDefaultGroup(owner: SessionPinOwner): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO session_pin_groups (owner_type, owner_id, id, name, is_default, created_at)
      VALUES (?, ?, ?, 'Default', 1, ?)
    `).run(owner.type, owner.id, DEFAULT_PIN_GROUP_ID, new Date().toISOString());
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
