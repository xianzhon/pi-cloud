import { randomUUID } from 'crypto';
import type { PiCloudDatabase } from '../db/database';

export type SkillPresetMode = 'enabled' | 'disabled';

export interface SkillPresetRecord {
  id: string;
  username: string;
  name: string;
  mode: SkillPresetMode;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillPresetInput {
  username: string;
  name: string;
  mode: SkillPresetMode;
  skills: string[];
}

export interface UpdateSkillPresetInput extends CreateSkillPresetInput {
  id: string;
}

interface SkillPresetRow {
  id: string;
  username: string;
  name: string;
  mode: SkillPresetMode;
  skills_json: string;
  created_at: string;
  updated_at: string;
}

export class SkillPresetStore {
  constructor(private readonly db: PiCloudDatabase) {}

  list(): SkillPresetRecord[] {
    const rows = this.db.prepare('SELECT * FROM skill_presets ORDER BY lower(name), id').all() as SkillPresetRow[];
    return rows.map(mapRow);
  }

  listByUsername(_username: string): SkillPresetRecord[] {
    // Presets are intentionally global; keep this compatibility method for callers that still pass a username.
    return this.list();
  }

  getById(id: string): SkillPresetRecord | null {
    const row = this.db.prepare('SELECT * FROM skill_presets WHERE id = ?').get(id) as SkillPresetRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(input: CreateSkillPresetInput): SkillPresetRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const name = input.name.trim();
    this.ensureNameAvailable(name);

    this.db.prepare(`
      INSERT INTO skill_presets (id, username, name, mode, skills_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.username, name, input.mode, JSON.stringify(normalizeSkills(input.skills)), now, now);

    return this.getById(id)!;
  }

  update(input: UpdateSkillPresetInput): SkillPresetRecord {
    const now = new Date().toISOString();
    const name = input.name.trim();
    this.ensureNameAvailable(name, input.id);
    const result = this.db.prepare(`
      UPDATE skill_presets
      SET name = ?, mode = ?, skills_json = ?, updated_at = ?
      WHERE id = ?
    `).run(name, input.mode, JSON.stringify(normalizeSkills(input.skills)), now, input.id);

    if (!result.changes) {
      throw new Error(`Skill preset not found: ${input.id}`);
    }

    return this.getById(input.id)!;
  }

  delete(id: string, _username?: string): void {
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE session_skill_policies
        SET mode = 'all', skills_json = '[]'
        WHERE preset_id = ?
      `).run(id);
      // Waiting tasks with a deleted preset must start with an explicit empty allowlist, not all skills.
      this.db.prepare(`
        UPDATE project_tasks
        SET skill_mode = CASE WHEN status IN ('waiting', 'starting') THEN 'enabled' ELSE skill_mode END,
            skills_json = CASE WHEN status IN ('waiting', 'starting') THEN '[]' ELSE skills_json END,
            preset_id = NULL
        WHERE preset_id = ?
      `).run(id);
      this.db.prepare('DELETE FROM skill_presets WHERE id = ?').run(id);
    })();
  }

  private ensureNameAvailable(name: string, exceptId?: string): void {
    const row = this.db.prepare('SELECT id FROM skill_presets WHERE lower(name) = lower(?) AND id != ?').get(name, exceptId ?? '') as { id: string } | undefined;
    if (row) {
      throw new Error('UNIQUE constraint failed: skill_presets.name');
    }
  }
}

function normalizeSkills(skills: string[]): string[] {
  return Array.from(new Set(skills.map((skill) => skill.trim()).filter(Boolean)));
}

function mapRow(row: SkillPresetRow): SkillPresetRecord {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    mode: row.mode,
    skills: JSON.parse(row.skills_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
