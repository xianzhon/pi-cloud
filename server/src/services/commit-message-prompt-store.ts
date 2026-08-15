import type { PiuiDatabase } from '../db/database.js';

export interface CommitMessagePrompts {
  systemPrompt: string;
  userPrompt: string;
}

export const DEFAULT_COMMIT_MESSAGE_PROMPTS: CommitMessagePrompts = {
  systemPrompt: 'You write accurate, concise git commit messages from git changes.',
  userPrompt: `Generate one clear git commit message for these staged and unstaged changes.

Rules:
- Output only the commit message, with no markdown, quotes, explanation, or code block.
- Start with one concise imperative subject line under 72 characters when possible.
- For small focused changes, output only the subject line.
- For large or multi-area changes, add a blank line after the subject followed by 2-5 concise detail bullets.
- Detail bullets should start with "- " and summarize the main changed areas or user-visible behavior.`,
};

export interface CommitMessagePromptConfiguration {
  global: Partial<CommitMessagePrompts>;
  project: Partial<CommitMessagePrompts>;
  effective: CommitMessagePrompts;
}

export class CommitMessagePromptStore {
  constructor(private readonly db: PiuiDatabase) {}

  get(projectPath: string): CommitMessagePromptConfiguration {
    const global = this.getScope('');
    const project = this.getScope(projectPath);
    return {
      global,
      project,
      effective: {
        systemPrompt: project.systemPrompt || global.systemPrompt || DEFAULT_COMMIT_MESSAGE_PROMPTS.systemPrompt,
        userPrompt: project.userPrompt || global.userPrompt || DEFAULT_COMMIT_MESSAGE_PROMPTS.userPrompt,
      },
    };
  }

  save(scope: 'global' | 'project', projectPath: string, prompts: Partial<CommitMessagePrompts>): CommitMessagePromptConfiguration {
    const scopePath = scope === 'global' ? '' : projectPath;
    const current = this.getScope(scopePath);
    const next = { ...current, ...prompts };
    const systemPrompt = next.systemPrompt?.trim() || null;
    const userPrompt = next.userPrompt?.trim() || null;

    if (!systemPrompt && !userPrompt) {
      this.db.prepare('DELETE FROM commit_message_prompts WHERE scope_path = ?').run(scopePath);
    } else {
      this.db.prepare(`
        INSERT INTO commit_message_prompts (scope_path, system_prompt, user_prompt, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(scope_path) DO UPDATE SET
          system_prompt = excluded.system_prompt,
          user_prompt = excluded.user_prompt,
          updated_at = excluded.updated_at
      `).run(scopePath, systemPrompt, userPrompt, new Date().toISOString());
    }

    return this.get(projectPath);
  }

  private getScope(scopePath: string): Partial<CommitMessagePrompts> {
    const row = this.db.prepare(`
      SELECT system_prompt AS systemPrompt, user_prompt AS userPrompt
      FROM commit_message_prompts WHERE scope_path = ?
    `).get(scopePath) as { systemPrompt: string | null; userPrompt: string | null } | undefined;
    return {
      ...(row?.systemPrompt ? { systemPrompt: row.systemPrompt } : {}),
      ...(row?.userPrompt ? { userPrompt: row.userPrompt } : {}),
    };
  }
}
