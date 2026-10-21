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

  it.each([true, false])('keeps the latest project results when an older request finishes last (ok=%s)', async (ok) => {
    let resolveOlder!: (value: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOlder = resolve; }))
      .mockResolvedValueOnce(response({ tasks: [{ ...task, id: 'new-task', projectPath: '/repo/new' }] }) as Response);
    const state = useProjectTasks('client-1');

    const olderLoad = state.load('/repo/old');
    await state.load('/repo/new');
    resolveOlder(response(ok ? { tasks: [task] } : { error: 'Old request failed' }, ok) as Response);
    await olderLoad;

    expect(state.tasks.value.map((item) => item.id)).toEqual(['new-task']);
    expect(state.error.value).toBe('');
    expect(state.loading.value).toBe(false);
  });

  it('preserves the current error when an older successful request finishes last', async () => {
    let resolveOlder!: (value: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOlder = resolve; }))
      .mockResolvedValueOnce(response({ error: 'Current request failed' }, false) as Response);
    const state = useProjectTasks('client-1');

    const olderLoad = state.load('/repo/old');
    await state.load('/repo/new');
    resolveOlder(response({ tasks: [task] }) as Response);
    await olderLoad;

    expect(state.tasks.value).toEqual([]);
    expect(state.error.value).toBe('Current request failed');
    expect(state.loading.value).toBe(false);
  });

  it.each([true, false])('keeps loading the current filter when an older request settles (ok=%s)', async (ok) => {
    let resolveOlder!: (value: Response) => void;
    let resolveLatest!: (value: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOlder = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveLatest = resolve; }));
    const state = useProjectTasks('client-1');

    const olderLoad = state.load('/repo/app');
    state.status.value = 'completed';
    const latestLoad = state.load('/repo/app');
    resolveOlder(response(ok ? { tasks: [task] } : { error: 'Old request failed' }, ok) as Response);
    await olderLoad;

    expect(state.loading.value).toBe(true);
    expect(state.error.value).toBe('');
    expect(state.tasks.value).toEqual([]);

    resolveLatest(response({ tasks: [{ ...task, status: 'completed' }] }) as Response);
    await latestLoad;
    expect(state.loading.value).toBe(false);
    expect(state.tasks.value[0].status).toBe('completed');
  });

  it('refreshes status quietly without hiding the task list behind a loading state', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ tasks: [{ ...task, status: 'completed' }] }) as Response);
    const state = useProjectTasks('client-1');
    const refresh = state.load('/repo/app', true);
    expect(state.loading.value).toBe(false);
    await refresh;
    expect(state.tasks.value[0].status).toBe('completed');
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

  it('keeps start pending through the list refresh and notifies before reloading', async () => {
    let resolveRefresh!: (value: Response) => void;
    const state = useProjectTasks('client-1');
    vi.mocked(fetch).mockResolvedValueOnce(response({ tasks: [task] }) as Response);
    await state.load('/repo/app');
    const startResult = { task: { ...task, status: 'started' }, sessionId: 'session-1', prompt: task.prompt };
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(startResult) as Response)
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve; }));
    const notified = vi.fn(() => {
      expect(state.startingTaskId.value).toBe(task.id);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    window.addEventListener('refresh-tasks', notified);
    try {
      const pending = state.start(task.id);
      await vi.waitFor(() => expect(notified).toHaveBeenCalledOnce());
      expect(state.startingTaskId.value).toBe(task.id);
      expect(state.loading.value).toBe(true);
      expect(fetch).toHaveBeenLastCalledWith('/api/tasks?scope=project&status=waiting&projectPath=%2Frepo%2Fapp');

      resolveRefresh(response({ tasks: [] }) as Response);
      expect(await pending).toEqual(startResult);
      expect(state.tasks.value).toEqual([]);
      expect(state.startingTaskId.value).toBeNull();
      expect(state.loading.value).toBe(false);
    } finally {
      window.removeEventListener('refresh-tasks', notified);
    }
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
    expect(state.startingTaskId.value).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
