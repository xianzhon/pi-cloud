import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { completeSimple, type AssistantMessage, type TextContent } from '@earendil-works/pi-ai/compat';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GiteaClient } from '../services/gitea-client';
import type { GitHostingService } from '../services/git-hosting';
import type { GiteaSettingsStore } from '../services/gitea-settings-store';
import type { GithubClient } from '../services/github-client';
import { githubProxyEnvFromUrl, type GithubSettingsStore } from '../services/github-settings-store';
import type { ProjectTaskStore } from '../services/project-task-store';
import type { SessionActivityStore } from '../services/session-activity-store';
import type { PiSessionService } from '../services/session-manager.js';

export interface GitHostingRouteOptions {
  settings: GiteaSettingsStore;
  githubSettings: GithubSettingsStore;
  tasks: ProjectTaskStore;
  git: GitHostingService;
  createClient: (settings: { serverUrl: string; token: string }) => GiteaClient;
  createGithubClient: (settings: { serverUrl: string; token: string; proxyUrl?: string }) => GithubClient;
  activityStore?: Pick<SessionActivityStore, 'recordPr'>;
}

const execFileAsync = promisify(execFile);
const maxDiffBuffer = 10 * 1024 * 1024;
const githubProxyCheckArgs = ['-fsSL', '--connect-timeout', '5', '--max-time', '10', 'https://www.google.com/generate_204'];
const githubProxyCountryArgs = ['-fsSL', '--connect-timeout', '5', '--max-time', '10', 'https://ipinfo.io/country'];
const proxyEnvKeys = ['ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy'];

function textFromAssistantMessage(message: AssistantMessage) {
  return message.content
    .filter((item): item is TextContent => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: maxDiffBuffer });
  return stdout;
}

async function checkGithubProxy(proxyUrl: string): Promise<{ ok: boolean; country?: string }> {
  const value = proxyUrl.trim();
  const env = { ...process.env };
  for (const key of proxyEnvKeys) delete env[key];
  if (value) {
    new URL(value);
    Object.assign(env, githubProxyEnvFromUrl(value));
  }
  try {
    await execFileAsync('curl', githubProxyCheckArgs, { env, timeout: 12_000 });
  } catch {
    return { ok: false };
  }

  try {
    const output = await execFileAsync('curl', githubProxyCountryArgs, { env, timeout: 12_000 });
    const stdout = typeof output === 'string' ? output : output.stdout;
    const country = stdout.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? { ok: true, country } : { ok: true };
  } catch {
    return { ok: true };
  }
}

async function getPrDiff(cwd: string, targetBranch: string) {
  const [committed, unstaged, staged] = await Promise.all([
    runGit(cwd, ['diff', `${targetBranch}...HEAD`]).catch(() => ''),
    runGit(cwd, ['diff']).catch(() => ''),
    runGit(cwd, ['diff', '--cached']).catch(() => ''),
  ]);
  return [committed, unstaged, staged].map((part) => part.trim()).filter(Boolean).join('\n\n');
}

function issuePrompt(preview: any) {
  return `Polish this Git issue title and body.

Rules:
- Return only compact JSON: {"title":"...","body":"..."}
- Title: concise, specific, no markdown.
- Body: well-structured Markdown with useful sections when appropriate.
- Preserve factual details from the draft.
- Do not invent issue numbers, assignees, labels, or implementation details.

Repository: ${preview.owner || ''}/${preview.repo || ''}
Draft title: ${preview.title || ''}
Draft body:
${preview.body || ''}`;
}

function prPrompt(preview: any, diff: string) {
  const files = Array.isArray(preview.files)
    ? preview.files.map((file: any) => `- ${file.status || ''} ${file.path || ''}`).join('\n')
    : '';
  return `Generate a clear pull request title and body for this change.

Rules:
- Return only compact JSON: {"title":"...","body":"..."}
- Title: concise, imperative, no markdown.
- Body: useful Markdown with a summary and test notes if inferable.
- Do not invent issue numbers or reviewers.

Repository: ${preview.owner || ''}/${preview.repo || ''}
Source branch: ${preview.sourceBranch || ''}
Target branch: ${preview.targetBranch || ''}
Current commit message: ${preview.commitMessage || ''}
Current PR body:
${preview.body || ''}

Files:
${files || '(none)'}

Diff:
${diff || '(not available)'}`;
}

function parseGeneratedContent(text: string, type: 'issue' | 'PR') {
  const jsonText = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(jsonText) as { title?: unknown; body?: unknown };
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  if (!title || !body) throw new Error(`AI did not return both a ${type} title and body`);
  return { title, body };
}

function getConnectedIssueNumber(tasks: ProjectTaskStore, sessionId?: string) {
  if (!sessionId) return null;
  return tasks.list().find((task) => task.sessionId === sessionId && task.giteaIssue)?.giteaIssue?.number ?? null;
}

