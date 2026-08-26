import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { completeSimple, type AssistantMessage, type TextContent } from '@earendil-works/pi-ai/compat';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ProjectTaskStarter } from '../services/project-task-starter';
import {
  ProjectTaskConflictError,
  ProjectTaskNotFoundError,
  ProjectTaskValidationError,
  isProjectTaskSkillMode,
  isProjectTaskStatus,
  normalizeWorktree,
  type ProjectTaskDraft,
  type ProjectTaskStatus,
  type ProjectTaskStore,
} from '../services/project-task-store';
import type { PiSessionService } from '../services/session-manager.js';
import type { SessionActivityRecord, SessionActivityStore } from '../services/session-activity-store.js';

export interface TaskRouteOptions {
  store: ProjectTaskStore;
  starter: ProjectTaskStarter;
  activityStore?: Pick<SessionActivityStore, 'listLatestPrForSessions'>;
}

function pullRequestFromActivity(activity?: SessionActivityRecord): { number: number; url: string; status: 'ready' | 'merged' } | undefined {
  const data = activity?.data;
  if (!data || typeof data.number !== 'number' || typeof data.url !== 'string') return undefined;
  return {
    number: data.number,
    url: data.url,
    status: data.status === 'merged' || data.merged === true ? 'merged' : 'ready',
  };
}

export async function taskRoutes(app: FastifyInstance, options: TaskRouteOptions) {
  app.get('/', async (req, reply) => {
    const query = req.query as { scope?: string; projectPath?: string; status?: string };
    const scope = query.scope || 'all';
    if (scope !== 'all' && scope !== 'project') {
      return reply.status(400).send({ error: 'scope must be project or all' });
    }
    if (scope === 'project' && !query.projectPath) {
      return reply.status(400).send({ error: 'projectPath is required for project scope' });
    }
    if (query.status && !isProjectTaskStatus(query.status)) {
      return reply.status(400).send({ error: 'Invalid task status' });
    }
    const tasks = options.store.list({
      projectPath: scope === 'project' ? query.projectPath : undefined,
      status: query.status as ProjectTaskStatus | undefined,
    });
    const latestPrs = options.activityStore?.listLatestPrForSessions(tasks.flatMap((task) => task.sessionId ? [task.sessionId] : []));
    return {
      tasks: tasks.map((task) => ({
        ...task,
        pullRequest: pullRequestFromActivity(task.sessionId ? latestPrs?.get(task.sessionId) : undefined),
      })),
    };
  });

  app.post('/', async (req, reply) => {
    try {
      return { task: options.store.create(parseTaskDraft(req.body)) };
    } catch (error) {
      return sendTaskError(reply, error, 400);
    }
  });

  app.post('/polish', async (req, reply) => {
    const body = req.body as { clientId?: string; title?: string; prompt?: string } | undefined;
    if (!body?.clientId) return reply.status(400).send({ error: 'clientId is required to polish task content with AI' });
    if (!body.prompt?.trim()) return reply.status(400).send({ error: 'prompt is required to polish task content with AI' });
    try {
      return { content: await polishTaskContentWithAi(app.services.sessions, body.clientId, body.title || '', body.prompt) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to polish task content with AI' });
    }
  });

  app.get('/:id', async (req, reply) => {
    const task = options.store.get((req.params as { id: string }).id);
    return task ? { task } : reply.status(404).send({ error: 'Task not found' });
  });

  app.put('/:id', async (req, reply) => {
    try {
      return { task: options.store.update((req.params as { id: string }).id, parseTaskDraft(req.body)) };
    } catch (error) {
      return sendTaskError(reply, error, 400);
    }
  });

  app.delete('/:id', async (req, reply) => {
    try {
      options.store.delete((req.params as { id: string }).id);
      return { success: true };
    } catch (error) {
      return sendTaskError(reply, error);
    }
  });

  app.post('/:id/start', async (req, reply) => {
    const clientId = (req.body as { clientId?: string } | undefined)?.clientId;
    if (!clientId) return reply.status(400).send({ error: 'clientId is required' });
    try {
      return await options.starter.start((req.params as { id: string }).id, clientId);
    } catch (error) {
      return sendTaskError(reply, error);
    }
  });

  app.post('/:id/complete', async (req, reply) => {
    try {
      return { task: options.store.complete((req.params as { id: string }).id) };
    } catch (error) {
      return sendTaskError(reply, error);
    }
  });
}

function textFromAssistantMessage(message: AssistantMessage): string {
  return message.content
    .filter((item): item is TextContent => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function taskPolishPrompt(title: string, prompt: string): string {
  return `Polish this project task so it is ready for an AI coding agent to execute.

Rules:
- Return only compact JSON: {"title":"...","prompt":"..."}
- Title: concise, specific, no markdown.
- Prompt: clear executable instructions with useful context, constraints, and acceptance criteria when inferable.
- Preserve factual details from the user's raw idea.
- Do not invent file names, APIs, deadlines, or requirements not supported by the draft.

Current title: ${title || '(empty)'}
Raw prompt:
${prompt}`;
}

function parsePolishedTaskContent(text: string): { title: string; prompt: string } {
  const jsonText = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(jsonText) as { title?: unknown; prompt?: unknown };
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  if (!title || !prompt) throw new Error('AI did not return both a task title and prompt');
  return { title, prompt };
}

async function polishTaskContentWithAi(
  sessionService: PiSessionService,
  clientId: string,
  title: string,
  prompt: string,
): Promise<{ title: string; prompt: string }> {
  const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
  return sessionService.runForegroundWithClientProfileProxy(clientId, async () => {
    const profile = await sessionService.getClientAgentProfile(clientId);
    const registry = new ModelRegistry(await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    }));
    await registry.refresh();
    const configuredModel = profile.automationProvider && profile.automationModel
      ? registry.find(profile.automationProvider, profile.automationModel)
      : undefined;
    const model = configuredModel || registry.getAvailable()[0];
    if (!model) throw new Error('No available AI model configured for task polish');
    console.info('[ai-automation] request', {
      operation: 'task-polish',
      clientId,
      profileId: profile.id,
      provider: model.provider,
      modelId: model.id,
      modelSource: configuredModel ? 'profile-automation' : 'first-available',
    });

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error);

    const response = await completeSimple(model, {
      systemPrompt: 'You turn rough project task ideas into clear, actionable prompts for AI coding agents.',
      messages: [{ role: 'user', content: taskPolishPrompt(title, prompt), timestamp: Date.now() }],
      tools: [],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: 1200,
      sessionId: `task-polish:${createHash('sha256').update(`${title}:${prompt}`).digest('hex').slice(0, 32)}`,
    });

    if (response.stopReason === 'error') throw new Error(response.errorMessage || 'AI task polish failed');
    return parsePolishedTaskContent(textFromAssistantMessage(response));
  });
}

