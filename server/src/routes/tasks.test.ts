import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTaskConflictError, ProjectTaskNotFoundError, ProjectTaskValidationError } from '../services/project-task-store';
import { taskRoutes } from './tasks';

const task = {
  id: 'task-1',
  projectPath: '/repo/app',
  title: 'Task',
  prompt: 'Implement it',
  notes: 'private',
  status: 'waiting' as const,
  agentProfileId: 'codex',
  modelProvider: 'openai',
  modelId: 'gpt-5.4',
  skillMode: 'all' as const,
  skills: [],
  worktree: { mode: 'none' as const },
  sessionId: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
};

const draft = {
  projectPath: task.projectPath,
  title: task.title,
  prompt: task.prompt,
  notes: task.notes,
  agentProfileId: task.agentProfileId,
  modelProvider: task.modelProvider,
  modelId: task.modelId,
  skillMode: task.skillMode,
  skills: task.skills,
  worktree: task.worktree,
};

function createMockApp() {
  const handlers: Record<string, Function> = {};
  const register = (method: string) => vi.fn((path: string, handler: Function) => { handlers[`${method} ${path}`] = handler; });
  return {
    app: { get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') },
    handlers,
  };
}

function createReply() {
  return { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
}

describe('task routes', () => {
  let store: any;
  let starter: any;

  beforeEach(() => {
    store = {
      list: vi.fn().mockReturnValue([task]),
      create: vi.fn().mockReturnValue(task),
      get: vi.fn().mockReturnValue(task),
      update: vi.fn().mockReturnValue(task),
      delete: vi.fn(),
      complete: vi.fn().mockReturnValue({ ...task, status: 'completed' }),
    };
    starter = {
      start: vi.fn().mockResolvedValue({ task: { ...task, status: 'started', sessionId: 'session-1' }, sessionId: 'session-1', prompt: task.prompt }),
    };
  });

  async function setup() {
    const { app, handlers } = createMockApp();
    await taskRoutes(app as any, { store, starter });
    return handlers;
  }

  it('lists tasks by project and status', async () => {
    const handlers = await setup();
    const result = await handlers['GET /']({ query: { scope: 'project', projectPath: '/repo/app', status: 'waiting' } }, createReply());

    expect(store.list).toHaveBeenCalledWith({ projectPath: '/repo/app', status: 'waiting' });
    expect(result).toEqual({ tasks: [task] });
  });

  it('creates and updates a fully validated task draft', async () => {
    const handlers = await setup();

    expect(await handlers['POST /']({ body: draft }, createReply())).toEqual({ task });
    expect(store.create).toHaveBeenCalledWith(draft);

    expect(await handlers['PUT /:id']({ params: { id: 'task-1' }, body: draft }, createReply())).toEqual({ task });
    expect(store.update).toHaveBeenCalledWith('task-1', draft);
  });

  it('starts, completes, and deletes tasks', async () => {
    const handlers = await setup();

    const started = await handlers['POST /:id/start']({ params: { id: 'task-1' }, body: { clientId: 'client-1' } }, createReply());
    expect(starter.start).toHaveBeenCalledWith('task-1', 'client-1');
    expect(started.sessionId).toBe('session-1');

    await handlers['POST /:id/complete']({ params: { id: 'task-1' } }, createReply());
    expect(store.complete).toHaveBeenCalledWith('task-1');

    expect(await handlers['DELETE /:id']({ params: { id: 'task-1' } }, createReply())).toEqual({ success: true });
    expect(store.delete).toHaveBeenCalledWith('task-1');
  });

  it('rejects malformed list, draft, and start requests', async () => {
    const handlers = await setup();

    for (const [key, request] of [
      ['GET /', { query: { scope: 'project', status: 'waiting' } }],
      ['GET /', { query: { scope: 'all', status: 'invalid' } }],
      ['POST /', { body: { ...draft, title: '' } }],
      ['POST /polish', { body: { clientId: 'client-1', prompt: '' } }],
      ['POST /:id/start', { params: { id: 'task-1' }, body: {} }],
    ] as const) {
      const reply = createReply();
      await handlers[key](request, reply);
      expect(reply.status).toHaveBeenCalledWith(400);
    }
  });

  it('maps pull request activity onto tasks', async () => {
    const activityStore = { listLatestPrForSessions: vi.fn(() => new Map([
      ['session-1', { data: { number: 12, url: 'https://example.test/12', merged: true } }],
    ])) };
    store.list.mockReturnValue([{ ...task, sessionId: 'session-1' }, { ...task, id: 'task-2', sessionId: null }]);
    const { app, handlers } = createMockApp();
    await taskRoutes(app as any, { store, starter, activityStore } as any);
    const result = await handlers['GET /']({ query: {} }, createReply());
    expect(result.tasks[0].pullRequest).toEqual({ number: 12, url: 'https://example.test/12', status: 'merged' });
    expect(result.tasks[1].pullRequest).toBeUndefined();
  });

  it('rejects every malformed draft field and invalid scope', async () => {
    const handlers = await setup();
    const invalidBodies = [
      null, { ...draft, skills: 'read' }, { ...draft, skills: [1] }, { ...draft, skillMode: 'bad' },
      { ...draft, projectPath: 1 }, { ...draft, title: ' ' }, { ...draft, prompt: null },
      { ...draft, agentProfileId: '' }, { ...draft, modelProvider: 1 }, { ...draft, modelId: '' },
      { ...draft, presetId: 1 },
    ];
    for (const body of invalidBodies) {
      const reply = createReply();
      await handlers['POST /']({ body }, reply);
      expect(reply.status).toHaveBeenCalledWith(400);
    }
    const reply = createReply();
    await handlers['GET /']({ query: { scope: 'other' } }, reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it('supports optional draft values and missing task lookup', async () => {
    const handlers = await setup();
    await handlers['POST /']({ body: { ...draft, notes: 1, presetId: '' } }, createReply());
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ notes: '', presetId: null }));
    store.get.mockReturnValueOnce(null);
    const reply = createReply();
    await handlers['GET /:id']({ params: { id: 'missing' } }, reply);
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it.each([
    [new ProjectTaskNotFoundError('Task not found'), 404],
    [new ProjectTaskConflictError('Already started'), 409],
    [new ProjectTaskValidationError('Model unavailable'), 409],
    [new Error('Unexpected'), 500],
  ])('maps a start error to its API status', async (error, status) => {
    starter.start.mockRejectedValue(error);
    const handlers = await setup();
    const reply = createReply();

    await handlers['POST /:id/start']({ params: { id: 'task-1' }, body: { clientId: 'client-1' } }, reply);

    expect(reply.status).toHaveBeenCalledWith(status);
    expect(reply.send).toHaveBeenCalledWith({ error: error.message });
  });
});
