import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { ProjectTaskStore } from '../services/project-task-store.js';
import { createTaskInboxExtension } from './task-inbox.js';

describe('task inbox tool', () => {
  let db: PiCloudDatabase;
  let store: ProjectTaskStore;
  let tool: any;
  const listModels = vi.fn();

  beforeEach(async () => {
    db = openPiCloudDatabase(':memory:');
    store = new ProjectTaskStore(db);
    listModels.mockResolvedValue([
      { provider: 'first', id: 'fallback' },
      { provider: 'configured', id: 'default-model', current: true },
    ]);
    const extension = createTaskInboxExtension({ profileId: 'work', store, listModels });
    if (typeof extension === 'function') throw new Error('Expected a named inline extension');
    await extension.factory({ registerTool: (value: unknown) => { tool = value; } } as any);
  });

  afterEach(() => db.close());

  function execute(title = ' Add search ', prompt = ' Implement the agreed search scope. ') {
    return tool.execute('call-1', { title, prompt }, undefined, undefined, {
      cwd: '/repo/app',
      model: { provider: 'session', id: 'override' },
    });
  }

  it('persists a waiting task with default launch settings and discussion content', async () => {
    const result = await execute();
    const task = store.list()[0];
    expect(task).toMatchObject({
      projectPath: '/repo/app', title: 'Add search', prompt: 'Implement the agreed search scope.',
      agentProfileId: 'work', modelProvider: 'configured', modelId: 'default-model',
      skillMode: 'all', skills: [], presetId: null, worktree: { mode: 'none' }, notes: '',
      status: 'waiting', sessionId: null, startedAt: null,
    });
    expect(result.details.task).toEqual(task);
    expect(JSON.parse(result.content[0].text)).toEqual({ task });
  });

  it('uses the first available model when no configured default is available', async () => {
    listModels.mockResolvedValue([{ provider: 'first', id: 'fallback' }]);
    await execute();
    expect(store.list()[0]).toMatchObject({ modelProvider: 'first', modelId: 'fallback' });
  });

  it('resolves defaults anew for each task', async () => {
    await execute();
    listModels.mockResolvedValue([{ provider: 'new', id: 'new-default', current: true }]);
    await execute('Second task');
    expect(store.list().find((task) => task.title === 'Second task')).toMatchObject({ modelId: 'new-default' });
  });

  it('does not persist a task when no model is available', async () => {
    listModels.mockResolvedValue([]);
    await expect(execute()).rejects.toThrow('No available model');
    expect(store.list()).toEqual([]);
  });

  it.each([[' ', 'Prompt'], ['Title', ' ']])('rejects blank task content', async (title, prompt) => {
    await expect(execute(title, prompt)).rejects.toThrow(/is required/);
    expect(store.list()).toEqual([]);
  });

  it('does not persist after cancellation during model lookup', async () => {
    const controller = new AbortController();
    listModels.mockImplementationOnce(async () => {
      controller.abort();
      return [{ provider: 'first', id: 'fallback' }];
    });
    await expect(tool.execute('call', { title: 'Title', prompt: 'Prompt' }, controller.signal, undefined, { cwd: '/repo' }))
      .rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});
