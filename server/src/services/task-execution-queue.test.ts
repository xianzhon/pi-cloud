import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { ProjectTaskStore } from './project-task-store.js';
import type { ProjectTaskStarter } from './project-task-starter.js';
import { TaskExecutionQueue } from './task-execution-queue.js';

const exec = promisify(execFile);
describe('TaskExecutionQueue', () => {
  let db: PiCloudDatabase;
  let tasks: ProjectTaskStore;
  let cwd: string;
  let queue: TaskExecutionQueue;
  let messages: any[];
  let prompt: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  let starter: { start: ReturnType<typeof vi.fn<ProjectTaskStarter['start']>> };
  let sessions: any;

  async function git(...args: string[]): Promise<string> {
    return (await exec('git', args, { cwd })).stdout.trim();
  }
  function create(title: string) {
    return tasks.create({ projectPath: cwd, title, prompt: title, notes: '', agentProfileId: 'default', modelProvider: 'test', modelId: 'test', skillMode: 'all', skills: [], worktree: { mode: 'none' } });
  }
  function success(text: string) {
    messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: text.split('last line of your final response: ')[1] }] });
  }
  function makeQueue(gitOverride?: (path: string, args: string[]) => Promise<string>) {
    return new TaskExecutionQueue({ db, tasks, starter, sessions, resolvePath: async (path) => path, git: gitOverride });
  }
  async function finished() {
    await vi.waitFor(() => {
      expect(queue.get().enabled).toBe(false);
      expect(queue.get().activeTaskId).toBeNull();
    }, { timeout: 10_000 });
  }

  beforeEach(async () => {
    db = openPiCloudDatabase(':memory:');
    tasks = new ProjectTaskStore(db);
    cwd = await mkdtemp(join(tmpdir(), 'task-queue-'));
    await git('init');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('commit', '--allow-empty', '-m', 'Initial');
    messages = [];
    prompt = vi.fn(async (text: string) => { success(text); });
    sessions = { getSession: () => ({ messages, prompt }), runForegroundWithClientProfileProxy: async (_id: string, fn: () => Promise<void>) => fn(), runSessionExecution: vi.fn(async (_session: unknown, fn: () => Promise<void>) => fn()), scheduleCleanup: vi.fn() };
    starter = { start: vi.fn<ProjectTaskStarter['start']>(async (id: string) => {
      tasks.claimStart(id);
      const task = tasks.markStarted(id, `session:${id}`);
      return { task, sessionId: task.sessionId!, prompt: task.prompt, images: [], model: undefined, thinkingLevel: 'off' as const };
    }) };
    queue = makeQueue();
  });
  afterEach(async () => { await queue.stop(); db.close(); await rm(cwd, { recursive: true, force: true }); });

  it('runs in configured order, commits each task before the next, and completes statuses', async () => {
    const first = create('First');
    const second = create('Second');
    prompt.mockImplementation(async (text: string) => {
      if (text.startsWith('First')) expect(await git('log', '-1', '--format=%s')).toBe('feat: Second');
      await writeFile(join(cwd, text.startsWith('First') ? 'first.txt' : 'second.txt'), 'done');
      success(text);
    });
    queue.configure([second.id, first.id], true);
    await finished();
    expect(starter.start.mock.calls.map(([id]) => id)).toEqual([second.id, first.id]);
    expect(tasks.get(first.id)?.status).toBe('completed');
    expect(tasks.get(second.id)?.status).toBe('completed');
    expect(await git('status', '--porcelain')).toBe('');
    expect(queue.get().taskIds).toEqual([]);
    expect(sessions.scheduleCleanup.mock.calls).toEqual([[`task-execution:${second.id}`], [`task-execution:${first.id}`]]);
    expect(sessions.runSessionExecution).toHaveBeenCalledTimes(2);
  });

  it('completes successful tasks with no changes without creating a commit', async () => {
    const task = create('Read only');
    const head = await git('rev-parse', 'HEAD');
    queue.configure([task.id], true);
    await finished();
    expect(tasks.get(task.id)?.status).toBe('completed');
    expect(await git('rev-parse', 'HEAD')).toBe(head);
  });

  it('pauses when the agent needs input and does not start the next task', async () => {
    const first = create('Needs input');
    const second = create('Next');
    prompt.mockImplementation(async () => { messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Which option?' }] }); });
    queue.configure([first.id, second.id], true);
    await finished();
    expect(queue.get().error).toContain('did not confirm');
    expect(sessions.scheduleCleanup).toHaveBeenCalledWith(`task-execution:${first.id}`);
    expect(tasks.get(first.id)?.status).toBe('started');
    expect(tasks.get(second.id)?.status).toBe('waiting');
    expect(starter.start).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'aborted'])('pauses on an %s response even with the completion marker', async (stopReason) => {
    const task = create('Interrupted');
    prompt.mockImplementation(async (text: string) => { success(text); messages.at(-1).stopReason = stopReason; });
    queue.configure([task.id], true);
    await finished();
    expect(tasks.get(task.id)?.status).toBe('started');
    expect(queue.get().error).toContain('failed or was interrupted');
  });

  it('pauses when the branch changes even if HEAD stays the same', async () => {
    const task = create('Branch change');
    prompt.mockImplementation(async (text: string) => { await git('checkout', '-b', 'unexpected'); success(text); });
    queue.configure([task.id], true);
    await finished();
    expect(tasks.get(task.id)?.status).toBe('started');
    expect(queue.get().error).toContain('HEAD or branch changed');
  });

  it('checks allowed paths before creating a session or running the agent', async () => {
    const task = create('Forbidden');
    queue = new TaskExecutionQueue({ db, tasks, starter, sessions, resolvePath: async () => { throw new Error('Path outside allowed roots'); } });
    queue.configure([task.id], true);
    await finished();
    expect(queue.get().error).toContain('allowed roots');
    expect(starter.start).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('rejects dirty repositories before starting a task', async () => {
    const task = create('Dirty');
    await writeFile(join(cwd, 'unrelated.txt'), 'existing work');
    queue.configure([task.id], true);
    await finished();
    expect(queue.get().error).toContain('uncommitted changes');
    expect(tasks.get(task.id)?.status).toBe('waiting');
    expect(starter.start).not.toHaveBeenCalled();
  });

  it('pauses on commit failure without completing or picking up another task', async () => {
    const first = create('Commit fails');
    const second = create('Next');
    queue = makeQueue(async (_path, args) => {
      if (args[0] === 'commit') throw new Error('Commit hook failed');
      return git(...args);
    });
    prompt.mockImplementation(async (text: string) => { await writeFile(join(cwd, 'change.txt'), 'done'); success(text); });
    queue.configure([first.id, second.id], true);
    await finished();
    expect(queue.get().error).toBe('Commit hook failed');
    expect(tasks.get(first.id)?.status).toBe('started');
    expect(tasks.get(second.id)?.status).toBe('waiting');
  });

  it('switching off finishes the current task, blocks rearrangement, and leaves the next waiting', async () => {
    const first = create('First');
    const second = create('Second');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    prompt.mockImplementation(async (text: string) => { await gate; success(text); });
    queue.configure([first.id, second.id], true);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(() => queue.configure([second.id], false)).toThrow('Cannot rearrange');
    queue.configure([first.id, second.id], false);
    release();
    await finished();
    expect(tasks.get(first.id)?.status).toBe('completed');
    expect(tasks.get(second.id)?.status).toBe('waiting');
    expect(queue.get().taskIds).toEqual([second.id]);
  });

  it('persists ordering and pauses a saved enabled queue after a restart', () => {
    const first = create('First');
    const second = create('Second');
    queue.configure([second.id, first.id], false);
    expect(makeQueue().get().taskIds).toEqual([second.id, first.id]);
    db.prepare('UPDATE task_execution_queue SET state_json = ?').run(JSON.stringify({ enabled: true, taskIds: [first.id], activeTaskId: first.id, error: '' }));
    const recovered = makeQueue().get();
    expect(recovered.enabled).toBe(false);
    expect(recovered.activeTaskId).toBeNull();
    expect(recovered.error).toContain('Server restarted');
  });

  it('bounds concurrency across repositories and reports all active tasks', async () => {
    const first = create('First');
    const second = tasks.create({ ...first, projectPath: '/other', title: 'Other' });
    const third = tasks.create({ ...first, projectPath: '/third', title: 'Third' });
    const fourth = tasks.create({ ...first, projectPath: '/fourth', title: 'Fourth' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    prompt.mockImplementation(async (text: string) => { await gate; success(text); });
    const taskSessions = new Map<string, any>();
    sessions.getSession = (clientId: string) => {
      if (!taskSessions.has(clientId)) {
        const ownMessages: any[] = [];
        taskSessions.set(clientId, { messages: ownMessages, prompt: async (text: string) => {
          await prompt(text);
          ownMessages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: text.split('last line of your final response: ')[1] }] });
        } });
      }
      return taskSessions.get(clientId);
    };
    queue = makeQueue(async (path, args) => {
      if (args.includes('--git-common-dir')) return path + '/.git';
      if (path !== cwd) {
        if (args[0] === 'status') return '';
        if (args.includes('--show-toplevel')) return path;
        return 'main';
      }
      return git(...args);
    });
    queue.configure([first.id, second.id, third.id, fourth.id], true);
    try {
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(3));
      expect(queue.get().activeTaskIds).toEqual([first.id, second.id, third.id]);
      expect(tasks.get(fourth.id)?.status).toBe('waiting');
    } finally { release(); }
    await finished();
    expect(tasks.get(second.id)?.status).toBe('completed');
    expect(tasks.get(fourth.id)?.status).toBe('completed');
  });

  it('serializes subdirectories sharing the same repository', async () => {
    const first = create('First');
    const second = tasks.create({ ...first, projectPath: cwd + '/subdirectory', title: 'Second' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    prompt.mockImplementation(async (text: string) => { await gate; success(text); });
    queue = makeQueue(async (_path, args) => git(...args));
    queue.configure([first.id, second.id], true);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queue.get().activeTaskIds).toEqual([first.id]);
    expect(tasks.get(second.id)?.status).toBe('waiting');
    release();
    await finished();
    expect(tasks.get(second.id)?.status).toBe('completed');
  });

  it('does not launch a task after pausing during repository lookup', async () => {
    const task = create('First');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let lookingUp = false;
    queue = makeQueue(async (_path, args) => {
      if (args.includes('--git-common-dir')) { lookingUp = true; await gate; }
      return git(...args);
    });
    queue.configure([task.id], true);
    await vi.waitFor(() => expect(lookingUp).toBe(true));
    queue.configure([task.id], false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await finished();
    expect(tasks.get(task.id)?.status).toBe('waiting');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('pauses when a task changes project during repository lookup', async () => {
    const task = create('Moved');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let lookingUp = false;
    queue = makeQueue(async (_path, args) => {
      if (args.includes('--git-common-dir')) { lookingUp = true; await gate; }
      return git(...args);
    });
    queue.configure([task.id], true);
    await vi.waitFor(() => expect(lookingUp).toBe(true));
    tasks.update(task.id, { ...task, projectPath: '/other' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(queue.get().enabled).toBe(false);
    expect(queue.get().error).toContain('project changed');
    expect(tasks.get(task.id)?.status).toBe('waiting');
  });

  it('shutdown cancels a stuck task without completing it', async () => {
    const task = create('Stuck');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let aborted = false;
    sessions.getSession = () => ({ messages, prompt, abort: async () => { aborted = true; } });
    prompt.mockImplementation(async (text: string) => { await gate; success(text); });
    queue.configure([task.id], true);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    let stopped = false;
    const stopping = queue.stop().then(() => { stopped = true; });
    try {
      await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 1500 });
      expect(aborted).toBe(true);
      expect(tasks.get(task.id)?.status).toBe('started');
      expect(queue.get().error).toContain('shutdown');
    } finally { release(); await stopping; }
  });

  it('validates duplicate, missing, and non-waiting task IDs', () => {
    const task = create('Task');
    expect(() => queue.configure([task.id, task.id], false)).toThrow('unique');
    expect(() => queue.configure(['missing'], true)).toThrow('Only waiting');
    expect(() => queue.configure([], true)).toThrow('Select at least');
    tasks.claimStart(task.id);
    tasks.markStarted(task.id, 'session');
    expect(() => queue.configure([task.id], true)).toThrow('Only waiting');
  });
});
