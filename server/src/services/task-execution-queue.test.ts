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
  afterEach(async () => { vi.useRealTimers(); await queue.stop(); db.close(); await rm(cwd, { recursive: true, force: true }); });

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

  it.each(['checkout', 'commit'])('pauses when a concurrent %s races with staging', async (operation) => {
    const first = create('Raced commit');
    const second = create('Next');
    const originalHead = await git('rev-parse', 'HEAD');
    const originalBranch = await git('symbolic-ref', 'HEAD');
    queue = makeQueue(async (_path, args) => {
      const result = await git(...args);
      if (args[0] === 'add') {
        if (operation === 'checkout') await git('checkout', '-b', 'unexpected');
        else await git('commit', '--allow-empty', '--only', '-m', 'Concurrent commit');
      }
      return result;
    });
    prompt.mockImplementation(async (text: string) => {
      await writeFile(join(cwd, 'change.txt'), 'done');
      success(text);
    });
    queue.configure([first.id, second.id], true);
    await finished();
    expect(await git('log', '-1', '--format=%s')).toBe('feat: Raced commit');
    if (operation === 'checkout') {
      expect(await git('symbolic-ref', 'HEAD')).not.toBe(originalBranch);
    } else {
      expect(await git('rev-parse', 'HEAD^')).not.toBe(originalHead);
    }
    expect(queue.get().error).toContain('changed while committing');
    expect(tasks.get(first.id)?.status).toBe('started');
    expect(tasks.get(second.id)?.status).toBe('waiting');
    expect(starter.start).toHaveBeenCalledTimes(1);
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
    // Signal readiness directly rather than polling real Git startup with a 1s deadline.
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    prompt.mockImplementation(async (text: string) => { notifyStarted(); await gate; success(text); });
    queue.configure([first.id, second.id], true);
    await started;
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
    await finished();
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

  it('waits until the scheduled time and consumes the schedule only once', async () => {
    const task = create('Scheduled');
    vi.useFakeTimers();
    const scheduledAt = new Date(Date.now() + 120_000).toISOString();
    expect(queue.configure([task.id], true, scheduledAt).scheduledAt).toBe(scheduledAt);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(starter.start).not.toHaveBeenCalled();
    expect(tasks.get(task.id)?.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.get().scheduledAt).toBeNull();
    vi.useRealTimers();
    await finished();
    expect(tasks.get(task.id)?.status).toBe('completed');
    expect(starter.start).toHaveBeenCalledTimes(1);
  });

  it('reschedules and cancels a pending start', async () => {
    const task = create('Scheduled');
    vi.useFakeTimers();
    queue.configure([task.id], true, new Date(Date.now() + 1000).toISOString());
    queue.configure([task.id], true, new Date(Date.now() + 5000).toISOString());
    await vi.advanceTimersByTimeAsync(1000);
    expect(starter.start).not.toHaveBeenCalled();
    queue.configure([task.id], false);
    expect(queue.get().scheduledAt).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starter.start).not.toHaveBeenCalled();
  });

  it.each([false, true])('restores a pending schedule after shutdown (overdue: %s)', async (overdue) => {
    const task = create('Restored');
    vi.useFakeTimers();
    const scheduledAt = new Date(Date.now() + 5000).toISOString();
    queue.configure([task.id], true, scheduledAt);
    await queue.stop();
    await vi.advanceTimersByTimeAsync(overdue ? 10_000 : 1000);
    expect(starter.start).not.toHaveBeenCalled();
    queue = makeQueue();
    expect(queue.get().scheduledAt).toBe(scheduledAt);
    expect(queue.get().error).toBe('');
    await vi.advanceTimersByTimeAsync(overdue ? 0 : 4000);
    vi.useRealTimers();
    await finished();
    expect(starter.start).toHaveBeenCalledTimes(1);
  });

  it('pauses for review if a scheduled task was manually started before its deadline', async () => {
    const task = create('Changed');
    vi.useFakeTimers();
    queue.configure([task.id], true, new Date(Date.now() + 1000).toISOString());
    tasks.claimStart(task.id);
    tasks.markStarted(task.id, 'manual-session');
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await finished();
    expect(queue.get().error).toContain('no longer waiting');
    expect(starter.start).not.toHaveBeenCalled();
    expect(queue.get().scheduledAt).toBeNull();
  });

  it('validates schedule timestamps without changing the existing plan', () => {
    const task = create('Scheduled');
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    queue.configure([task.id], true, scheduledAt);
    for (const invalid of ['', 'tomorrow', '2030-01-01T12:00', new Date(Date.now() - 1000).toISOString(), 123]) {
      expect(() => queue.configure([task.id], true, invalid)).toThrow('future timestamp');
      expect(queue.get().scheduledAt).toBe(scheduledAt);
    }
    expect(() => queue.configure([task.id], false, scheduledAt)).toThrow('Enable');
    expect(() => queue.configure([], true, scheduledAt)).toThrow('Select at least');
  });

  describe('independent task schedules', () => {
    function schedule(title: string, projectPath = cwd, delay = 1000) {
      const task = create(title);
      return tasks.update(task.id, { ...task, projectPath, scheduledAt: new Date(Date.now() + delay).toISOString() });
    }
    function startScheduler() {
      vi.useFakeTimers();
      queue = makeQueue(async (path, args) => {
        if (args.includes('--git-common-dir') || args.includes('--show-toplevel')) return path;
        if (args[0] === 'rev-parse') return 'head';
        if (args[0] === 'symbolic-ref') return 'refs/heads/main';
        return '';
      });
      queue.startTaskSchedules();
    }

    it('executes a due task without enabling the shared queue', async () => {
      startScheduler();
      const task = schedule('Independent');
      await vi.advanceTimersByTimeAsync(999);
      expect(starter.start).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(tasks.get(task.id)).toMatchObject({ status: 'completed', scheduledAt: null, scheduleError: null });
      expect(queue.get().enabled).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(starter.start).toHaveBeenCalledTimes(1);
    });

    it('runs despite an input-blocked shared queue and preserves its paused state and error', async () => {
      startScheduler();
      const blocked = create('Needs input');
      const waiting = create('Shared waiting');
      const independent = schedule('Independent');
      prompt.mockImplementation(async (text: string) => {
        if (text.startsWith('Needs input')) messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Need input' }] });
        else success(text);
      });
      queue.configure([blocked.id, waiting.id], true);
      await vi.advanceTimersByTimeAsync(0);
      const paused = queue.get();
      expect(paused.enabled).toBe(false);
      expect(paused.error).toContain('did not confirm');
      await vi.advanceTimersByTimeAsync(1000);
      expect(tasks.get(independent.id)?.status).toBe('completed');
      expect(tasks.get(waiting.id)?.status).toBe('waiting');
      expect(queue.get().error).toBe(paused.error);
      expect(queue.get().enabled).toBe(false);
    });

    it('waits for a shared task in the same repository before starting', async () => {
      startScheduler();
      const shared = create('Shared');
      const independent = schedule('Independent');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      prompt.mockImplementation(async (text: string) => {
        if (text.startsWith('Shared')) await gate;
        success(text);
      });
      queue.configure([shared.id], true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(tasks.get(independent.id)?.scheduledAt).not.toBeNull();
      expect(starter.start).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(1000);
      expect(tasks.get(shared.id)?.status).toBe('completed');
      expect(tasks.get(independent.id)?.status).toBe('completed');
    });

    it('makes a shared task wait for an independent task using the same repository', async () => {
      startScheduler();
      const independent = schedule('Independent');
      const shared = create('Shared');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      prompt.mockImplementation(async (text: string) => {
        if (text.startsWith('Independent')) await gate;
        success(text);
      });
      await vi.advanceTimersByTimeAsync(1000);
      queue.configure([shared.id], true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(tasks.get(shared.id)?.status).toBe('waiting');
      expect(starter.start).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(1000);
      expect(tasks.get(independent.id)?.status).toBe('completed');
      expect(tasks.get(shared.id)?.status).toBe('completed');
    });

    it('does not let one independent task needing input block the next due task', async () => {
      startScheduler();
      const first = schedule('Needs input');
      const second = schedule('Next');
      prompt.mockImplementation(async (text: string) => {
        if (text.startsWith('Needs input')) messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Need input' }] });
        else success(text);
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(tasks.get(first.id)).toMatchObject({ status: 'started', scheduledAt: null, scheduleError: expect.stringContaining('did not confirm') });
      expect(tasks.get(second.id)?.status).toBe('completed');
      await vi.advanceTimersByTimeAsync(3000);
      expect(starter.start).toHaveBeenCalledTimes(2);
    });

    it('supports cancellation, rescheduling, deletion and manual starts before a deadline', async () => {
      startScheduler();
      const cancelled = schedule('Cancelled');
      const later = schedule('Later');
      const deleted = schedule('Deleted');
      const manual = schedule('Manual');
      tasks.update(cancelled.id, { ...cancelled, scheduledAt: null });
      tasks.update(later.id, { ...later, scheduledAt: new Date(Date.now() + 5000).toISOString() });
      tasks.delete(deleted.id);
      tasks.claimStart(manual.id);
      tasks.markStarted(manual.id, 'manual-session');
      await vi.advanceTimersByTimeAsync(4000);
      expect(starter.start).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(starter.start.mock.calls.map(([id]) => id)).toEqual([later.id]);
    });

    it('restores overdue pending schedules after restart but never replays started tasks', async () => {
      startScheduler();
      const pending = schedule('Pending');
      const started = schedule('Already started');
      tasks.claimStart(started.id);
      tasks.markStarted(started.id, 'existing-session');
      await queue.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(starter.start).not.toHaveBeenCalled();
      startScheduler();
      await vi.advanceTimersByTimeAsync(1000);
      expect(tasks.get(pending.id)?.status).toBe('completed');
      expect(starter.start.mock.calls.map(([id]) => id)).toEqual([pending.id]);
    });

    it('records preflight errors without retrying or pausing the shared queue', async () => {
      startScheduler();
      const independent = schedule('Forbidden');
      await queue.stop();
      queue = new TaskExecutionQueue({ db, tasks, starter, sessions, resolvePath: async () => { throw new Error('Path outside allowed roots'); } });
      queue.startTaskSchedules();
      await vi.advanceTimersByTimeAsync(3000);
      expect(tasks.get(independent.id)).toMatchObject({ status: 'waiting', scheduledAt: null, scheduleError: 'Path outside allowed roots' });
      expect(starter.start).not.toHaveBeenCalled();
      expect(queue.get().error).toBe('');
    });

    it('keeps individually scheduled tasks out of the shared queue', async () => {
      startScheduler();
      const independent = schedule('Independent');
      expect(() => queue.configure([independent.id], true)).toThrow('independently');
      const shared = create('Shared');
      queue.configure([shared.id], false);
      tasks.update(shared.id, { ...shared, scheduledAt: new Date(Date.now() + 5000).toISOString() });
      expect(queue.get().taskIds).toEqual([]);
    });
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
