import type { PiCloudDatabase } from '../db/database.js';

export interface ProjectHistoryEntry {
  path: string;
  lastAccessed: string;
}

interface ProjectHistoryRow {
  project_path: string;
  last_accessed_at: string;
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
      SELECT project_path, last_accessed_at
      FROM project_history
      WHERE agent_profile_id = ?
      ORDER BY last_accessed_at DESC, project_path
    `).all(agentProfileId) as ProjectHistoryRow[];
    return rows.map((row) => ({ path: row.project_path, lastAccessed: row.last_accessed_at }));
  }

  touch(agentProfileId: string, projectPath: string): void {
    this.db.prepare(`
      INSERT INTO project_history (agent_profile_id, project_path, last_accessed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_profile_id, project_path)
      DO UPDATE SET last_accessed_at = excluded.last_accessed_at
    `).run(agentProfileId, projectPath.trim(), this.now());
  }

  remove(agentProfileId: string, projectPath: string): void {
    this.db.prepare(`
      DELETE FROM project_history
      WHERE agent_profile_id = ? AND project_path = ?
    `).run(agentProfileId, projectPath.trim());
  }
}
