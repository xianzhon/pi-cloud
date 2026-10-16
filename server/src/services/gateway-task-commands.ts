import { resolveAllowedExistingPath } from '../utils/path-security.js';
import type { ProjectTaskRecord, ProjectTaskStore } from './project-task-store.js';
import { requestGatewayAbort } from './gateway-message-queue.js';
import type { ProjectTaskStarter } from './project-task-starter.js';
import type { PiSessionService } from './session-manager.js';

export type GatewayTaskIntent =
  | { action: 'create_task'; title: string; prompt: string }
  | { action: 'list_tasks'; all?: boolean }
  | ({ action: 'start_task' | 'task_status' | 'task_result' | 'stop_task' } & ({ target: string } | { index: number }));

interface TaskListSnapshot {
  projectPath: string;
  taskIds: string[];
}

interface TaskConfig {
  defaultCwd?: string;
  cwdChoices: string[];
  agentProfile?: string;
}
interface Dependencies {
  store: ProjectTaskStore;
  starter: Pick<ProjectTaskStarter, 'start'>;
  sessions: Pick<PiSessionService, 'listAgentProfileModels' | 'getSession' | 'runForegroundWithClientProfileProxy' | 'runSessionExecution' | 'scheduleCleanup' | 'setClientAgentProfile' | 'findPersistedSession' | 'readSessionSnapshot'>;
  resolvePath?: (path: string) => Promise<string>;
}

export class GatewayTaskCommands {
  private readonly shutdown = new AbortController();
  private readonly active = new Map<string, { session: { abort(): Promise<void> }; sessionId: string; stopping: boolean }>();
  private readonly taskLists = new Map<string, TaskListSnapshot>();

  constructor(private readonly dependencies: Dependencies) {}

  async execute(intent: GatewayTaskIntent, config: TaskConfig, chatId?: string): Promise<{ reply: string }> {
    this.shutdown.signal.throwIfAborted();
    if (!config.defaultCwd || !config.cwdChoices.includes(config.defaultCwd)) {
      throw new Error('Gateway project is not configured or allowed');
    }
    const resolvePath = this.dependencies.resolvePath || resolveAllowedExistingPath;
    const projectPath = await resolvePath(config.defaultCwd);
    const { store, sessions, starter } = this.dependencies;
    if (intent.action === 'create_task') {
      const profileId = config.agentProfile || 'default';
      const models = await sessions.listAgentProfileModels(profileId, this.shutdown.signal);
      const model = models.find((item) => item.current) || models[0];
      if (!model) return { reply: '无法创建任务：当前配置没有可用模型。' };
      this.shutdown.signal.throwIfAborted();
      const task = store.create({
        projectPath, title: intent.title, prompt: intent.prompt, notes: '',
        agentProfileId: profileId, modelProvider: model.provider, modelId: model.id,
        skillMode: 'all', skills: [], presetId: null, worktree: { mode: 'none' },
      });
      return { reply: `已保存待办任务，尚未执行：${task.title}\nID: ${task.id}` };
    }
    const onlyWaiting = intent.action === 'start_task' || (intent.action === 'list_tasks' && !intent.all);
    const tasks = store.list({ projectPath, ...(onlyWaiting ? { status: 'waiting' as const } : {}) });
    if (intent.action === 'list_tasks') {
      if (chatId) this.taskLists.set(chatId, { projectPath, taskIds: tasks.map((task) => task.id) });
      return { reply: tasks.length
        ? `${onlyWaiting ? '当前项目未开始的任务' : '当前项目任务'}：\n${tasks.map((task, index) => `任务 ${index + 1}：${task.title}${intent.all ? ` [${task.status}; ${this.executionStatus(task)}]` : ''}`).join('\n')}\n\n请以指令前缀开头，使用任务编号或标题（可用无歧义的部分标题）指定要执行的任务。也可使用 /task status|result|stop <编号或标题>。`
        : onlyWaiting ? '当前项目没有未开始的任务。' : '当前项目没有任务。' };
    }
    const snapshot = chatId ? this.taskLists.get(chatId) : undefined;
    const target = 'target' in intent ? intent.target.trim() : '';
    const matches = 'index' in intent
      ? tasks.filter((task) => snapshot?.projectPath === projectPath && task.id === snapshot.taskIds[intent.index - 1])
      : tasks.filter((task) => target && task.title.includes(target));
    if (matches.length !== 1) {
      return { reply: 'index' in intent
        ? '该编号没有对应的待办任务，请重新列出任务后再按编号执行。'
        : matches.length
          ? '匹配到多个任务，未执行。请提供更完整的标题，或列出任务后使用编号选择。'
          : '未匹配到当前项目的任务。请列出任务后，使用标题或编号指定。' };
    }
    const task = matches[0];
    const clientId = `gateway-task:${task.id}`;
    if (intent.action === 'task_status') {
      return { reply: `任务：${task.title}\n任务状态: ${task.status}\n执行状态: ${this.executionStatus(task)}\n会话 ID: ${task.sessionId || '(尚未创建)'}\nstarted 仅表示已启动，不代表执行成功或仍在运行；请查看结果或 WebUI。` };
    }
    if (intent.action === 'task_result') return { reply: await this.taskResult(task) };
    if (intent.action === 'stop_task') {
      const active = this.active.get(clientId);
      if (!active || active.sessionId !== task.sessionId) {
        return { reply: '该任务没有可停止的网关执行。若由 WebUI 或自动队列运行，请到对应入口停止；任务状态未变更。' };
      }
      if (!active.stopping) {
        active.stopping = true;
        try {
          await requestGatewayAbort(active.session);
        } catch (error) {
          active.stopping = false;
          throw error;
        }
      }
      return { reply: `已请求停止任务：${task.title}\n保留任务和会话记录，不标记为已完成。请通过 /task status 或 WebUI 检查。` };
    }
    const started = await starter.start(task.id, clientId, this.shutdown.signal, projectPath);
    const session = sessions.getSession(clientId, started.sessionId);
    if (!session) {
      sessions.scheduleCleanup(clientId);
      return { reply: `任务已创建会话，但无法开始执行，请在 WebUI 检查。\n任务 ID: ${task.id}\n会话 ID: ${started.sessionId}` };
    }
    const execution = { session, sessionId: started.sessionId, stopping: false };
    this.active.set(clientId, execution);
    void Promise.resolve().then(() => sessions.runForegroundWithClientProfileProxy(clientId, async () => {
      this.shutdown.signal.throwIfAborted();
      if (execution.stopping) return;
      await sessions.runSessionExecution(session, async () => {
        if (!execution.stopping) await session.prompt(started.prompt, { images: started.images });
      });
    }, this.shutdown.signal)).catch((error) => {
      console.error('[gateway-task] Execution interrupted; review task session', task.id, error);
    }).finally(() => {
      this.active.delete(clientId);
      sessions.scheduleCleanup(clientId);
    });
    return { reply: `已开始执行任务：${task.title}\n任务 ID: ${task.id}\n会话 ID: ${started.sessionId}\n可在 WebUI 查看执行结果；未开启自动执行队列。` };
  }

