import type { PiCloudDatabase } from '../db/database.js';

export const DEFAULT_CHANGE_REASON_SYSTEM_PROMPT = 'You explain what a selected code change does and why it is needed within the complete pending change set.';

export interface ChangeReasonPromptOverrides {
  systemPrompt?: string;
}

export interface ChangeReasonPromptConfiguration {
  global: ChangeReasonPromptOverrides;
  project: ChangeReasonPromptOverrides;
  effective: { systemPrompt: string };
}

const GLOBAL_KEY = 'git.changeReason.systemPrompt.global';

export class ChangeReasonPromptStore {
  constructor(private readonly db: PiCloudDatabase) {}

  get(projectPath: string): ChangeReasonPromptConfiguration {
    const global = this.getValue(GLOBAL_KEY);
    const project = this.getValue(this.projectKey(projectPath));
    return {
      global: global ? { systemPrompt: global } : {},
      project: project ? { systemPrompt: project } : {},
      effective: { systemPrompt: project || global || DEFAULT_CHANGE_REASON_SYSTEM_PROMPT },
    };
  }

  save(scope: 'global' | 'project', projectPath: string, systemPrompt: string): ChangeReasonPromptConfiguration {
    const key = scope === 'global' ? GLOBAL_KEY : this.projectKey(projectPath);
    const value = systemPrompt.trim();
    if (value) {
      this.db.prepare(`
        INSERT INTO application_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, value, new Date().toISOString());
    } else {
      this.db.prepare('DELETE FROM application_settings WHERE key = ?').run(key);
    }
    return this.get(projectPath);
  }

  private getValue(key: string): string {
    const row = this.db.prepare('SELECT value FROM application_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  }

  private projectKey(projectPath: string): string {
    return `git.changeReason.systemPrompt.project:${projectPath}`;
  }
}
