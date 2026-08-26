// server/src/routes/sessions.ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as os from 'os';
import { dirname } from 'path';
import { projectMover } from '../services/project-mover.js';
import { sessionFileRelocator } from '../services/session-file-relocator.js';
import type { PiSessionService } from '../services/session-manager.js';
import type { WorktreeMetadataStore } from '../services/worktree-metadata-store.js';
import { expandHomePath } from '../utils/paths.js';
import type { ProjectTaskStore } from '../services/project-task-store.js';
import type { RepositoryCloner } from '../services/repository-cloner.js';
import type { PullRequestStatus, SessionActivityRecord, SessionActivityStore } from '../services/session-activity-store.js';
import type { SessionPinStore } from '../services/session-pin-store.js';
import type {
  AgentProfileQuery,
  AgentProfileSelectionRequest,
  CreateSessionRequest,
  MoveProjectRequest,
  RelocateProjectSessionsRequest,
  ResumeSessionRequest,
  SessionOptions,
} from '../types.js';

function extractSnippet(text: string, query: string, contextChars: number = 100): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return text.slice(0, contextChars * 2) + (text.length > contextChars * 2 ? '...' : '');
  }

  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(text.length, matchIndex + query.length + contextChars);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = `${snippet}...`;

  return snippet;
}

function withWorktree<T extends { id?: string; sessionId?: string }>(
  session: T,
  worktreeMetadata: WorktreeMetadataStore,
): T & { worktree?: unknown } {
  const id = session.id || session.sessionId;
  if (!id) return session;
  const worktree = worktreeMetadata.get(id);
  return worktree ? { ...session, worktree } : session;
}

function belongsToProject(session: { cwd?: string; worktree?: any }, projectPath?: string): boolean {
  if (!projectPath) return true;
  if (session.cwd === projectPath) return true;
  return session.worktree?.worktreeManaged === true && session.worktree.baseRepoPath === projectPath;
}

function toSessionListItem<T extends { allMessagesText?: string }>(session: T): Omit<T, 'allMessagesText'> {
  const { allMessagesText: _allMessagesText, ...listItem } = session;
  return listItem;
}

function sortSessionsByModified<T extends { modified?: string; created?: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const aTime = new Date(a.modified || a.created || '').getTime() || 0;
    const bTime = new Date(b.modified || b.created || '').getTime() || 0;
    return bTime - aTime;
  });
}

async function listSessionsForRoute(
  sessionService: PiSessionService,
  worktreeMetadata: WorktreeMetadataStore,
  clientId: string,
  scope?: 'project' | 'all',
  projectPath?: string,
) {
  if (scope === 'all' || !projectPath) return sessionService.listSessions(clientId, undefined);

  const baseSessions = await sessionService.listSessions(clientId, projectPath);
  let worktreeSessions: Awaited<ReturnType<typeof sessionService.listSessions>> = [];
  try {
    const worktreePaths = Array.from(new Set(
      worktreeMetadata
        .listByBaseRepoPath(projectPath)
        .map((worktree) => worktree.worktreePath)
        .filter((path): path is string => Boolean(path && path !== projectPath)),
    ));
    // Managed worktrees are normally a small per-project set; keep these reads scoped
    // instead of falling back to an all-project session scan.
    worktreeSessions = (await Promise.all(
      worktreePaths.map((worktreePath) => sessionService.listSessions(clientId, worktreePath)),
    )).flat();
  } catch {
    // Worktree metadata is optional in tests and during early startup.
  }

  const byId = new Map([...baseSessions, ...worktreeSessions].map((session) => [session.id, session]));
  return sortSessionsByModified(Array.from(byId.values()));
}

async function resolveMemoryProject(app: FastifyInstance, clientId: string, cwd: string) {
  const profile = await app.services.sessions.getClientAgentProfile(clientId);
  return (await app.memoryRuntime.service.resolveContext({ profileId: profile.id, cwd })).project;
}

interface SearchResult {
  id: string;
  name?: string;
  path: string;
  cwd?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage?: string;
  snippet: string;
  matchCount: number;
}

const MAX_SESSION_TREE_NODES = 1_000;

function sessionTreeExceedsLimit(tree: unknown): boolean {
  const pending = Array.isArray(tree) ? [...tree] : [];
  let count = 0;
  while (pending.length) {
    const node = pending.pop() as { children?: unknown } | undefined;
    if (++count > MAX_SESSION_TREE_NODES) return true;
    const children = node?.children;
    if (Array.isArray(children)) pending.push(...children);
  }
  return false;
}

function sessionTreeContentPreview(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 500);
  if (!Array.isArray(content)) return content == null ? '' : String(content).slice(0, 500);

  let preview = '';
  for (const item of content) {
    const text = typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : '';
    preview += `${preview ? ' ' : ''}${text.slice(0, 500 - preview.length)}`;
    if (preview.length >= 500) break;
  }
  return preview;
}

function sanitizeSessionTreeEntry(entry: any): any {
  if (!entry) return entry;
  const sanitized = {
    ...entry,
    summary: typeof entry.summary === 'string' ? entry.summary.slice(0, 500) : entry.summary,
  };
  if (entry.message) {
    sanitized.message = { ...entry.message, content: sessionTreeContentPreview(entry.message.content) };
  }
  return sanitized;
}

