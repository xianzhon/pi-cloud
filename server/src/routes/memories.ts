import { dirname } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { MemoryContext, MemoryPatch } from '../memory/types.js';

const MEMORY_SCOPES = ['project', 'global'] as const;
const MEMORY_CATEGORIES = ['rule', 'preference', 'decision', 'fact', 'pitfall'] as const;
const MEMORY_STATUSES = ['active', 'pending', 'archived'] as const;
const PINNED_APPLICABILITY_MODES = ['always', 'matched'] as const;

class MemoryRouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

interface ContextInput {
  clientId?: unknown;
  projectPath?: unknown;
  sessionId?: unknown;
}

export async function memoryRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    try {
      const query = req.query as Record<string, unknown>;
      const context = await resolveContext(app, query);
      const scope = optionalEnum(query.scope, MEMORY_SCOPES, 'scope');
      const statuses = optionalEnumList(query.statuses, MEMORY_STATUSES, 'statuses');
      const categories = optionalEnumList(query.categories, MEMORY_CATEGORIES, 'categories');
      const result = app.memoryRuntime.service.list(context, {
        scope,
        statuses,
        categories,
        extractionRunId: optionalString(query.extractionRunId),
        query: optionalString(query.query) ?? optionalString(query.q),
        limit: clampNumber(query.limit, 1, 100, 50),
        offset: clampNumber(query.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      });
      return { memories: result.items, total: result.total };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/counts', async (req, reply) => {
    try {
      const context = await resolveContext(app, req.query as ContextInput);
      return { counts: app.memoryRuntime.service.counts(context) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/extractions/failed', async (req, reply) => {
    try {
      const context = await resolveContext(app, req.query as ContextInput);
      return { extractions: app.memoryRuntime.store.listFailedExtractionRuns(context.profileId, context.project.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const scope = optionalEnum(body.scope, MEMORY_SCOPES, 'scope');
      const category = requiredEnum(body.category, MEMORY_CATEGORIES, 'category');
      const content = requiredString(body.content, 'content');
      const tags = optionalStringArray(body.tags, 'tags') ?? [];
      const pinned = optionalBoolean(body.pinned, 'pinned') ?? false;
      const pinnedApplicability = optionalEnum(
        body.pinnedApplicability,
        PINNED_APPLICABILITY_MODES,
        'pinnedApplicability',
      );
      const memory = app.memoryRuntime.service.save(context, {
        scope,
        category,
        content,
        tags,
        pinned,
        pinnedApplicability,
      }, 'manual_ui');
      return { memory };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/extractions', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const clientId = requiredString(body.clientId, 'clientId');
      const sessionId = requiredString(body.sessionId, 'sessionId');
      const profile = await app.services.sessions.getClientAgentProfile(clientId);
      const sessionInfo = await app.services.sessions.findPersistedSession(clientId, sessionId);
      if (!sessionInfo) throw new MemoryRouteError(404, 'Session not found');

      const manager = SessionManager.open(sessionInfo.path, dirname(sessionInfo.path));
      const endingLeafId = manager.getLeafId();
      if (!endingLeafId) throw new MemoryRouteError(400, 'Session has no extractable entries');
      const cwd = sessionInfo.cwd || manager.getCwd();
      if (!cwd) throw new MemoryRouteError(400, 'Session project path is unavailable');
      const context = await app.memoryRuntime.service.resolveContext({
        profileId: profile.id,
        cwd,
        sessionId: sessionInfo.id,
        sessionPath: sessionInfo.path,
      });
      const sourceModel = findLastAssistantModel(manager.getBranch(endingLeafId));
      const extraction = await app.memoryRuntime.coordinator.enqueue({
        profileId: profile.id,
        projectId: context.project.id,
        sourceSessionId: sessionInfo.id,
        sourceSessionPath: sessionInfo.path,
        sourceKind: 'session_import',
        endingLeafId,
        modelProvider: sourceModel?.provider,
        modelId: sourceModel?.model,
      });
      return reply.status(202).send({ extraction });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/extractions/:id/retry', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const { id } = req.params as { id: string };
      requireAccessibleRun(app, context, id);
      app.memoryRuntime.coordinator.retry(id);
      return reply.status(202).send({ extraction: app.memoryRuntime.store.getExtractionRun(id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/extractions/:id/clear', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const { id } = req.params as { id: string };
      requireAccessibleRun(app, context, id);
      app.memoryRuntime.store.clearFailedRun(id);
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/batches/:id/undo', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const { id } = req.params as { id: string };
      requireAccessibleRun(app, context, id);
      const result = app.memoryRuntime.store.undoExtractionRun(id);
      if (result.skippedIds.length > 0) {
        return reply.status(409).send({ error: 'Some memories were modified and could not be undone', result });
      }
      return { result };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch('/:id', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const archive = optionalBoolean(body.archive, 'archive') ?? false;
      const patch = memoryPatch(body);
      if (archive && Object.keys(patch).length > 0) {
        throw new MemoryRouteError(400, 'archive cannot be combined with memory edits');
      }
      if (!archive && Object.keys(patch).length === 0) {
        throw new MemoryRouteError(400, 'At least one memory change is required');
      }
      const { id } = req.params as { id: string };
      const memory = archive
        ? app.memoryRuntime.service.forget(context, id, expectedRevision)
        : app.memoryRuntime.service.update(context, id, expectedRevision, patch);
      return { memory };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete('/:id', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const { id } = req.params as { id: string };
      app.memoryRuntime.service.delete(context, id, expectedRevision);
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/:id/restore', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const { id } = req.params as { id: string };
      return { memory: app.memoryRuntime.service.restore(context, id, expectedRevision) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/:id/approve', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const patch = memoryPatch(body);
      const { id } = req.params as { id: string };
      const memory = app.memoryRuntime.service.approve(
        context,
        id,
        expectedRevision,
        Object.keys(patch).length > 0 ? patch : undefined,
      );
      return { memory };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/:id/reject', async (req, reply) => {
    try {
      const body = requestBody(req.body);
      const context = await resolveContext(app, body);
      const expectedRevision = requiredRevision(body.expectedRevision);
      const { id } = req.params as { id: string };
      return { memory: app.memoryRuntime.service.reject(context, id, expectedRevision) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

async function resolveContext(app: FastifyInstance, input: ContextInput): Promise<MemoryContext> {
  const clientId = requiredString(input.clientId, 'clientId');
  const profile = await app.services.sessions.getClientAgentProfile(clientId);
  const sessionId = optionalString(input.sessionId);
  if (sessionId) {
    const session = await app.services.sessions.findPersistedSession(clientId, sessionId);
    if (!session) throw new MemoryRouteError(404, 'Session not found');
    const cwd = session.cwd || optionalString(input.projectPath);
    if (!cwd) throw new MemoryRouteError(400, 'Session project path is unavailable');
    return app.memoryRuntime.service.resolveContext({
      profileId: profile.id,
      cwd,
      sessionId: session.id,
      sessionPath: session.path,
    });
  }

  const projectPath = optionalString(input.projectPath);
  if (!projectPath) throw new MemoryRouteError(400, 'projectPath or sessionId is required');
  return app.memoryRuntime.service.resolveContext({ profileId: profile.id, cwd: projectPath });
}

function findLastAssistantModel(entries: ReturnType<SessionManager['getBranch']>) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      return { provider: entry.message.provider, model: entry.message.model };
    }
  }
  return undefined;
}

function requireAccessibleRun(app: FastifyInstance, context: MemoryContext, id: string) {
  const run = app.memoryRuntime.store.getExtractionRun(id);
  if (!run || run.profileId !== context.profileId || run.projectId !== context.project.id) {
    throw new MemoryRouteError(404, 'Extraction run not found');
  }
  return run;
}

function memoryPatch(body: Record<string, unknown>): MemoryPatch {
  const patch: MemoryPatch = {};
  if (body.category !== undefined) patch.category = requiredEnum(body.category, MEMORY_CATEGORIES, 'category');
  if (body.content !== undefined) patch.content = requiredString(body.content, 'content');
  if (body.tags !== undefined) patch.tags = optionalStringArray(body.tags, 'tags')!;
  if (body.pinned !== undefined) patch.pinned = optionalBoolean(body.pinned, 'pinned')!;
  if (body.pinnedApplicability !== undefined) {
    patch.pinnedApplicability = requiredEnum(
      body.pinnedApplicability,
      PINNED_APPLICABILITY_MODES,
      'pinnedApplicability',
    );
  }
  return patch;
}

function requestBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MemoryRouteError(400, 'Request body must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new MemoryRouteError(400, `${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new MemoryRouteError(400, `${name} must be a boolean`);
  return value;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new MemoryRouteError(400, `${name} must be an array of strings`);
  }
  return value as string[];
}

function requiredRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new MemoryRouteError(400, 'expectedRevision must be a positive integer');
  }
  return revision;
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  name: string,
): T[number] | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new MemoryRouteError(400, `${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function requiredEnum<const T extends readonly string[]>(value: unknown, allowed: T, name: string): T[number] {
  const parsed = optionalEnum(value, allowed, name);
  if (!parsed) throw new MemoryRouteError(400, `${name} is required`);
  return parsed;
}

function optionalEnumList<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  name: string,
): T[number][] | undefined {
  if (value === undefined || value === '') return undefined;
  const values = Array.isArray(value) ? value : String(value).split(',');
  if (values.some((item) => typeof item !== 'string' || !allowed.includes(item.trim()))) {
    throw new MemoryRouteError(400, `${name} contains an invalid value`);
  }
  return values.map((item) => String(item).trim()) as T[number][];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function sendError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Memory request failed';
  if (error instanceof MemoryRouteError) return reply.status(error.statusCode).send({ error: message });
  if (/not found/i.test(message)) return reply.status(404).send({ error: message });
  if (/modified|already exists|not pending|not failed|not completed|cannot be requeued|superseded/i.test(message)) {
    return reply.status(409).send({ error: message });
  }
  return reply.status(400).send({ error: message });
}
