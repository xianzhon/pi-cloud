import { abortable } from '../utils/abortable.js';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { PiCloudDatabase } from '../db/database.js';
import { resolveAllowedExistingPath } from '../utils/path-security.js';
import type { ProjectTaskStarter } from './project-task-starter.js';
import { ProjectTaskValidationError, ProjectTaskConflictError, type ProjectTaskStore, type ProjectTaskRecord } from './project-task-store.js';
import type { PiSessionService } from './session-manager.js';

export interface TaskExecutionQueueState {
  enabled: boolean;
  taskIds: string[];
  activeTaskId: string | null;
  activeTaskIds: string[];
  error: string;
}

interface Dependencies {
  db: PiCloudDatabase;
  tasks: ProjectTaskStore;
  starter: Pick<ProjectTaskStarter, 'start'>;
  sessions: Pick<PiSessionService, 'getSession' | 'runForegroundWithClientProfileProxy' | 'runSessionExecution' | 'scheduleCleanup'>;
  git?: (cwd: string, args: string[]) => Promise<string>;
  resolvePath?: (path: string) => Promise<string>;
}

const execFileAsync = promisify(execFile);

export class TaskExecutionQueue {
  private state: TaskExecutionQueueState;
  private running?: Promise<void>;
  private closing = false;
  private readonly shutdown = new AbortController();
  private activeSessions = new Map<string, { abort(): Promise<void> }>();
  private wakeRunner?: () => void;
  private readonly git: NonNullable<Dependencies['git']>;
  private readonly resolvePath: NonNullable<Dependencies['resolvePath']>;