function appendClosingIssue(body: string, issueNumber: number | null) {
  const trimmedBody = body.trim();
  if (!issueNumber) return trimmedBody;
  const closeLine = `Close #${issueNumber}`;
  if (new RegExp(`(?:^|\\n)${closeLine}\\s*$`).test(trimmedBody)) return trimmedBody;
  return trimmedBody ? `${trimmedBody}\n\n${closeLine}` : closeLine;
}

function prGenerationSessionId(preview: any) {
  const key = `${preview.cwd || ''}:${preview.sourceBranch || ''}:${preview.targetBranch || ''}`;
  return `pr-content:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

function recordPrActivity(options: GitHostingRouteOptions, input: Parameters<SessionActivityStore['recordPr']>[0]) {
  try {
    options.activityStore?.recordPr(input);
  } catch (error) {
    console.warn('Failed to record session PR activity:', error);
  }
}

function settingsResponse(options: GitHostingRouteOptions) {
  return { settings: options.settings.getSanitized(), githubSettings: options.githubSettings.getSanitized() };
}

function gitServerUrls(options: GitHostingRouteOptions) {
  return { serverUrl: options.settings.get().serverUrl, githubServerUrl: options.githubSettings.get().serverUrl };
}

function clientForProvider(options: GitHostingRouteOptions, provider?: string) {
  return provider === 'github'
    ? options.createGithubClient(options.githubSettings.get())
    : options.createClient(options.settings.get());
}

async function generateContentWithAi(sessionService: PiSessionService, input: {
  clientId: string;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  sessionId: string;
  generationLabel: string;
}) {
  const agentDir = await sessionService.getClientAgentDirForRoutes(input.clientId);
  return sessionService.runForegroundWithClientProfileProxy(input.clientId, async () => {
    const profile = await sessionService.getClientAgentProfile(input.clientId);
    const registry = new ModelRegistry(await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    }));
    await registry.refresh();
    const configuredModel = profile.automationProvider && profile.automationModel
      ? registry.find(profile.automationProvider, profile.automationModel)
      : undefined;
    const model = configuredModel || registry.getAvailable()[0];
    if (!model) throw new Error(`No available AI model configured for ${input.generationLabel} generation`);
    console.info('[ai-automation] request', {
      operation: `git-hosting-${input.generationLabel}`,
      clientId: input.clientId,
      profileId: profile.id,
      provider: model.provider,
      modelId: model.id,
      modelSource: configuredModel ? 'profile-automation' : 'first-available',
      sessionId: input.sessionId,
    });

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error);

    const response = await completeSimple(model, {
      systemPrompt: input.systemPrompt,
      messages: [{ role: 'user', content: input.prompt, timestamp: Date.now() }],
      tools: [],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: input.maxTokens,
      sessionId: input.sessionId,
    });

    if (response.stopReason === 'error') throw new Error(response.errorMessage || `AI ${input.generationLabel} generation failed`);
    return textFromAssistantMessage(response);
  });
}

async function generateIssueContentWithAi(sessionService: PiSessionService, clientId: string, preview: any) {
  const key = `${preview.owner || ''}/${preview.repo || ''}:${preview.title || ''}:${preview.body || ''}`;
  const text = await generateContentWithAi(sessionService, {
    clientId,
    prompt: issuePrompt(preview),
    systemPrompt: 'You polish Git issue titles and Markdown descriptions while preserving the user provided facts.',
    maxTokens: 1000,
    sessionId: `issue-content:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
    generationLabel: 'issue content',
  });
  return parseGeneratedContent(text, 'issue');
}

async function generatePrContentWithAi(sessionService: PiSessionService, clientId: string, preview: any) {
  const diff = await getPrDiff(preview.cwd || '.', preview.targetBranch || 'main');
  const text = await generateContentWithAi(sessionService, {
    clientId,
    prompt: prPrompt(preview, diff),
    systemPrompt: 'You write accurate, concise pull request titles and Markdown descriptions from git changes.',
    maxTokens: 1200,
    sessionId: prGenerationSessionId(preview),
    generationLabel: 'PR content',
  });
  return parseGeneratedContent(text, 'PR');
}

