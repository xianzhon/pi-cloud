import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { ProjectTaskStore } from './project-task-store';
import { GatewayTaskCommands } from './gateway-task-commands';
import type { PiSessionService } from './session-manager';
import type { ProjectTaskStarter } from './project-task-starter';

const config = { defaultCwd: '/repo/app', cwdChoices: ['/repo/app'], agentProfile: 'default' };
describe('GatewayTaskCommands', () => {
  let db: PiCloudDatabase;
  let store: ProjectTaskStore;
  let service: GatewayTaskCommands;
  let starter: { start: ReturnType<typeof vi.fn> };
  let prompt: ReturnType<typeof vi.fn>;
  let cleanup: ReturnType<typeof vi.fn>;
  let abort: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db = openPiCloudDatabase(':memory:');
    let nextId = 1;
    store = new ProjectTaskStore(db, { createId: () => `task-id-${nextId++}` });
    prompt = vi.fn(async () => {});
    cleanup = vi.fn();
    abort = vi.fn(async () => {});
    starter = { start: vi.fn(async (id, _clientId, _signal, projectPath) => {
      const task = store.claimStart(id);
      expect(task.projectPath).toBe(projectPath);
      return { task: store.markStarted(id, 'session-1'), sessionId: 'session-1', prompt: task.prompt, images: [] };
    }) };
    const sessions = {
      listAgentProfileModels: async () => [{ provider: 'profile', id: 'default-model', current: true }],
      getSession: () => ({ prompt, abort }),
      runForegroundWithClientProfileProxy: async (_id: string, fn: () => Promise<unknown>) => fn(),
      runSessionExecution: async (_session: unknown, fn: () => Promise<unknown>) => fn(),
      scheduleCleanup: cleanup,
    } as unknown as PiSessionService;
    service = new GatewayTaskCommands({ store, starter: starter as unknown as ProjectTaskStarter, sessions, resolvePath: async (path) => path });
  });
  afterEach(async () => { await service.stop(); db.close(); });
  async function create(title = '修复登录', project = config) {
    await service.execute({ action: 'create_task', title, prompt: '修复登录错误，不添加其他功能' }, project);
    return store.list().at(-1)!;
  }
  it('saves a waiting task with profile defaults and all skills without starting it', async () => {
    const task = await create();
    expect(task).toMatchObject({ projectPath: '/repo/app', title: '修复登录', prompt: '修复登录错误，不添加其他功能', status: 'waiting', modelProvider: 'profile', modelId: 'default-model', skillMode: 'all', skills: [], agentProfileId: 'default' });
    expect(starter.start).not.toHaveBeenCalled();
  });
  it('lists only waiting tasks in the current project with IDs', async () => {
    const task = await create();
    await create('其他项目', { ...config, defaultCwd: '/repo/other', cwdChoices: ['/repo/other'] });
    const started = await create('已经启动');
    store.claimStart(started.id);
    store.markStarted(started.id, 'old');
    const result = await service.execute({ action: 'list_tasks' }, config);
    expect(result.reply).toContain(task.id);
    expect(result.reply).not.toContain('其他项目');
    expect(result.reply).not.toContain('已经启动');
  });
  it('starts an independent task session and submits its prompt only once', async () => {
    const task = await create();
    const result = await service.execute({ action: 'start_task', target: task.id }, config);
    expect(result.reply).toContain('session-1');
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledWith(task.prompt, { images: [] }));
    expect(starter.start.mock.calls[0][1]).toBe(`gateway-task:${task.id}`);
    await service.execute({ action: 'start_task', target: task.title }, config);
    expect(starter.start).toHaveBeenCalledTimes(1);
  });
  it('refuses ambiguous titles, ordinals, and cross-project targets', async () => {
    await create();
    await create();
    const other = await create('其他项目', { ...config, defaultCwd: '/repo/other', cwdChoices: ['/repo/other'] });
    for (const target of ['修复登录', '第二个', other.id]) {
      expect((await service.execute({ action: 'start_task', target }, config)).reply).toMatch(/指定|匹配/);
    }
    expect(starter.start).not.toHaveBeenCalled();
  });
  it('rejects a concurrent duplicate start through the existing atomic claim', async () => {
    const task = await create();
    const results = await Promise.allSettled([
      service.execute({ action: 'start_task', target: task.id }, config),
      service.execute({ action: 'start_task', target: task.id }, config),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled' && result.value.reply.includes('已开始执行'))).toHaveLength(1);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });
  it('retains started status for review after prompt failure and cleans up the isolated client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    prompt.mockRejectedValueOnce(new Error('execution failed'));
    const task = await create();
    await service.execute({ action: 'start_task', target: task.id }, config);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledWith(`gateway-task:${task.id}`));
    expect(store.get(task.id)).toMatchObject({ status: 'started', sessionId: 'session-1' });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
  it('does not block server shutdown when a running provider ignores cancellation', async () => {
    prompt.mockImplementation(() => new Promise(() => {}));
    abort.mockImplementation(() => new Promise(() => {}));
    const task = await create();
    await service.execute({ action: 'start_task', target: task.id }, config);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    vi.useFakeTimers();
    try {
      const stopped = service.stop();
      await vi.advanceTimersByTimeAsync(1000);
      await stopped;
      expect(abort).toHaveBeenCalled();
      expect(store.get(task.id)?.status).toBe('started');
    } finally {
      vi.useRealTimers();
      abort.mockResolvedValue(undefined);
    }
  });
  it('refuses new operations after shutdown', async () => {
    await service.stop();
    await expect(service.execute({ action: 'create_task', title: 'task', prompt: 'task' }, config)).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
  it('refuses absent or disallowed project configuration', async () => {
    await expect(service.execute({ action: 'list_tasks' }, { ...config, defaultCwd: '/etc' })).rejects.toThrow();
    await expect(service.execute({ action: 'list_tasks' }, { cwdChoices: [] })).rejects.toThrow();
  });
});