  constructor(private readonly dependencies: Dependencies) {
    this.git = async (cwd, args) => {
      this.checkOpen();
      const result = dependencies.git
        ? await abortable(() => dependencies.git!(cwd, args), this.shutdown.signal)
        : (await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024, timeout: 120_000, signal: this.shutdown.signal })).stdout.trim();
      this.checkOpen();
      return result;
    };
    this.resolvePath = (path) => abortable(() => (dependencies.resolvePath || resolveAllowedExistingPath)(path), this.shutdown.signal);
    const row = dependencies.db.prepare('SELECT state_json FROM task_execution_queue WHERE id = 1').get() as { state_json: string } | undefined;
    this.state = row ? JSON.parse(row.state_json) : { enabled: false, taskIds: [], activeTaskId: null, activeTaskIds: [], error: '' };
    this.state.activeTaskIds ||= this.state.activeTaskId ? [this.state.activeTaskId] : [];
    let changed = false;
    // Never replay a partially executed task after a server restart.
    if (this.state.enabled || this.state.activeTaskIds.length) {
      this.state.enabled = false;
      this.state.activeTaskId = null;
      this.state.activeTaskIds = [];
      this.state.error = 'Server restarted. Review any started task and arrange the remaining queue before enabling it.';
      changed = true;
    }
    if (this.pruneUnavailableTaskIds().size) changed = true;
    if (changed) this.save();
  }

  get(): TaskExecutionQueueState {
    if (this.pruneUnavailableTaskIds().size) this.save();
    return { ...this.state, taskIds: [...this.state.taskIds], activeTaskIds: [...this.state.activeTaskIds] };
  }

  configure(taskIds: unknown, enabled: unknown): TaskExecutionQueueState {
    if (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== 'string') || new Set(taskIds).size !== taskIds.length || typeof enabled !== 'boolean') {
      throw new ProjectTaskValidationError('Provide unique task IDs and an enabled boolean');
    }
    const unavailableTaskIds = this.pruneUnavailableTaskIds();
    if (unavailableTaskIds.size) this.save();
    const availableTaskIds = taskIds.filter((id) => !unavailableTaskIds.has(id) && (
      !this.running || this.state.taskIds.includes(id) || this.dependencies.tasks.get(id)?.status !== 'completed'
    ));
    if (this.running && this.state.taskIds.some((id, index) => availableTaskIds[index] !== id)) {
      throw new ProjectTaskConflictError('Cannot rearrange the queue while a task is running; only new tasks can be appended');
    }
    for (const id of availableTaskIds) {
      if (this.state.activeTaskIds.includes(id)) continue;
      if (enabled && this.dependencies.tasks.get(id)?.status !== 'waiting') {
        throw new ProjectTaskValidationError('Only waiting tasks can be queued. Remove any failed or manually started task first.');
      }
    }
    if (enabled && !availableTaskIds.length) throw new ProjectTaskValidationError('Select at least one task');
    this.state.taskIds = [...availableTaskIds];
    this.state.enabled = enabled;
    this.state.error = '';
    this.save();
    const result = this.get();
    if (enabled && !this.running && !this.closing) {
      this.running = this.run().finally(() => { this.running = undefined; });
    } else if (this.running) {
      this.wakeRunner?.();
    }
    return result;
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.state.enabled = false;
    this.save();
    this.shutdown.abort(new Error('Server shutdown interrupted task execution. Review started tasks before continuing.'));
    const aborts = [...this.activeSessions.values()].map(async (session) => {
      try { await session.abort(); } catch { /* interrupted sessions remain started for review */ }
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([Promise.allSettled(aborts), new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]);
      await this.running;
    } finally { if (timer) clearTimeout(timer); }
  }

  private save(): void {
    this.dependencies.db.prepare('INSERT INTO task_execution_queue (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json')
      .run(JSON.stringify(this.state));
  }

  private pruneUnavailableTaskIds(): Set<string> {
    if (this.state.enabled || this.state.activeTaskIds.length) return new Set();
    const unavailable = new Set(this.state.taskIds.filter((id) => this.dependencies.tasks.get(id)?.status !== 'waiting'));
    if (unavailable.size) this.state.taskIds = this.state.taskIds.filter((id) => !unavailable.has(id));
    return unavailable;
  }

  private checkOpen(): void {
    if (this.closing) throw new Error('Server shutdown interrupted task execution. Review started tasks before continuing.');
  }

  private async run(): Promise<void> {
    const active = new Map<string, { repository: string; done: Promise<void> }>();
    const repositories = new Map<string, string>();
    const publish = () => {
      this.state.activeTaskIds = [...active.keys()];
      this.state.activeTaskId = this.state.activeTaskIds[0] || null;
      if (!this.state.taskIds.length) this.state.enabled = false;
      this.save();
    };
    const fail = (error: unknown) => {
      this.state.enabled = false;
      this.state.error = error instanceof Error ? error.message : String(error);
    };
    while ((this.state.enabled && !this.closing && this.state.taskIds.length) || active.size) {
      if (this.state.enabled && !this.closing) {
        for (const id of this.state.taskIds) {
          if (active.size >= 3 || !this.state.enabled || this.closing) break;
          if (active.has(id)) continue;
          try {
            const task = this.dependencies.tasks.get(id);
            if (!task || task.status !== 'waiting') throw new Error('Queued task is no longer waiting');
            let repository = repositories.get(task.projectPath);
            if (!repository) {
              const path = await abortable(() => this.resolvePath(task.projectPath), this.shutdown.signal);
              const commonDir = await this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
              repository = await abortable(() => this.resolvePath(commonDir), this.shutdown.signal);
              repositories.set(task.projectPath, repository);
            }
            if ([...active.values()].some((run) => run.repository === repository)) continue;
            this.checkOpen();
            if (!this.state.enabled) break;
            if (!this.state.taskIds.includes(id)) continue;
            const latest = this.dependencies.tasks.get(id);
            if (!latest || latest.status !== 'waiting') throw new Error('Queued task is no longer waiting');
            if (latest.projectPath !== task.projectPath) throw new Error('Queued task project changed. Review the queue before continuing.');
            const done = this.execute(latest, repository).then(() => {
              this.checkOpen();
              this.dependencies.tasks.complete(id);
              this.state.taskIds = this.state.taskIds.filter((taskId) => taskId !== id);
            }).catch(fail).finally(() => {
              active.delete(id);
              publish();
            });
            active.set(id, { repository, done });
            publish();
          } catch (error) { fail(error); break; }
        }
      }
      if (active.size) {
        let wake!: () => void;
        const queueChanged = new Promise<void>((resolve) => { wake = resolve; });
        this.wakeRunner = wake;
        try {
          await Promise.race([...active.values()].map((run) => run.done).concat(queueChanged));
        } finally {
          if (this.wakeRunner === wake) this.wakeRunner = undefined;
        }
      } else break;
    }
    publish();
  }

  private async execute(task: ProjectTaskRecord, repository: string): Promise<void> {
    const projectPath = await this.resolvePath(task.projectPath);
    await this.resolvePath(await this.git(projectPath, ['rev-parse', '--show-toplevel']));
    if (await this.git(projectPath, ['status', '--porcelain', '--untracked-files=all'])) {
      throw new Error('Repository has uncommitted changes. Commit or stash them before running the queue.');
    }
    const clientId = `task-execution:${task.id}`;
    try {
      const started = await this.dependencies.starter.start(task.id, clientId, this.shutdown.signal, task.projectPath);
      this.checkOpen();
      const session = this.dependencies.sessions.getSession(clientId, started.sessionId);
      if (!session) throw new Error('Task session is unavailable');
      this.activeSessions.set(task.id, session);
      if (started.task.projectPath !== task.projectPath) throw new Error('Queued task project changed. Review the queue before continuing.');
      const cwd = await this.resolvePath(started.worktree?.worktreePath || projectPath);
      await this.resolvePath(await this.git(cwd, ['rev-parse', '--show-toplevel']));
      const actualRepository = await this.resolvePath(await this.git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
      if (actualRepository !== repository) throw new Error('Task repository changed during startup. Review the queue before continuing.');
      if (await this.git(cwd, ['status', '--porcelain', '--untracked-files=all'])) {
        throw new Error('Task worktree has uncommitted changes. Review it before continuing.');
      }
      const head = await this.git(cwd, ['rev-parse', 'HEAD']);
      const branch = await this.git(cwd, ['symbolic-ref', 'HEAD']);
      const marker = `TASK_COMPLETE_${randomUUID()}`;
      await abortable(() => this.dependencies.sessions.runForegroundWithClientProfileProxy(clientId, () => {
        this.checkOpen();
        return abortable(() => this.dependencies.sessions.runSessionExecution(session, () => session.prompt(
          `${started.prompt}\n\nAutomatic task execution rules:\nImplement the task and run appropriate verification. Do not commit, push, switch branches, or modify unrelated files. The server will commit your changes after success. If you need input or cannot finish successfully, explain the blocker and do NOT output the completion marker. Only when the entire task is successfully finished, put this exact marker on the last line of your final response: ${marker}`,
          { images: started.images },
        )), this.shutdown.signal);
      }, this.shutdown.signal), this.shutdown.signal);
      this.checkOpen();
      const response = [...session.messages].reverse().find((message) => message.role === 'assistant');
      if (!response || response.role !== 'assistant' || response.stopReason !== 'stop') {
        throw new Error('Task failed or was interrupted. Review its session before continuing.');
      }
      const text = response.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n').trim();
      if (text.split('\n').at(-1)?.trim() !== marker) {
        throw new Error('Task did not confirm successful completion; it may need your input. Review its session.');
      }
      if (await this.git(cwd, ['rev-parse', 'HEAD']) !== head || await this.git(cwd, ['symbolic-ref', 'HEAD']) !== branch) {
        throw new Error('Repository HEAD or branch changed during execution. Review the task before continuing.');
      }
      if (await this.git(cwd, ['status', '--porcelain', '--untracked-files=all'])) {
        await this.git(cwd, ['add', '--all']);
        await this.git(cwd, ['commit', '-m', `feat: ${task.title.replace(/[\r\n]+/g, ' ')}`]);
        if (await this.git(cwd, ['rev-parse', 'HEAD']) === head) throw new Error('Task commit could not be verified');
        if (await this.git(cwd, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Repository still has uncommitted changes after committing');
      }
    } finally {
      this.activeSessions.delete(task.id);
      if (!this.closing) this.dependencies.sessions.scheduleCleanup(clientId);
    }
  }
}