function parseTaskDraft(value: unknown): ProjectTaskDraft {
  if (!value || typeof value !== 'object') throw new ProjectTaskValidationError('Task payload is required');
  const body = value as Record<string, unknown>;
  const skills = body.skills;
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== 'string')) {
    throw new ProjectTaskValidationError('Skills must be an array of names');
  }
  if (!isProjectTaskSkillMode(body.skillMode)) throw new ProjectTaskValidationError('Invalid skill mode');
  return {
    projectPath: requiredString(body.projectPath, 'projectPath'),
    title: requiredString(body.title, 'title'),
    prompt: requiredString(body.prompt, 'prompt'),
    notes: typeof body.notes === 'string' ? body.notes : '',
    agentProfileId: requiredString(body.agentProfileId, 'agentProfileId'),
    modelProvider: requiredString(body.modelProvider, 'modelProvider'),
    modelId: requiredString(body.modelId, 'modelId'),
    skillMode: body.skillMode,
    skills,
    ...(body.presetId === undefined ? {} : { presetId: optionalString(body.presetId, 'presetId') }),
    worktree: normalizeWorktree(body.worktree),
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProjectTaskValidationError(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ProjectTaskValidationError(`${field} must be a string`);
  return value.trim() || null;
}

function sendTaskError(reply: FastifyReply, error: unknown, validationStatus = 409) {
  const message = error instanceof Error ? error.message : 'Task request failed';
  if (error instanceof ProjectTaskNotFoundError) return reply.status(404).send({ error: message });
  if (error instanceof ProjectTaskConflictError) return reply.status(409).send({ error: message });
  if (error instanceof ProjectTaskValidationError) return reply.status(validationStatus).send({ error: message });
  return reply.status(500).send({ error: message });
}
