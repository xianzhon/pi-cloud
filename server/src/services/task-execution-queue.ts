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
  error: string;
}

interface Dependencies {
  db: PiCloudDatabase;
  tasks: ProjectTaskStore;
  starter: Pick<ProjectTaskStarter, 'start'>;
  sessions: Pick<PiSessionService, 'getSession' | 'runForegroundWithClientProfileProxy'>;
  git?: (cwd: string, args: string[]) => Promise<string>;
  resolvePath?: (path: string) => Promise<string>;
}

const execFileAsync = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024, timeout: 120_000 });
  return result.stdout.trim();
}

export class TaskExecutionQueue {
  private state: TaskExecutionQueueState;
  private running?: Promise<void>;
  private closing = false;
  private readonly git: NonNullable<Dependencies['git']>;
  private readonly resolvePath: NonNullable<Dependencies['resolvePath']>;

  constructor(private readonly dependencies: Dependencies) {
    this.git = dependencies.git || git;
    this.resolvePath = dependencies.resolvePath || resolveAllowedExistingPath;
    const row = dependencies.db.prepare('SELECT state_json FROM task_execution_queue WHERE id = 1').get() as { state_json: string } | undefined;
    this.state = row ? JSON.parse(row.state_json) : { enabled: false, taskIds: [], activeTaskId: null, error: '' };
    // Never replay a partially executed task after a server restart.
    if (this.state.enabled || this.state.activeTaskId) {
      this.state.enabled = false;
      this.state.activeTaskId = null;
      this.state.error = 'Server restarted. Review any started task and arrange the remaining queue before enabling it.';
      this.save();
    }
  }

  get(): TaskExecutionQueueState {
    return { ...this.state, taskIds: [...this.state.taskIds] };
  }

  configure(taskIds: unknown, enabled: unknown): TaskExecutionQueueState {
    if (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== 'string') || new Set(taskIds).size !== taskIds.length || typeof enabled !== 'boolean') {
      throw new ProjectTaskValidationError('Provide unique task IDs and an enabled boolean');
    }
    if (this.running && JSON.stringify(taskIds) !== JSON.stringify(this.state.taskIds)) {
      throw new ProjectTaskConflictError('Cannot rearrange the queue while a task is running');
    }
    for (const id of taskIds) {
      if (id === this.state.activeTaskId) continue;
      if (enabled && this.dependencies.tasks.get(id)?.status !== 'waiting') {
        throw new ProjectTaskValidationError('Only waiting tasks can be queued. Remove any failed or manually started task first.');
      }
    }
    if (enabled && !taskIds.length) throw new ProjectTaskValidationError('Select at least one task');
    this.state.taskIds = [...taskIds];
    this.state.enabled = enabled;
    this.state.error = '';
    this.save();
    const result = this.get();
    if (enabled && !this.running && !this.closing) {
      this.running = this.run().finally(() => { this.running = undefined; });
    }
    return result;
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.state.enabled = false;
    this.save();
    await this.running;
  }

  private save(): void {
    this.dependencies.db.prepare('INSERT INTO task_execution_queue (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json')
      .run(JSON.stringify(this.state));
  }

  private async run(): Promise<void> {
    while (this.state.enabled && !this.closing && this.state.taskIds.length) {
      const id = this.state.taskIds[0]!;
      this.state.activeTaskId = id;
      this.save();
      try {
        const task = this.dependencies.tasks.get(id);
        if (!task || task.status !== 'waiting') throw new Error('Queued task is no longer waiting');
        await this.execute(task);
        this.dependencies.tasks.complete(id);
        this.state.taskIds.shift();
      } catch (error) {
        this.state.enabled = false;
        this.state.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.state.activeTaskId = null;
        if (!this.state.taskIds.length) this.state.enabled = false;
        this.save();
      }
    }
  }

  private async execute(task: ProjectTaskRecord): Promise<void> {
    const projectPath = await this.resolvePath(task.projectPath);
    await this.resolvePath(await this.git(projectPath, ['rev-parse', '--show-toplevel']));
    if (await this.git(projectPath, ['status', '--porcelain', '--untracked-files=all'])) {
      throw new Error('Repository has uncommitted changes. Commit or stash them before running the queue.');
    }
    const clientId = `task-execution:${task.id}`;
    const started = await this.dependencies.starter.start(task.id, clientId);
    const session = this.dependencies.sessions.getSession(clientId, started.sessionId);
    if (!session) throw new Error('Task session is unavailable');
    const cwd = await this.resolvePath(started.worktree?.worktreePath || projectPath);
    await this.resolvePath(await this.git(cwd, ['rev-parse', '--show-toplevel']));
    if (await this.git(cwd, ['status', '--porcelain', '--untracked-files=all'])) {
      throw new Error('Task worktree has uncommitted changes. Review it before continuing.');
    }
    const head = await this.git(cwd, ['rev-parse', 'HEAD']);
    const branch = await this.git(cwd, ['symbolic-ref', 'HEAD']);
    const marker = `TASK_COMPLETE_${randomUUID()}`;
    await this.dependencies.sessions.runForegroundWithClientProfileProxy(clientId, () => session.prompt(
      `${started.prompt}\n\nAutomatic task execution rules:\nImplement the task and run appropriate verification. Do not commit, push, switch branches, or modify unrelated files. The server will commit your changes after success. If you need input or cannot finish successfully, explain the blocker and do NOT output the completion marker. Only when the entire task is successfully finished, put this exact marker on the last line of your final response: ${marker}`,
      { images: started.images },
    ));
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
  }
}
