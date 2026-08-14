import type { PiuiDatabase } from '../db/database';

export type StoredSkillPolicyMode = 'all' | 'enabled' | 'disabled';

export interface SkillPolicyRecord {
  sessionId: string;
  username: string;
  mode: StoredSkillPolicyMode;
  skills: string[];
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSkillPolicyInput {
  sessionId: string;
  username: string;
  mode: StoredSkillPolicyMode;
  skills: string[];
  presetId?: string | null;
}

interface SkillPolicyRow {
  session_id: string;
  username: string;
  mode: StoredSkillPolicyMode;
  skills_json: string;
  preset_id: string | null;
  created_at: string;
  updated_at: string;
}

export class SkillPolicyStore {
  constructor(private readonly db: PiuiDatabase) {}

  save(input: SaveSkillPolicyInput): SkillPolicyRecord {
    const now = new Date().toISOString();
    const skillsJson = JSON.stringify(normalizeSkills(input.skills));

    this.db.prepare(`
      INSERT INTO session_skill_policies (session_id, username, mode, skills_json, preset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        username = excluded.username,
        mode = excluded.mode,
        skills_json = excluded.skills_json,
        preset_id = excluded.preset_id,
        updated_at = excluded.updated_at
    `).run(input.sessionId, input.username, input.mode, skillsJson, input.presetId ?? null, now, now);

    return this.get(input.sessionId)!;
  }

  get(sessionId: string): SkillPolicyRecord | null {
    const row = this.db.prepare('SELECT * FROM session_skill_policies WHERE session_id = ?').get(sessionId) as SkillPolicyRow | undefined;
    return row ? mapRow(row) : null;
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM session_skill_policies WHERE session_id = ?').run(sessionId);
  }
}

function normalizeSkills(skills: string[]): string[] {
  return Array.from(new Set(skills.map((skill) => skill.trim()).filter(Boolean)));
}

function mapRow(row: SkillPolicyRow): SkillPolicyRecord {
  return {
    sessionId: row.session_id,
    username: row.username,
    mode: row.mode,
    skills: JSON.parse(row.skills_json) as string[],
    presetId: row.preset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
