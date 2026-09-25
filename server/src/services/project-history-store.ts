import type { PiCloudDatabase } from '../db/database.js';

export interface ProjectHistoryEntry {
  path: string;
  lastAccessed: string;
  isFavorite: boolean;
}

interface ProjectHistoryRow {
  project_path: string;
  last_accessed_at: string;
  is_favorite: number;
}

interface ProjectHistoryStoreOptions {
  now?: () => string;
}

export class ProjectHistoryStore {
  private readonly now: () => string;

  constructor(private readonly db: PiCloudDatabase, options: ProjectHistoryStoreOptions = {}) {
    this.now = options.now || (() => new Date().toISOString());
  }

  list(agentProfileId: string): ProjectHistoryEntry[] {
    const rows = this.db.prepare(`
      SELECT project_path, last_accessed_at, is_favorite
      FROM project_history
      WHERE agent_profile_id = ?
      ORDER BY is_favorite DESC, last_accessed_at DESC, project_path
    `).all(agentProfileId) as ProjectHistoryRow[];
    return rows.map((row) => ({ path: row.project_path, lastAccessed: row.last_accessed_at, isFavorite: Boolean(row.is_favorite) }));
  }

  touch(agentProfileId: string, projectPath: string): void {
    this.db.prepare(`
      INSERT INTO project_history (agent_profile_id, project_path, last_accessed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_profile_id, project_path)
      DO UPDATE SET last_accessed_at = excluded.last_accessed_at
    `).run(agentProfileId, projectPath.trim(), this.now());
  }

  setFavorite(agentProfileId: string, projectPath: string, isFavorite: boolean): boolean {
    const result = this.db.prepare(`
      UPDATE project_history SET is_favorite = ?
      WHERE agent_profile_id = ? AND project_path = ?
    `).run(isFavorite ? 1 : 0, agentProfileId, projectPath.trim());
    return result.changes > 0;
  }

  remove(agentProfileId: string, projectPath: string): void {
    this.db.prepare(`
      DELETE FROM project_history
      WHERE agent_profile_id = ? AND project_path = ?
    `).run(agentProfileId, projectPath.trim());
  }
}