export async function gitHostingRoutes(app: FastifyInstance, options: GitHostingRouteOptions) {
  app.get('/settings', async () => settingsResponse(options));

  app.post('/settings', async (req, reply) => {
    const body = req.body as { serverUrl?: string; token?: string };
    try {
      const current = options.settings.get();
      options.settings.save({ serverUrl: body.serverUrl ?? current.serverUrl, token: body.token || current.token });
      return settingsResponse(options);
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.delete('/settings', async () => {
    options.settings.clear();
    return settingsResponse(options);
  });

  app.post('/github/settings', async (req, reply) => {
    const body = req.body as { serverUrl?: string; token?: string };
    try {
      const current = options.githubSettings.get();
      options.githubSettings.save({ serverUrl: body.serverUrl ?? current.serverUrl, token: body.token || current.token });
      return settingsResponse(options);
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.delete('/github/settings', async () => {
    options.githubSettings.clear();
    return settingsResponse(options);
  });

  app.post('/github/proxy', async (req, reply) => {
    const body = req.body as { proxyUrl?: string };
    try {
      options.githubSettings.saveProxyUrl(body.proxyUrl || '');
      return settingsResponse(options);
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/github/proxy/test', async (req, reply) => {
    const body = req.body as { proxyUrl?: string };
    try {
      return await checkGithubProxy(body.proxyUrl ?? options.githubSettings.get().proxyUrl ?? '');
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/github/test', async (req, reply) => {
    const body = req.body as { serverUrl?: string; token?: string };
    try {
      const current = options.githubSettings.get();
      await options.createGithubClient({ ...current, serverUrl: body.serverUrl ?? current.serverUrl, token: body.token || current.token }).testConnection();
      return { success: true };
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/test', async (req, reply) => {
    const body = req.body as { serverUrl?: string; token?: string };
    try {
      const current = options.settings.get();
      await options.createClient({ serverUrl: body.serverUrl ?? current.serverUrl, token: body.token || current.token }).testConnection();
      return { success: true };
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/tasks/:id/issue/preview', async (req, reply) => {
    try {
      const task = options.tasks.get((req.params as { id: string }).id);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      const preview = await options.git.previewIssue({ ...gitServerUrls(options), cwd: task.projectPath, title: task.title, prompt: task.prompt, notes: task.notes });
      return { preview };
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/tasks/:id/issue/generate', async (req, reply) => {
    try {
      const body = req.body as { clientId?: string; preview?: any };
      if (!body.clientId) return reply.status(400).send({ error: 'clientId is required to generate issue content with AI' });
      if (!body.preview) return reply.status(400).send({ error: 'Issue preview is required' });
      return { content: await generateIssueContentWithAi(app.services.sessions, body.clientId, body.preview) };
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/tasks/:id/issue', async (req, reply) => {
    try {
      const id = (req.params as { id: string }).id;
      const task = options.tasks.get(id);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (task.giteaIssue) return reply.status(409).send({ error: 'Task already has an issue' });
      const body = req.body as { provider?: string; owner: string; repo: string; title: string; body: string };
      const issue = await clientForProvider(options, body.provider).createIssue(body);
      return { task: options.tasks.attachGiteaIssue(id, { owner: body.owner, repo: body.repo, number: issue.number, url: issue.url }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/pr/preview', async (req, reply) => {
    try {
      const body = req.body as { cwd?: string; targetBranch?: string };
      return { preview: await options.git.previewPr({ ...gitServerUrls(options), cwd: body.cwd || '.', targetBranch: body.targetBranch || 'main' }) };
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/pr/generate', async (req, reply) => {
    try {
      const body = req.body as { clientId?: string; sessionId?: string; preview?: any };
      if (!body.clientId) return reply.status(400).send({ error: 'clientId is required to generate PR content with AI' });
      if (!body.preview) return reply.status(400).send({ error: 'PR preview is required' });
      const content = await generatePrContentWithAi(app.services.sessions, body.clientId, body.preview);
      return { content: { ...content, body: appendClosingIssue(content.body, getConnectedIssueNumber(options.tasks, body.sessionId)) } };
    } catch (error) {
      return sendError(reply, error, 400);
    }
  });

  app.post('/pr/create', async (req, reply) => {
    try {
      const body = req.body as { preview: any; title: string; body: string; commitMessage: string; sessionId?: string };
      const prBody = appendClosingIssue(body.body, getConnectedIssueNumber(options.tasks, body.sessionId));
      const result = await options.git.createPr({
        ...gitServerUrls(options),
        preview: body.preview,
        title: body.title,
        body: prBody,
        commitMessage: body.commitMessage,
        client: clientForProvider(options, body.preview?.provider),
      });
      const commit = await runGit(body.preview.cwd, ['rev-parse', 'HEAD']).then((output) => output.trim()).catch(() => null);
      recordPrActivity(options, {
        sessionId: body.sessionId,
        provider: body.preview.provider,
        cwd: body.preview.cwd,
        owner: body.preview.owner,
        repo: body.preview.repo,
        number: result.number,
        url: result.url,
        title: body.title || body.preview.title,
        sourceBranch: body.preview.sourceBranch,
        targetBranch: body.preview.targetBranch,
        commit,
      });
      return { pullRequest: result };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

function sendError(reply: FastifyReply, error: unknown, status = 500) {
  const maybeStatus = (error as { statusCode?: unknown })?.statusCode;
  const errorStatus = typeof maybeStatus === 'number' ? maybeStatus : status;
  return reply.status(errorStatus).send({ error: error instanceof Error ? error.message : 'Git integration request failed' });
}
