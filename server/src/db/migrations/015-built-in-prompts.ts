import type { DatabaseMigration } from './migration.js';

export const builtInPromptsMigration: DatabaseMigration = {
  version: 15,
  name: 'built-in-prompts',
  up(db) {
    db.exec(`
      ALTER TABLE user_prompts ADD COLUMN built_in INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE user_prompts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE user_prompts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
    `);
    const prompts = db.prepare('SELECT id FROM user_prompts ORDER BY lower(name), id').all() as { id: string }[];
    prompts.forEach((prompt, index) => {
      db.prepare('UPDATE user_prompts SET sort_order = ? WHERE id = ?').run(index, prompt.id);
    });
    // Seed once: later upgrades must never overwrite edits or re-enable a disabled prompt.
    let name = 'Save to Task Inbox';
    let suffix = 1;
    while (db.prepare('SELECT id FROM user_prompts WHERE name = ?').get(name)) {
      name = `Save to Task Inbox (built-in ${suffix++})`;
    }
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_prompts (id, name, content, created_at, updated_at, built_in, sort_order)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run('pi-cloud:save-to-task-inbox', name,
      '先不要实现。请把我们刚才讨论并确认的需求整理成任务，保存到 Task Inbox，包含背景、范围、约束和验收标准。',
      now, now, prompts.length);
  },
};
