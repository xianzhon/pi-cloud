import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRecord, MemoryUpdatedEvent } from '../types/memory';

const websocket = vi.hoisted(() => {
  const handlers = new Map<string, Function>();
  const unsubscribe = vi.fn();
  return {
    handlers,
    unsubscribe,
    on: vi.fn((event: string, listener: Function) => {
      handlers.set(event, listener);
      return unsubscribe;
    }),
  };
});

const lifecycle = vi.hoisted(() => ({ unmount: undefined as (() => void) | undefined }));

vi.mock('./useWebSocket', () => ({
  useWebSocket: () => ({ on: websocket.on }),
}));

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onUnmounted: (callback: () => void) => { lifecycle.unmount = callback; },
  };
});

import { useMemories } from './useMemories';

const memory: MemoryRecord = {
  id: 'memory-1', profileId: 'default', projectId: 'project-1', scope: 'project', category: 'decision',
  content: 'Use SQLite FTS5', tags: ['sqlite'], pinned: false, status: 'active', source: 'manual_ui',
  revision: 1, createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
};

function response(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data } as Response;
}

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    const method = options?.method || 'GET';
    if (url.includes('/counts')) {
      return response({ counts: {
        projectActive: 1, globalActive: 2, globalPending: 3,
        archived: 4, failedExtractions: 0, pinnedOverflow: false,
      } });
    }
    if (url.includes('/extractions/failed')) return response({ extractions: [] });
    if (method === 'GET') return response({ memories: [memory], total: 1 });
    if (url.endsWith('/reject')) return response({ memory: { ...memory, status: 'archived', revision: 2 } });
    if (url.endsWith('/restore')) return response({ memory: { ...memory, status: 'active', revision: 2 } });
    if (method === 'DELETE') return response({}, true, 204);
    if (url.includes('/extractions/') && url.endsWith('/retry')) return response({ extraction: { id: 'run-1' } });
    if (url.includes('/extractions/') && url.endsWith('/clear')) return response({}, true, 204);
    if (url.includes('/extractions')) return response({ extraction: { id: 'run-1' } });
    if (url.includes('/batches/')) return response({ result: { archivedIds: [], restoredIds: [], skippedIds: [] } });
    return response({ memory: { ...memory, revision: 2 } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function parsedBody(call: [RequestInfo | URL, RequestInit?]) {
  return JSON.parse(String(call[1]?.body || '{}'));
}

describe('useMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    websocket.handlers.clear();
    lifecycle.unmount = undefined;
  });

  it('encodes context and filters when loading memories and counts', async () => {
    const fetchMock = installFetch();
    const controller = useMemories({ clientId: 'client/one' });
    controller.setContext({ profileId: 'default', projectPath: '/repo/app one', sessionId: 'session-1' });

    await controller.loadMemories({
      scope: 'global', statuses: ['pending', 'archived'], categories: ['rule'],
      query: 'keyboard selection', extractionRunId: 'run/one', limit: 10, offset: 20,
    });
    await controller.loadCounts();

    const listUrl = String(fetchMock.mock.calls[0][0]);
    expect(listUrl).toContain('clientId=client%2Fone');
    expect(listUrl).toContain('projectPath=%2Frepo%2Fapp+one');
    expect(listUrl).toContain('scope=global');
    expect(listUrl).toContain('statuses=pending%2Carchived');
    expect(listUrl).toContain('categories=rule');
    expect(listUrl).toContain('query=keyboard+selection');
    expect(listUrl).toContain('extractionRunId=run%2Fone');
    expect(controller.memories.value).toEqual([memory]);
    expect(controller.total.value).toBe(1);
    expect(controller.counts.value.globalPending).toBe(3);
  });

  it('sends expected revisions and context for CRUD, review, extraction, retry, and undo', async () => {
    const fetchMock = installFetch();
    const controller = useMemories({ clientId: 'client-1' });
    controller.setContext({ profileId: 'default', projectPath: '/repo/app', sessionId: 'session-1' });

    await controller.createMemory({
      scope: 'project', category: 'fact', content: 'Remember this', tags: ['project'], pinned: false,
    });
    await controller.updateMemory('memory/1', 7, { content: 'Updated' });
    await controller.archiveMemory('memory/1', 8);
    await controller.restoreMemory('memory/1', 9);
    await controller.deleteMemory('memory/1', 10);
    await controller.approveMemory('memory/1', 11, { content: 'Approved' });
    await controller.rejectMemory('memory/1', 12);
    await controller.extractSession('session/old');
    await controller.retryExtraction('run/1');
    await controller.clearExtractionFailure('run/1');
    await controller.undoExtraction('run/1');

    const mutationCalls = fetchMock.mock.calls.filter((call) => (call[1]?.method || 'GET') !== 'GET') as Array<[RequestInfo | URL, RequestInit?]>;
    const update = mutationCalls.find((call) => call[1]?.method === 'PATCH' && parsedBody(call).content === 'Updated')!;
    expect(String(update[0])).toContain('/memory%2F1');
    expect(parsedBody(update)).toMatchObject({
      clientId: 'client-1', projectPath: '/repo/app', sessionId: 'session-1', expectedRevision: 7,
    });
    const archive = mutationCalls.find((call) => call[1]?.method === 'PATCH' && parsedBody(call).archive === true)!;
    expect(parsedBody(archive).expectedRevision).toBe(8);
    expect(parsedBody(mutationCalls.find((call) => String(call[0]).endsWith('/restore'))!)).toMatchObject({ expectedRevision: 9 });
    const deleteCall = mutationCalls.find((call) => call[1]?.method === 'DELETE')!;
    expect(String(deleteCall[0])).toContain('/memory%2F1');
    expect(parsedBody(deleteCall)).toMatchObject({ expectedRevision: 10 });
    expect(parsedBody(mutationCalls.find((call) => String(call[0]).endsWith('/approve'))!)).toMatchObject({ expectedRevision: 11 });
    expect(parsedBody(mutationCalls.find((call) => String(call[0]).endsWith('/reject'))!)).toMatchObject({ expectedRevision: 12 });
    expect(parsedBody(mutationCalls.find((call) => String(call[0]).endsWith('/extractions'))!))
      .toEqual({ clientId: 'client-1', sessionId: 'session/old' });
    expect(String(mutationCalls.find((call) => String(call[0]).includes('/retry'))![0])).toContain('run%2F1');
    expect(String(mutationCalls.find((call) => String(call[0]).includes('/clear'))![0])).toContain('run%2F1');
    expect(String(mutationCalls.find((call) => String(call[0]).includes('/batches/'))![0])).toContain('run%2F1');
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/counts')).length).toBeGreaterThan(0);
  });

  it('handles matching profile events and unsubscribes on unmount', async () => {
    const fetchMock = installFetch();
    const controller = useMemories({ clientId: 'client-1' });
    controller.setContext({ profileId: 'default', projectPath: '/repo/app' });
    const listener = websocket.handlers.get('memory_updated')!;
    const event: MemoryUpdatedEvent = {
      type: 'memory_updated', profileId: 'default', projectId: 'project-1', extractionRunId: 'run-1',
      activeProjectCount: 2, pendingGlobalCount: 1, failed: false,
    };

    listener({ ...event, profileId: 'work' });
    expect(controller.toast.value).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    listener(event);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(controller.toast.value).toEqual({
      extractionRunId: 'run-1', activeProjectCount: 2, pendingGlobalCount: 1, failed: false,
    });

    listener({ ...event, activeProjectCount: 0, pendingGlobalCount: 0 });
    expect(controller.toast.value).toBeNull();

    listener({ ...event, failed: true });
    expect(controller.warning.value).toMatch(/failed/i);
    lifecycle.unmount?.();
    expect(websocket.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
