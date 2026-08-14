import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectTasks } from './useProjectTasks';

const task = {
  id: 'task-1', projectPath: '/repo/app', title: 'Task', prompt: 'Implement it', notes: '',
  status: 'waiting', agentProfileId: 'codex', modelProvider: 'openai', modelId: 'gpt-5.4',
  skillMode: 'all', skills: [], worktree: { mode: 'none' }, sessionId: null,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
  startedAt: null, completedAt: null,
};

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 409, json: async () => body };
}

describe('useProjectTasks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('loads the selected project and status in oldest-first server order', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ tasks: [task] }) as Response);
    const state = useProjectTasks('client-1');
    state.scope.value = 'project';
    state.status.value = 'waiting';

    await state.load('/repo/app');

    expect(fetch).toHaveBeenCalledWith('/api/tasks?scope=project&status=waiting&projectPath=%2Frepo%2Fapp');
    expect(state.tasks.value).toEqual([task]);
  });

  it('starts a task, refreshes the list, and notifies count consumers', async () => {
    const startResult = { task: { ...task, status: 'started', sessionId: 'session-1' }, sessionId: 'session-1', prompt: task.prompt };
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(startResult) as Response)
      .mockResolvedValueOnce(response({ tasks: [] }) as Response);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const state = useProjectTasks('client-1');

    const result = await state.start('task-1');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/tasks/task-1/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1' }),
    });
    expect(result).toEqual(startResult);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh-tasks' }));
    expect(state.startingTaskId.value).toBeNull();
  });

  it('creates, updates, completes, and removes through their task endpoints', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ task }) as Response);
    const state = useProjectTasks('client-1');
    const draft = {
      projectPath: task.projectPath, title: task.title, prompt: task.prompt, notes: '',
      agentProfileId: task.agentProfileId, modelProvider: task.modelProvider, modelId: task.modelId,
      skillMode: 'all' as const, skills: [], worktree: { mode: 'none' as const },
    };

    await state.create(draft);
    await state.update('task-1', draft);
    await state.complete('task-1');
    await state.remove('task-1');

    expect(fetch).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1/complete', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('surfaces the server error from a failed mutation', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: 'Model is unavailable' }, false) as Response);
    const state = useProjectTasks('client-1');

    await expect(state.start('task-1')).rejects.toThrow('Model is unavailable');
    expect(state.error.value).toBe('Model is unavailable');
  });
});
