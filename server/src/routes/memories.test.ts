import Fastify, { type FastifyInstance } from 'fastify';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { createMemoryRuntime, type MemoryRuntime } from '../memory/runtime.js';

const sessionService = {
  getClientAgentProfile: vi.fn(),
  findPersistedSession: vi.fn(),
};

describe('memory routes', () => {
  let app: FastifyInstance;
  let db: PiCloudDatabase;
  let runtime: MemoryRuntime;
  let openSession: MockInstance<typeof SessionManager.open>;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = openPiCloudDatabase(':memory:');
    runtime = createMemoryRuntime({
      db,
      worktrees: { get: () => null },
      resolveProfile: vi.fn(async () => ({
        id: 'default', label: 'default', path: '/profiles/default', isDefault: true,
        defaultProvider: 'anthropic', defaultModel: 'claude-sonnet',
      })),
    });
    vi.mocked(sessionService.getClientAgentProfile).mockResolvedValue({
      id: 'default', label: 'default', path: '/profiles/default', isDefault: true,
      defaultProvider: 'anthropic', defaultModel: 'claude-sonnet',
    });
    vi.mocked(sessionService.findPersistedSession).mockResolvedValue(undefined);
    openSession = vi.spyOn(SessionManager, 'open').mockReturnValue({
      getLeafId: () => 'leaf-after',
      getBranch: () => [{
        type: 'message', id: 'leaf-after', parentId: null, timestamp: '',
        message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.5' },
      }],
    } as any);

    const { memoryRoutes } = await import('./memories.js');
    app = Fastify();
    app.decorate('memoryRuntime', runtime);
    app.decorate('services', { sessions: sessionService } as any);
    await app.register(memoryRoutes, { prefix: '/api/memories' });
  });

  afterEach(async () => {
    openSession.mockRestore();
    await runtime.stop();
    await app.close();
    db.close();
  });

  const context = { clientId: 'client-1', projectPath: '/workspace' };

  it('creates, filters, updates, archives, and counts scoped memories', async () => {
    const projectCreate = await app.inject({
      method: 'POST', url: '/api/memories',
      payload: {
        ...context, scope: 'project', category: 'decision',
        content: 'Use SQLite FTS5 for memory search', tags: ['sqlite'], pinned: false,
      },
    });
    const globalCreate = await app.inject({
      method: 'POST', url: '/api/memories',
      payload: {
        ...context, scope: 'global', category: 'preference',
        content: 'Prefer concise responses', tags: ['style'], pinned: true, pinnedApplicability: 'matched',
      },
    });
    expect(projectCreate.statusCode).toBe(200);
    expect(globalCreate.statusCode).toBe(200);
    expect(globalCreate.json().memory).toMatchObject({ pinned: true, pinnedApplicability: 'matched' });
    const projectMemory = projectCreate.json().memory;
    await app.inject({
      method: 'POST', url: '/api/memories',
      payload: {
        ...context, scope: 'project', category: 'fact',
        content: 'A second project memory', tags: [], pinned: false,
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/memories?clientId=client-1&projectPath=%2Fworkspace&scope=project&statuses=active&categories=decision&query=SQLite&limit=10&offset=0',
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ total: 1 });
    expect(list.json().memories).toEqual([expect.objectContaining({ id: projectMemory.id, scope: 'project' })]);

    const page = await app.inject({
      method: 'GET',
      url: '/api/memories?clientId=client-1&projectPath=%2Fworkspace&scope=project&statuses=active&limit=1&offset=1',
    });
    expect(page.json()).toMatchObject({ total: 2 });
    expect(page.json().memories).toHaveLength(1);

    const counts = await app.inject({
      method: 'GET', url: '/api/memories/counts?clientId=client-1&projectPath=%2Fworkspace',
    });
    expect(counts.json().counts).toMatchObject({ projectActive: 2, globalActive: 1, globalPending: 0 });

    const update = await app.inject({
      method: 'PATCH', url: `/api/memories/${projectMemory.id}`,
      payload: { ...context, expectedRevision: projectMemory.revision, pinned: true, pinnedApplicability: 'matched' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().memory).toMatchObject({ pinned: true, pinnedApplicability: 'matched', revision: 2 });

    const stale = await app.inject({
      method: 'PATCH', url: `/api/memories/${projectMemory.id}`,
      payload: { ...context, expectedRevision: projectMemory.revision, pinned: false },
    });
    expect(stale.statusCode).toBe(409);

    const archive = await app.inject({
      method: 'PATCH', url: `/api/memories/${projectMemory.id}`,
      payload: { ...context, expectedRevision: 2, archive: true },
    });
    expect(archive.json().memory).toMatchObject({ status: 'archived', revision: 3 });

    const invalidApplicability = await app.inject({
      method: 'POST', url: '/api/memories',
      payload: {
        ...context, scope: 'project', category: 'rule', content: 'Invalid pin mode',
        tags: [], pinned: true, pinnedApplicability: 'sometimes',
      },
    });
    expect(invalidApplicability.statusCode).toBe(400);
  });

  it('approves edited global proposals and rejects pending proposals', async () => {
    const pending = runtime.store.createMemory({
      profileId: 'default', scope: 'global', category: 'preference', content: 'Use terse answers',
      tags: [], pinned: false, status: 'pending', source: 'automatic', evidence: 'Use terse answers',
    });
    const rejected = runtime.store.createMemory({
      profileId: 'default', scope: 'global', category: 'fact', content: 'Temporary global proposal',
      tags: [], pinned: false, status: 'pending', source: 'automatic', evidence: 'Temporary global proposal',
    });

    const approve = await app.inject({
      method: 'POST', url: `/api/memories/${pending.id}/approve`,
      payload: { ...context, expectedRevision: pending.revision, content: 'Prefer terse answers' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().memory).toMatchObject({ content: 'Prefer terse answers', status: 'active' });

    const reject = await app.inject({
      method: 'POST', url: `/api/memories/${rejected.id}/reject`,
      payload: { ...context, expectedRevision: rejected.revision },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().memory).toMatchObject({ status: 'archived' });
  });

  it('queues saved-session extraction, retries failed runs, and undoes completed batches', async () => {
    vi.mocked(sessionService.findPersistedSession).mockResolvedValue({
      id: 'session-1', path: '/sessions/session-1.jsonl', cwd: '/workspace',
      created: '', modified: '', messageCount: 2,
    });

    const queued = await app.inject({
      method: 'POST', url: '/api/memories/extractions',
      payload: { clientId: 'client-1', sessionId: 'session-1' },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json().extraction).toMatchObject({
      sourceSessionId: 'session-1', sourceKind: 'session_import', endingLeafId: 'leaf-after', status: 'queued',
      modelProvider: 'openai-codex', modelId: 'gpt-5.5',
    });
    expect(openSession).toHaveBeenCalledWith('/sessions/session-1.jsonl', '/sessions');

    const runId = queued.json().extraction.id;
    runtime.store.claimNextExtractionRun('default');
    runtime.store.failRun(runId, 'provider unavailable');
    const failed = await app.inject({
      method: 'GET', url: '/api/memories/extractions/failed?clientId=client-1&projectPath=%2Fworkspace',
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().extractions).toEqual([expect.objectContaining({ id: runId, error: 'provider unavailable' })]);

    const retry = await app.inject({
      method: 'POST', url: `/api/memories/extractions/${runId}/retry`, payload: context,
    });
    expect(retry.statusCode).toBe(202);
    expect(runtime.store.getExtractionRun(runId)?.status).toBe('queued');
    runtime.store.claimNextExtractionRun('default');
    runtime.store.failRun(runId, 'provider unavailable again');
    const clear = await app.inject({
      method: 'POST', url: `/api/memories/extractions/${runId}/clear`, payload: context,
    });
    expect(clear.statusCode).toBe(204);
    expect(runtime.store.getExtractionRun(runId)?.status).toBe('cancelled');

    const project = runtime.store.getProjectByPath('default', '/workspace')!;
    const undoRun = runtime.store.enqueueExtractionRun({
      profileId: 'default', projectId: project.id, sourceSessionId: 'session-undo',
      sourceSessionPath: '/sessions/undo.jsonl', sourceKind: 'session_import', endingLeafId: 'leaf-undo',
    }).run;
    runtime.store.claimNextExtractionRun('default');
    const applied = runtime.store.applyExtractionCandidates(undoRun.id, [{
      operation: 'new', scope: 'project', category: 'fact', content: 'Undo this extracted fact',
      tags: [], evidenceIds: ['e1'], evidence: 'Undo this extracted fact',
    }]);
    runtime.store.completeRun(undoRun.id);

    const undo = await app.inject({
      method: 'POST', url: `/api/memories/batches/${undoRun.id}/undo`, payload: context,
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().result.archivedIds).toEqual(applied.createdIds);
    expect(runtime.store.getMemory(applied.createdIds[0])?.status).toBe('archived');
  });

  it('rejects missing context and inaccessible project records', async () => {
    const otherProject = runtime.store.getOrCreateProject('default', '/other-project');
    const otherMemory = runtime.store.createMemory({
      profileId: 'default', projectId: otherProject.id, scope: 'project', category: 'fact',
      content: 'Other project fact', tags: [], pinned: false, status: 'active', source: 'manual_ui',
    });

    const missingClient = await app.inject({ method: 'GET', url: '/api/memories?projectPath=%2Fworkspace' });
    expect(missingClient.statusCode).toBe(400);
    const missingContext = await app.inject({ method: 'GET', url: '/api/memories?clientId=client-1' });
    expect(missingContext.statusCode).toBe(400);
    const missingSession = await app.inject({
      method: 'GET', url: '/api/memories?clientId=client-1&sessionId=missing-session',
    });
    expect(missingSession.statusCode).toBe(404);

    const inaccessible = await app.inject({
      method: 'PATCH', url: `/api/memories/${otherMemory.id}`,
      payload: { ...context, expectedRevision: otherMemory.revision, pinned: true },
    });
    expect(inaccessible.statusCode).toBe(404);

    vi.mocked(sessionService.getClientAgentProfile).mockResolvedValueOnce({
      id: 'work', label: 'work', path: '/profiles/work', isDefault: false,
    });
    const otherProfile = await app.inject({
      method: 'PATCH', url: `/api/memories/${otherMemory.id}`,
      payload: { ...context, expectedRevision: otherMemory.revision, pinned: true },
    });
    expect(otherProfile.statusCode).toBe(404);

    const invalid = await app.inject({
      method: 'POST', url: '/api/memories',
      payload: { ...context, scope: 'workspace', category: 'fact', content: 'Invalid scope' },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
