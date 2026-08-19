import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database';
import { ProjectTaskStore } from './project-task-store';
import { SkillPresetStore } from './skill-preset-store';

describe('SkillPresetStore', () => {
  let tempDir: string;
  let db: PiuiDatabase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-skill-preset-store-'));
    db = openPiuiDatabase(path.join(tempDir, 'piui.sqlite'));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates and lists presets globally', () => {
    const store = new SkillPresetStore(db);

    const created = store.create({
      username: 'me',
      name: 'debug',
      mode: 'enabled',
      skills: ['systematic-debugging'],
    });

    expect(created).toEqual({
      id: expect.any(String),
      username: 'me',
      name: 'debug',
      mode: 'enabled',
      skills: ['systematic-debugging'],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(store.list()).toEqual([created]);
    expect(store.listByUsername('other')).toEqual([created]);
  });

  it('enforces preset name uniqueness globally', () => {
    const store = new SkillPresetStore(db);

    store.create({ username: 'me', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] });

    expect(() => {
      store.create({ username: 'other', name: 'debug', mode: 'disabled', skills: ['brainstorming'] });
    }).toThrow(/unique/i);
  });

  it('updates and deletes presets globally', () => {
    const store = new SkillPresetStore(db);
    const created = store.create({
      username: 'me',
      name: 'debug',
      mode: 'enabled',
      skills: ['systematic-debugging'],
    });

    const updated = store.update({
      id: created.id,
      username: 'other',
      name: 'ui',
      mode: 'disabled',
      skills: ['frontend-design'],
    });

    expect(updated).toEqual({
      ...created,
      name: 'ui',
      mode: 'disabled',
      skills: ['frontend-design'],
      updatedAt: expect.any(String),
    });

    const taskStore = new ProjectTaskStore(db);
    const task = taskStore.create({
      projectPath: '/repo/app', title: 'Task', prompt: 'Run it', notes: '', agentProfileId: 'codex',
      modelProvider: 'openai', modelId: 'gpt-5.4', skillMode: updated.mode, skills: updated.skills,
      presetId: updated.id, worktree: { mode: 'none' },
    });

    store.delete(created.id, 'other');
    expect(store.list()).toEqual([]);
    expect(taskStore.get(task.id)).toMatchObject({ presetId: null, skillMode: 'enabled', skills: [] });
  });
});