function sanitizeSessionTree(tree: any[]): any[] {
  return tree.map((node) => ({
    ...node,
    entry: sanitizeSessionTreeEntry(node.entry),
    children: Array.isArray(node.children) ? sanitizeSessionTree(node.children) : [],
  }));
}

interface SessionRouteOptions {
  projectTaskStore?: Pick<ProjectTaskStore, 'listProjectPaths' | 'replaceProjectPath'>;
  pinStore?: Pick<SessionPinStore, 'listGroups' | 'createGroup' | 'pinSession' | 'unpinSession' | 'listSessionIdsByGroup'>;
  activityStore?: Pick<SessionActivityStore, 'listForSession'> & Partial<Pick<SessionActivityStore, 'listLatestPrForSessions' | 'updatePrStatus'>>;
  refreshPrStatus?: (activity: SessionActivityRecord) => Promise<PullRequestStatus>;
  repositoryCloner?: Pick<RepositoryCloner, 'preview' | 'start' | 'getJob' | 'subscribe' | 'cancel'>;
}

const PR_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

function prStatusCheckedAt(activity: SessionActivityRecord): number {
  const checkedAt = typeof activity.data.checkedAt === 'string' ? Date.parse(activity.data.checkedAt) : NaN;
  return Number.isFinite(checkedAt) ? checkedAt : 0;
}

async function refreshPrActivities(
  activities: Map<string, SessionActivityRecord>,
  options: SessionRouteOptions,
): Promise<Map<string, SessionActivityRecord>> {
  const refreshPrStatus = options.refreshPrStatus;
  const activityStore = options.activityStore;
  const updatePrStatus = activityStore?.updatePrStatus;
  if (!refreshPrStatus || !activityStore || !updatePrStatus) return activities;
  const now = Date.now();
  await Promise.all(Array.from(activities.entries()).map(async ([sessionId, activity]) => {
    if (activity.data.status === 'merged' || now - prStatusCheckedAt(activity) < PR_STATUS_CACHE_TTL_MS) return;
    try {
      const status = await refreshPrStatus(activity);
      const updated = updatePrStatus.call(activityStore, activity.id, status);
      if (updated) activities.set(sessionId, updated);
    } catch {
      // Keep the cached status when the provider is unavailable.
    }
  }));
  return activities;
}

interface PullRequestSummary {
  number: number;
  url: string;
  title: string;
  status: 'ready' | 'merged';
}

function pullRequestFromActivity(activity?: { data: Record<string, unknown> }): PullRequestSummary | undefined {
  const data = activity?.data;
  if (!data || typeof data.number !== 'number' || typeof data.url !== 'string') return undefined;
  return {
    number: data.number,
    url: data.url,
    title: typeof data.title === 'string' ? data.title : '',
    status: data.status === 'merged' || data.merged === true ? 'merged' as const : 'ready' as const,
  };
}