  private executionStatus(task: ProjectTaskRecord): string {
    const active = this.active.get(`gateway-task:${task.id}`);
    if (active && active.sessionId === task.sessionId) return active.stopping ? 'stopping' : 'running';
    if (task.sessionId && this.dependencies.sessions.getSession(`gateway-task:${task.id}`, task.sessionId)?.isStreaming) return 'running (external)';
    return 'not running here (不代表成功完成)';
  }

  private async taskResult(task: ProjectTaskRecord): Promise<string> {
    if (!task.sessionId) return `任务尚未创建会话：${task.title}`;
    const { sessions } = this.dependencies;
    const clientId = `gateway-task-read:${task.id}`;
    const active = sessions.getSession(clientId, task.sessionId);
    let messages = active?.messages;
    if (!messages) {
      try {
        await sessions.setClientAgentProfile(clientId, task.agentProfileId, this.shutdown.signal);
        const persisted = await sessions.findPersistedSession(clientId, task.sessionId);
        if (!persisted) return '未找到任务会话记录，请在 WebUI 检查。';
        messages = (await sessions.readSessionSnapshot(clientId, persisted.path)).messages;
      } finally {
        sessions.scheduleCleanup(clientId);
      }
    }
    const text = [...messages].reverse().flatMap((message) => {
      if (message.role !== 'assistant') return [];
      const value = message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('').trim();
      return value ? [value] : [];
    })[0];
    if (!text) return `任务尚无文本结果：${task.title}\n执行状态: ${this.executionStatus(task)}`;
    return `任务：${task.title}\n执行状态: ${this.executionStatus(task)}\n最新助手回复（不保证任务已完成）：\n${text.slice(0, 3500)}${text.length > 3500 ? '\n…内容已截断，完整结果请查看 WebUI。' : ''}\n会话 ID: ${task.sessionId}`;
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    this.taskLists.clear();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.active.values()].map(async ({ session }) => session.abort())),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
