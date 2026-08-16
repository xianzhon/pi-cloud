import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CommitMessagePromptStore, DEFAULT_COMMIT_MESSAGE_PROMPTS } from './commit-message-prompt-store';

let db: Database.Database | undefined;

afterEach(() => db?.close());

function createStore() {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE commit_message_prompts (
      scope_path TEXT PRIMARY KEY,
      system_prompt TEXT,
      user_prompt TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  return new CommitMessagePromptStore(db);
}

describe('CommitMessagePromptStore', () => {
  it('uses a fixed system prompt with global and project user prompt overrides', () => {
    const store = createStore();

    expect(store.get('/repo').effective).toEqual(DEFAULT_COMMIT_MESSAGE_PROMPTS);
    store.save('global', '/repo', { userPrompt: 'Global instructions' });
    store.save('project', '/repo', { userPrompt: 'Project instructions' });
    db!.prepare('UPDATE commit_message_prompts SET system_prompt = ?').run('Legacy custom system prompt');

    const result = store.get('/repo');
    expect(result.global).toEqual({ userPrompt: 'Global instructions' });
    expect(result.project).toEqual({ userPrompt: 'Project instructions' });
    expect(result.effective).toEqual({
      systemPrompt: DEFAULT_COMMIT_MESSAGE_PROMPTS.systemPrompt,
      userPrompt: 'Project instructions',
    });
    expect(store.get('/other').effective.userPrompt).toBe('Global instructions');
  });

  it('clears an override when prompt text is empty', () => {
    const store = createStore();
    store.save('global', '/repo', { userPrompt: 'Global instructions' });
    store.save('project', '/repo', { userPrompt: 'Project instructions' });

    const result = store.save('project', '/repo', { userPrompt: '' });

    expect(result.project).toEqual({});
    expect(result.effective.userPrompt).toBe('Global instructions');
  });
});