export async function sessionRoutes(app: FastifyInstance, options: SessionRouteOptions = {}) {
  const sessionService = app.services.sessions;
  const worktreeManager = app.services.worktrees;
  const worktreeMetadata = app.services.worktreeMetadata;
  function requireRepositoryCloner(reply: FastifyReply) {
    if (options.repositoryCloner) return options.repositoryCloner;
    reply.status(503).send({ error: 'Repository clone is not configured' });
    return null;
  }

  app.get('/agent-profiles', async () => {
    return { profiles: await sessionService.listAgentProfiles() };
  });

  app.post('/agent-profiles', async (req, reply) => {
    const { name, copySettingsFrom } = req.body as { name?: string; copySettingsFrom?: string };
    if (!name) return reply.status(400).send({ error: 'name is required' });
    try {
      return { profile: await sessionService.createAgentProfile(name.trim(), copySettingsFrom) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create profile' });
    }
  });

  app.delete('/agent-profiles/:profileId', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return await sessionService.deleteAgentProfile(profileId);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete profile' });
    }
  });

  app.get('/agent-profiles/:profileId/models', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { models: await sessionService.listAgentProfileModels(profileId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.get('/agent-profiles/:profileId/api-key-providers', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { providers: await sessionService.listAgentProfileApiKeyProviders(profileId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.get('/agent-profiles/:profileId/local-llm', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { config: await sessionService.getAgentProfileLocalLlm(profileId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.post('/agent-profiles/:profileId/local-llm/discover', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { baseUrl } = req.body as { baseUrl?: string };
      if (!baseUrl) return reply.status(400).send({ error: 'baseUrl is required' });
      return { models: await sessionService.discoverAgentProfileLocalLlm(profileId, baseUrl) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to discover local models' });
    }
  });

  app.put('/agent-profiles/:profileId/local-llm', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { baseUrl, modelIds } = req.body as { baseUrl?: string; modelIds?: string[] };
      if (!baseUrl || !Array.isArray(modelIds)) return reply.status(400).send({ error: 'baseUrl and modelIds are required' });
      return { config: await sessionService.saveAgentProfileLocalLlm(profileId, baseUrl, modelIds) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save local LLM' });
    }
  });

  app.delete('/agent-profiles/:profileId/local-llm', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { config: await sessionService.removeAgentProfileLocalLlm(profileId) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to remove local LLM' });
    }
  });

  app.put('/agent-profiles/:profileId/api-key', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { envVar, apiKey } = req.body as { envVar?: string; apiKey?: string };
      if (!envVar || !apiKey) return reply.status(400).send({ error: 'envVar and apiKey are required' });
      return { providers: await sessionService.saveAgentProfileApiKey(profileId, envVar, apiKey) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save API key' });
    }
  });

  app.delete('/agent-profiles/:profileId/api-key/:envVar', async (req, reply) => {
    try {
      const { profileId, envVar } = req.params as { profileId: string; envVar: string };
      return { providers: await sessionService.removeAgentProfileApiKey(profileId, envVar) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to remove API key' });
    }
  });

  app.get('/agent-profiles/:profileId/skills', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { projectPath } = req.query as { projectPath?: string };
      if (!projectPath) return reply.status(400).send({ error: 'projectPath is required' });
      return { skills: await sessionService.listAgentProfileSkills(profileId, projectPath) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.put('/agent-profiles/:profileId/default-model', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { provider, modelId } = req.body as { provider?: string; modelId?: string };
      if (!provider || !modelId) return reply.status(400).send({ error: 'provider and modelId are required' });
      return { profile: await sessionService.saveAgentProfileDefaultModel(profileId, provider, modelId) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save default model' });
    }
  });

  app.get('/agent-profiles/:profileId/automation-model', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { model: await sessionService.getAgentProfileAutomationModel(profileId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.put('/agent-profiles/:profileId/automation-model', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { provider, modelId } = req.body as { provider?: string; modelId?: string };
      if (!provider || !modelId) return reply.status(400).send({ error: 'provider and modelId are required' });
      return { model: await sessionService.saveAgentProfileAutomationModel(profileId, provider, modelId) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save automation model' });
    }
  });

  app.get('/agent-profiles/:profileId/proxy', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { proxy: await sessionService.getAgentProfileProxy(profileId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.put('/agent-profiles/:profileId/proxy', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { proxy } = req.body as { proxy?: Record<string, unknown> };
      await sessionService.saveAgentProfileProxy(profileId, proxy || {});
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save proxy settings' });
    }
  });

  app.post('/agent-profiles/:profileId/proxy/check', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { proxy } = req.body as { proxy?: Record<string, unknown> };
      return await sessionService.checkAgentProfileProxy(profileId, proxy);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to check proxy' });
    }
  });

  app.get('/agent-profiles/:profileId/auto-rename', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      return { config: await sessionService.getAgentProfileAutoRenameConfig(profileId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Profile not found' });
    }
  });

  app.put('/agent-profiles/:profileId/auto-rename', async (req, reply) => {
    try {
      const { profileId } = req.params as { profileId: string };
      const { language } = req.body as { language?: string };
      return { config: await sessionService.saveAgentProfileAutoRenameConfig(profileId, { language }) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save auto-rename settings' });
    }
  });

  app.get('/agent-profile', async (req) => {
    const { clientId } = req.query as Partial<AgentProfileQuery>;
    if (!clientId) {
      return { error: 'clientId is required' };
    }

    return { profile: await sessionService.getClientAgentProfile(clientId) };
  });

  app.post('/agent-profile', async (req, reply) => {
    const { clientId, profileId } = req.body as Partial<AgentProfileSelectionRequest>;
    if (!clientId || !profileId) {
      return reply.status(400).send({ error: 'clientId and profileId are required' });
    }

    try {
      return { profile: await sessionService.setClientAgentProfile(clientId, profileId) };
    } catch {
      return reply.status(400).send({ error: 'Unknown agent profile' });
    }
  });

  app.get('/project-path', async () => {
    return { projectPath: os.homedir() };
  });

  app.get('/search', async (req) => {
    const { clientId, q, scope, projectPath } = req.query as {
      clientId?: string;
      q?: string;
      scope?: 'project' | 'all';
      projectPath?: string;
    };

    if (!clientId) {
      return { error: 'clientId is required' };
    }

    if (!q || !q.trim()) {
      return { results: [], total: 0 };
    }

    const query = q.trim().toLowerCase();
    const sessions = await sessionService.listSessions(
      clientId,
      scope === 'all' ? undefined : projectPath,
    );

    const results: SearchResult[] = [];

    for (const session of sessions) {
      const searchableText = [
        session.name || '',
        session.firstMessage || '',
        session.allMessagesText || '',
      ].join(' ').toLowerCase();

      const matchCount = searchableText.split(query).length - 1;
      if (matchCount === 0) continue;

      const snippet = extractSnippet(
        session.allMessagesText || session.firstMessage || '',
        query,
        100,
      );

      results.push({
        id: session.id,
        name: session.name,
        path: session.path,
        cwd: session.cwd,
        created: String(session.created || ''),
        modified: String(session.modified || ''),
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        snippet,
        matchCount,
      });
    }

    return { results, total: results.length };
  });

  app.get('/skills', async (req, reply) => {
    const { clientId, projectPath } = req.query as { clientId?: string; projectPath?: string };
    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    return { skills: await sessionService.listAvailableSkills(clientId, projectPath) };
  });

  app.get('/worktree-branches', async (req, reply) => {
    const { clientId, projectPath } = req.query as { clientId?: string; projectPath?: string };
    if (!clientId || !projectPath) {
      return reply.status(400).send({ error: 'clientId and projectPath are required' });
    }

    return { branches: await worktreeManager.listLocalBranches(projectPath) };
  });

  app.get('/worktree-copy-files', async (req, reply) => {
    const { clientId, projectPath } = req.query as { clientId?: string; projectPath?: string };
    if (!clientId || !projectPath) {
      return reply.status(400).send({ error: 'clientId and projectPath are required' });
    }

    return { files: await worktreeManager.listRootIgnoredFiles(projectPath) };
  });

  app.get('/git-status', async (req, reply) => {
    const { clientId, projectPath } = req.query as { clientId?: string; projectPath?: string };
    if (!clientId || !projectPath) {
      return reply.status(400).send({ error: 'clientId and projectPath are required' });
    }

    return worktreeManager.getGitStatus(projectPath);
  });

  app.get('/pin-groups', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { profileId } = req.query as { profileId?: string };
    if (!profileId) return reply.status(400).send({ error: 'profileId is required' });
    const owner = { type: 'profile' as const, id: profileId };
    const idsByGroup = options.pinStore.listSessionIdsByGroup(owner);
    return {
      groups: options.pinStore.listGroups(owner).map((group) => ({
        ...group,
        sessionIds: idsByGroup.get(group.id) || [],
      })),
    };
  });

  app.post('/pin-groups', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { name, profileId } = req.body as { name?: string; profileId?: string };
    if (!name?.trim() || !profileId) return reply.status(400).send({ error: 'name and profileId are required' });
    try {
      return { group: options.pinStore.createGroup({ type: 'profile', id: profileId }, name) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create pin group' });
    }
  });

  app.put('/:id/pin', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id } = req.params as { id: string };
    const { groupId, profileId } = req.body as { groupId?: string; profileId?: string };
    if (!groupId || !profileId) return reply.status(400).send({ error: 'groupId and profileId are required' });
    try {
      options.pinStore.pinSession({ type: 'profile', id: profileId }, id, groupId);
      return { success: true };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Pin group not found' });
    }
  });

  app.delete('/:id/pin', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id } = req.params as { id: string };
    const { profileId } = req.query as { profileId?: string };
    if (!profileId) return reply.status(400).send({ error: 'profileId is required' });
    options.pinStore.unpinSession({ type: 'profile', id: profileId }, id);
    return { success: true };
  });

  app.get('/pinned', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { clientId, profileId } = req.query as { clientId?: string; profileId?: string };
    if (!clientId || !profileId) return reply.status(400).send({ error: 'clientId and profileId are required' });

    const sessions = await sessionService.listSessions(clientId, undefined);
    const sessionsById = new Map(sessions.map((session) => [session.id, withWorktree({
      ...session,
      isStreaming: sessionService.isSessionStreaming(session.id),
    }, worktreeMetadata)]));
    const owner = { type: 'profile' as const, id: profileId };
    const idsByGroup = options.pinStore.listSessionIdsByGroup(owner);
    return {
      groups: options.pinStore.listGroups(owner).map((group) => ({
        ...group,
        sessions: (idsByGroup.get(group.id) || [])
          .map((id) => sessionsById.get(id))
          .filter((session): session is NonNullable<typeof session> => Boolean(session))
          .map(toSessionListItem),
      })),
    };
  });

  app.get('/project-paths', async (req) => {
    const { clientId } = req.query as { clientId?: string };
    if (!clientId) {
      return { error: 'clientId is required' };
    }

    const sessionPaths = await sessionService.listProjectPaths(clientId);
    const projectPaths = Array.from(new Set([
      ...sessionPaths,
      ...(options.projectTaskStore?.listProjectPaths() || []),
    ]));

    return { projectPaths };
  });

  app.post('/project-history-summary', async (req, reply) => {
    const { clientId, projectPaths } = req.body as { clientId?: string; projectPaths?: unknown[] };
    if (!clientId || !Array.isArray(projectPaths)) {
      return reply.status(400).send({ error: 'clientId and projectPaths are required' });
    }

    const paths = Array.from(new Set(projectPaths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path) => path.trim())))
      .slice(0, 100);
    const projects = await Promise.all(paths.map(async (path) => ({
      path,
      sessionCount: (await listSessionsForRoute(sessionService, worktreeMetadata, clientId, 'project', expandHomePath(path))).length,
    })));
    return { projects };
  });

  app.delete('/project-history', async (req, reply) => {
    const { clientId, projectPath } = req.body as { clientId?: string; projectPath?: string };
    if (!clientId || !projectPath?.trim()) {
      return reply.status(400).send({ error: 'clientId and projectPath are required' });
    }

    const cwd = expandHomePath(projectPath.trim());
    const sessions = await sessionService.listSessions(clientId, cwd);
    if (sessions.some((session) => sessionService.isSessionStreaming(session.id))) {
      return reply.status(409).send({ error: 'Cannot remove history with a streaming session' });
    }

    const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
    sessionService.forceDisposeByCwd(cwd);
    await sessionService.deleteSessionFiles(sessionService.getProjectSessionDirForPath(cwd, agentDir));
    for (const session of sessions) {
      sessionService.deleteSkillPolicy(session.id);
      sessionService.deleteSessionMetadata(session.id);
    }
    return { success: true, removedSessions: sessions.length };
  });

  app.get('/', async (req) => {
    const { clientId, projectPath, scope, offset: rawOffset, limit: rawLimit } = req.query as {
      clientId?: string;
      projectPath?: string;
      scope?: 'project' | 'all';
      offset?: string;
      limit?: string;
    };

    if (!clientId) {
      return { error: 'clientId is required' };
    }

    const offset = Math.max(0, Number.parseInt(rawOffset || '0', 10) || 0);
    const requestedLimit = rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);
    const limit = requestedLimit === undefined ? undefined : Math.min(100, Math.max(1, requestedLimit || 1));
    const sessions = await listSessionsForRoute(sessionService, worktreeMetadata, clientId, scope, projectPath);
    const latestPrs = await refreshPrActivities(
      options.activityStore?.listLatestPrForSessions?.(sessions.map((session) => session.id)) || new Map(),
      options,
    );
    const decoratedSessions = sessions.map((session) => withWorktree({
      ...session,
      isStreaming: sessionService.isSessionStreaming(session.id),
      pullRequest: pullRequestFromActivity(latestPrs.get(session.id)),
    }, worktreeMetadata));
    const filteredSessions = decoratedSessions
      .filter((session) => scope === 'all' || belongsToProject(session, projectPath));
    const page = limit === undefined
      ? filteredSessions.slice(offset)
      : filteredSessions.slice(offset, offset + limit);
    const nextOffset = offset + page.length;

    return {
      sessions: page.map(toSessionListItem),
      hasMore: nextOffset < filteredSessions.length,
      nextOffset,
    };
  });

  app.post('/clone-repository/preview', async (req, reply) => {
    const cloner = requireRepositoryCloner(reply);
    if (!cloner) return;
    const { remoteUrl } = req.body as { remoteUrl?: string };
    try {
      return { preview: cloner.preview({ remoteUrl: remoteUrl || '' }) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to preview repository' });
    }
  });

  app.post('/clone-repository', async (req, reply) => {
    const cloner = requireRepositoryCloner(reply);
    if (!cloner) return;
    const { clientId, remoteUrl, destinationPath, shallow } = req.body as { clientId?: string; remoteUrl?: string; destinationPath?: string; shallow?: boolean };
    if (!clientId || !remoteUrl || !destinationPath) {
      return reply.status(400).send({ error: 'clientId, remoteUrl and destinationPath are required' });
    }
    try {
      const result = await cloner.start({ clientId, remoteUrl, destinationPath, shallow: shallow === true });
      if (result.status === 'destination_exists') return reply.status(409).send(result);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to clone repository' });
    }
  });

  app.get('/clone-repository/:jobId/events', async (req, reply) => {
    const cloner = requireRepositoryCloner(reply);
    if (!cloner) return;
    const { jobId } = req.params as { jobId: string };
    if (!cloner.getJob(jobId)) return reply.status(404).send({ error: 'Clone job not found' });
    const raw = (((reply as FastifyReply & { raw?: unknown }).raw || req.raw) as unknown) as typeof req.raw & {
      writeHead(statusCode: number, headers: Record<string, string>): void;
      write(chunk: string): void;
      end(): void;
    };
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const unsubscribe = cloner.subscribe(jobId, (event) => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'canceled') raw.end();
    });
    raw.on('close', unsubscribe);
  });

  app.post('/clone-repository/:jobId/cancel', async (req, reply) => {
    const cloner = requireRepositoryCloner(reply);
    if (!cloner) return;
    const { jobId } = req.params as { jobId: string };
    try {
      return { job: await cloner.cancel(jobId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Clone job not found' });
    }
  });

  app.post('/', async (req, reply) => {
    const { clientId, cwd, agentProfileId, modelProvider, modelId, enabledSkills, disabledSkills, presetId, copySettingsFromSessionId, worktree } = req.body as CreateSessionRequest;

    if (!clientId) {
      return { error: 'clientId is required' };
    }

    if ((enabledSkills?.length || 0) > 0 && (disabledSkills?.length || 0) > 0) {
      return reply.status(400).send({ error: 'Provide either enabledSkills or disabledSkills, not both' });
    }

    if (copySettingsFromSessionId && (modelProvider || modelId || enabledSkills || disabledSkills || presetId)) {
      return reply.status(400).send({ error: 'Cannot combine copied session settings with explicit model or skill settings' });
    }

    let sessionOptions: SessionOptions = { cwd, agentProfileId, modelProvider, modelId, enabledSkills, disabledSkills, presetId };
    if (copySettingsFromSessionId) {
      const source = await sessionService.findPersistedSession(clientId, copySettingsFromSessionId);
      if (!source) {
        return reply.status(404).send({ error: 'Source session not found' });
      }

      const activeSource = sessionService.getSession(clientId, copySettingsFromSessionId);
      const status = activeSource
        ? sessionService.getRuntimeStatus(activeSource)
        : await sessionService.readSessionRuntimeStatus(clientId, source.path);
      const policy = sessionService.getSkillPolicy(copySettingsFromSessionId);
      sessionOptions = {
        cwd: source.cwd || cwd,
        agentProfileId,
        modelProvider: status.model?.provider,
        modelId: status.model?.id,
        enabledSkills: policy?.mode === 'enabled' ? policy.skills : undefined,
        disabledSkills: policy?.mode === 'disabled' ? policy.skills : undefined,
        presetId: policy?.presetId || undefined,
        skillMode: policy?.mode || 'all',
      };
    }

    try {
      if (agentProfileId) await sessionService.setClientAgentProfile(clientId, agentProfileId);
      const resolved = await worktreeManager.resolveSessionCwd(sessionOptions.cwd || process.cwd(), worktree);
      const result = await sessionService.createSession(clientId, { ...sessionOptions, cwd: resolved.cwd });
      const savedWorktree = resolved.metadata
        ? (worktreeMetadata.save({ sessionId: result.session.sessionId, ...resolved.metadata }) || { sessionId: result.session.sessionId, ...resolved.metadata })
        : undefined;

      return {
        success: true,
        sessionId: result.session.sessionId,
        model: result.session.model,
        thinkingLevel: result.session.thinkingLevel,
        appliedSkillMode: result.skillPolicy.mode,
        appliedSkills: result.skillPolicy.appliedSkills,
        ignoredSkills: result.skillPolicy.ignoredSkills,
        worktree: savedWorktree,
      };
    } catch (error) {
      console.error('Failed to create session:', error);
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create session' });
    }
  });

  app.post('/move-project', async (req, reply) => {
    const { clientId, oldProjectPath, destinationParentPath, newProjectName } = req.body as Partial<MoveProjectRequest>;

    if (!clientId || !oldProjectPath || !destinationParentPath || !newProjectName) {
      return reply.status(400).send({ error: 'clientId, oldProjectPath, destinationParentPath and newProjectName are required' });
    }

    const oldCwd = expandHomePath(oldProjectPath);
    const destinationParent = expandHomePath(destinationParentPath);

    if (sessionService.isCwdStreaming(oldCwd)) {
      return reply.status(409).send({ error: 'Cannot move a project with a streaming session' });
    }

    try {
      const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
      const oldSessionDir = sessionService.getProjectSessionDirForPath(oldCwd, agentDir);
      const memoryProject = await resolveMemoryProject(app, clientId, oldCwd);

      sessionService.forceDisposeByCwd(oldCwd);
      const moveResult = await projectMover.move({
        oldProjectPath: oldCwd,
        destinationParentPath: destinationParent,
        newProjectName,
      });

      const sessionResult = await sessionFileRelocator.relocateProject({
        sourceSessionDir: oldSessionDir,
        destinationSessionDir: sessionService.getProjectSessionDirForPath(moveResult.projectPath, agentDir),
        expectedOldCwd: oldCwd,
        newCwd: moveResult.projectPath,
      });
      await app.memoryRuntime.relocateProject(memoryProject.id, moveResult.projectPath);
      options.projectTaskStore?.replaceProjectPath(oldCwd, moveResult.projectPath);
      sessionService.invalidateSessionListCache();

      return {
        success: true,
        projectPath: moveResult.projectPath,
        movedSessions: sessionResult.moved,
        skippedSessionFiles: sessionResult.skipped,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move project';
      const status = message.includes('already exists') || message.includes('streaming') ? 409 : 400;
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/relocate-project', async (req, reply) => {
    const { clientId, oldProjectPath, newProjectPath } = req.body as Partial<RelocateProjectSessionsRequest>;

    if (!clientId || !oldProjectPath || !newProjectPath) {
      return reply.status(400).send({ error: 'clientId, oldProjectPath and newProjectPath are required' });
    }

    if (oldProjectPath === newProjectPath) {
      return { success: true, moved: 0, skipped: 0 };
    }

    try {
      const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
      const oldCwd = expandHomePath(oldProjectPath);
      const newCwd = expandHomePath(newProjectPath);
      const memoryProject = await resolveMemoryProject(app, clientId, oldCwd);

      sessionService.forceDisposeByCwd(oldCwd);
      const result = await sessionFileRelocator.relocateProject({
        sourceSessionDir: sessionService.getProjectSessionDirForPath(oldCwd, agentDir),
        destinationSessionDir: sessionService.getProjectSessionDirForPath(newCwd, agentDir),
        expectedOldCwd: oldCwd,
        newCwd,
      });
      await app.memoryRuntime.relocateProject(memoryProject.id, newCwd);
      options.projectTaskStore?.replaceProjectPath(oldCwd, newCwd);
      sessionService.invalidateSessionListCache();

      return { success: true, moved: result.moved, skipped: result.skipped };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to relocate project sessions';
      return reply.status(message.includes('already exists') ? 409 : 400).send({ error: message });
    }
  });

  app.post('/:id/relocate', async (req, reply) => {
    const { clientId, newProjectPath } = req.body as { clientId?: string; newProjectPath?: string };
    const { id } = req.params as { id: string };

    if (!clientId || !newProjectPath) {
      return reply.status(400).send({ error: 'clientId and newProjectPath are required' });
    }
    if (sessionService.isSessionStreaming(id)) {
      return reply.status(409).send({ error: 'Cannot move a streaming session' });
    }

    const session = await sessionService.findPersistedSession(clientId, id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    if (!session.cwd) return reply.status(400).send({ error: 'Session does not have a project path' });

    const oldCwd = expandHomePath(session.cwd);
    const newCwd = expandHomePath(newProjectPath);
    if (oldCwd === newCwd) return { success: true, path: session.path, cwd: newCwd };

    const worktree = worktreeMetadata.get(id);
    if (worktree?.worktreeManaged === true && worktree.worktreeStatus === 'active') {
      return reply.status(409).send({ error: 'Cannot move an active worktree session' });
    }

    try {
      sessionService.forceDisposeBySessionId(id);
      const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
      const result = await sessionFileRelocator.relocate({
        sessionId: id,
        sourceSessionDir: dirname(session.path),
        destinationSessionDir: sessionService.getProjectSessionDirForPath(newCwd, agentDir),
        expectedOldCwd: oldCwd,
        newCwd,
      });
      if (!result.relocated) return reply.status(404).send({ error: 'Session file not found' });

      sessionService.invalidateSessionListCache();
      return { success: true, path: result.destinationPath, cwd: newCwd };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move session';
      return reply.status(message.includes('already exists') ? 409 : 400).send({ error: message });
    }
  });

  app.post('/:id/resume', async (req) => {
    const { clientId } = req.body as ResumeSessionRequest;
    const { id } = req.params as { id: string };

    if (!clientId) {
      return { error: 'clientId is required' };
    }

    const sessionInfo = await sessionService.findPersistedSession(clientId, id);
    if (!sessionInfo) {
      return { error: 'Session not found' };
    }

    const session = await sessionService.resumeSession(clientId, sessionInfo.path);

    return {
      success: true,
      sessionId: session.sessionId,
      messages: session.messages,
      model: session.model,
    };
  });

  app.get('/:id/models', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      return { models: await sessionService.listAvailableModels(clientId, id) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Failed to list models' });
    }
  });

  app.get('/:id/skills', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      return await sessionService.getSessionSkillConfiguration(clientId, id);
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Failed to load session skills' });
    }
  });

  app.put('/:id/skills', async (req, reply) => {
    const { clientId, mode, skills } = req.body as { clientId?: string; mode?: 'all' | 'enabled' | 'disabled'; skills?: string[] };
    const { id } = req.params as { id: string };

    if (!clientId || !mode) {
      return reply.status(400).send({ error: 'clientId and mode are required' });
    }

    if (!['all', 'enabled', 'disabled'].includes(mode)) {
      return reply.status(400).send({ error: 'mode must be all, enabled, or disabled' });
    }

    try {
      return await sessionService.updateSessionSkillPolicy(clientId, id, mode, skills || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update session skills';
      return reply.status(message.includes('streaming') ? 409 : 404).send({ error: message });
    }
  });

  app.post('/:id/model', async (req, reply) => {
    const { clientId, provider, modelId } = req.body as { clientId?: string; provider?: string; modelId?: string };
    const { id } = req.params as { id: string };

    if (!clientId || !provider || !modelId) {
      return reply.status(400).send({ error: 'clientId, provider and modelId are required' });
    }

    try {
      return await sessionService.setSessionModel(clientId, id, provider, modelId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to change model';
      return reply.status(message.includes('streaming') ? 409 : 400).send({ error: message });
    }
  });

  app.post('/:id/thinking-level', async (req, reply) => {
    const { clientId, level } = req.body as { clientId?: string; level?: string };
    const { id } = req.params as { id: string };

    if (!clientId || !level) {
      return reply.status(400).send({ error: 'clientId and level are required' });
    }

    try {
      return await sessionService.setSessionThinkingLevel(clientId, id, level);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to change thinking level';
      return reply.status(message.includes('streaming') ? 409 : 400).send({ error: message });
    }
  });

  app.get('/:id/summary', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    const session = await sessionService.getSessionSummary(clientId, id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const latestPrs = await refreshPrActivities(
      options.activityStore?.listLatestPrForSessions?.([id]) || new Map(),
      options,
    );
    return toSessionListItem(withWorktree({
      ...session,
      pullRequest: pullRequestFromActivity(latestPrs.get(id)),
    }, worktreeMetadata));
  });

  app.get('/:id/status', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    const activeSession = sessionService.getSession(clientId, id);
    if (activeSession) {
      return sessionService.getRuntimeStatus(activeSession);
    }

    const sessionInfo = await sessionService.findPersistedSession(clientId, id);
    if (!sessionInfo) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return sessionService.readSessionRuntimeStatus(clientId, sessionInfo.path);
  });

  app.get('/:id/info', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      return await sessionService.getSessionCommandInfo(clientId, id);
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Session not found' });
    }
  });

  app.get('/:id/tree', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      return await sessionService.withActiveSession(clientId, id, (session) => {
        const tree = session.sessionManager.getTree();
        if (sessionTreeExceedsLimit(tree)) {
          return {
            sessionId: session.sessionId,
            oversized: true,
            message: `This session tree has more than ${MAX_SESSION_TREE_NODES.toLocaleString()} entries and is too large to display safely. Inspect the session history another way.`,
            tree: [],
          };
        }
        return {
          sessionId: session.sessionId,
          leafId: session.sessionManager.getLeafId(),
          tree: sanitizeSessionTree(tree),
        };
      });
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Session not found' });
    }
  });

  app.post('/:id/tree/navigate', async (req, reply) => {
    const { clientId, targetId, summarize, customInstructions, replaceInstructions, label } = req.body as {
      clientId?: string;
      targetId?: string;
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    };
    const { id } = req.params as { id: string };

    if (!clientId || !targetId) {
      return reply.status(400).send({ error: 'clientId and targetId are required' });
    }

    try {
      return await sessionService.withActiveSession(clientId, id, async (session) => {
        const result = await sessionService.runWithClientProfileProxy(clientId, () => session.navigateTree(targetId, {
          summarize,
          customInstructions,
          replaceInstructions,
          label,
        }));
        return {
          cancelled: result.cancelled,
          editorText: result.editorText,
        };
      });
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Session not found' });
    }
  });

  app.get('/:id', async (req) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return { error: 'clientId is required' };
    }

    let foundSession = null;
    const activeSessions = sessionService.getAllSessions();
    for (const [, session] of activeSessions) {
      if (session.sessionId === id) {
        foundSession = session;
        break;
      }
    }

    if (!foundSession) {
      foundSession = sessionService.getSession(id);
    }

    if (foundSession) {
      return withWorktree({
        sessionId: foundSession.sessionId,
          messages: foundSession.messages,
        model: foundSession.model,
        thinkingLevel: foundSession.thinkingLevel,
        isStreaming: foundSession.isStreaming,
        activity: options.activityStore?.listForSession(foundSession.sessionId) || [],
      }, worktreeMetadata);
    }

    const sessionInfo = await sessionService.findPersistedSession(clientId, id);
    if (!sessionInfo) {
      return { error: 'Session not found' };
    }

    return withWorktree({
      ...(await sessionService.readSessionSnapshot(clientId, sessionInfo.path)),
      activity: options.activityStore?.listForSession(id) || [],
    }, worktreeMetadata);
  });

  app.get('/:id/finish-worktree-preview', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    const metadata = worktreeMetadata.get(id);
    if (!metadata || metadata.worktreeStatus !== 'active' || metadata.worktreeManaged !== true) {
      return reply.status(404).send({ error: 'Active managed worktree session not found' });
    }

    const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
    const history = await sessionFileRelocator.plan({
      sessionId: id,
      sourceSessionDir: sessionService.getProjectSessionDirForPath(metadata.worktreePath, agentDir),
      destinationSessionDir: sessionService.getProjectSessionDirForPath(metadata.baseRepoPath, agentDir),
      expectedOldCwd: metadata.worktreePath,
      newCwd: metadata.baseRepoPath,
    });

    return {
      worktreePath: metadata.worktreePath,
      baseRepoPath: metadata.baseRepoPath,
      history,
    };
  });

  app.post('/:id/finish-worktree', async (req, reply) => {
    const { clientId } = req.body as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    if (sessionService.isSessionStreaming(id)) {
      return reply.status(409).send({ error: 'Cannot finish a streaming session' });
    }

    const metadata = worktreeMetadata.get(id);
    if (!metadata || metadata.worktreeStatus !== 'active' || metadata.worktreeManaged !== true) {
      return reply.status(404).send({ error: 'Active managed worktree session not found' });
    }

    sessionService.forceDisposeBySessionId(id);
    const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
    await sessionFileRelocator.relocate({
      sessionId: id,
      sourceSessionDir: sessionService.getProjectSessionDirForPath(metadata.worktreePath, agentDir),
      destinationSessionDir: sessionService.getProjectSessionDirForPath(metadata.baseRepoPath, agentDir),
      expectedOldCwd: metadata.worktreePath,
      newCwd: metadata.baseRepoPath,
    });
    await worktreeManager.removeWorktree(metadata.baseRepoPath, metadata.worktreePath);
    await worktreeManager.pullFastForwardOnly(metadata.baseRepoPath);
    worktreeMetadata.markFinished(id);

    return { success: true };
  });

  app.patch('/:id/rename', async (req, reply) => {
    const { clientId, name } = req.body as { clientId?: string; name?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    if (name === undefined) {
      return reply.status(400).send({ error: 'name is required' });
    }

    try {
      const result = await sessionService.renameSession(clientId, id, name);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename session';
      return reply.status(message.includes('not found') ? 404 : 400).send({ error: message });
    }
  });

  app.delete('/:id', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    const { id } = req.params as { id: string };

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    const session = await sessionService.findPersistedSession(clientId, id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    sessionService.forceDisposeBySessionId(id);
    await sessionService.deleteSessionFiles(session.path);
    sessionService.deleteSessionMetadata(id);
    app.authServices?.audit.record({
      type: 'session_deleted',
      status: 'success',
      metadata: { sessionId: id, path: session.path },
    });

    return { success: true };
  });
}
