import { resolveAllowedExistingPath } from '../utils/path-security.js';
import type { ProjectTaskStore } from './project-task-store.js';
import type { ProjectTaskStarter } from './project-task-starter.js';
import type { PiSessionService } from './session-manager.js';

export type GatewayTaskIntent =
  | { action: 'create_task'; title: string; prompt: string }
  | { action: 'list_tasks' }
  | { action: 'start_task'; target: string }
  | { action: 'start_task'; index: number };

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
  sessions: Pick<PiSessionService, 'listAgentProfileModels' | 'getSession' | 'runForegroundWithClientProfileProxy' | 'runSessionExecution' | 'scheduleCleanup'>;
  resolvePath?: (path: string) => Promise<string>;
}

export class GatewayTaskCommands {
  private readonly shutdown = new AbortController();
  private readonly active = new Map<string, { abort(): Promise<void> }>();
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
    const tasks = store.list({ projectPath, status: 'waiting' });
    if (intent.action === 'list_tasks') {
      if (chatId) this.taskLists.set(chatId, { projectPath, taskIds: tasks.map((task) => task.id) });
      return { reply: tasks.length
        ? `当前项目未开始的任务：\n${tasks.map((task, index) => `任务 ${index + 1}：${task.title}`).join('\n')}\n\n请以指令前缀开头，使用任务编号或标题（可用无歧义的部分标题）指定要执行的任务。`
        : '当前项目没有未开始的任务。' };
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
          : '未匹配到当前项目的待办任务。请列出任务后，使用标题或编号指定。' };
    }
    const task = matches[0];
    const clientId = `gateway-task:${task.id}`;
    const started = await starter.start(task.id, clientId, this.shutdown.signal, projectPath);
    const session = sessions.getSession(clientId, started.sessionId);
    if (!session) {
      sessions.scheduleCleanup(clientId);
      return { reply: `任务已创建会话，但无法开始执行，请在 WebUI 检查。\n任务 ID: ${task.id}\n会话 ID: ${started.sessionId}` };
    }
    this.active.set(clientId, session);
    void Promise.resolve().then(() => sessions.runForegroundWithClientProfileProxy(clientId, () => {
      this.shutdown.signal.throwIfAborted();
      return sessions.runSessionExecution(session, () => session.prompt(started.prompt, { images: started.images }));
    }, this.shutdown.signal)).catch((error) => {
      console.error('[gateway-task] Execution interrupted; review task session', task.id, error);
    }).finally(() => {
      this.active.delete(clientId);
      sessions.scheduleCleanup(clientId);
    });
    return { reply: `已开始执行任务：${task.title}\n任务 ID: ${task.id}\n会话 ID: ${started.sessionId}\n可在 WebUI 查看执行结果；未开启自动执行队列。` };
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    this.taskLists.clear();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.active.values()].map(async (session) => session.abort())),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
