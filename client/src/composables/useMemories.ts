import { onUnmounted, ref } from 'vue';
import { apiRequest, type ApiRequestOptions } from '../services/apiClient';
import type {
  CreateMemoryPayload,
  MemoryCounts,
  MemoryExtractionRun,
  MemoryFilters,
  MemoryListResponse,
  MemoryPatchPayload,
  MemoryRecord,
  MemoryToastState,
  MemoryUpdatedEvent,
} from '../types/memory';
import { useWebSocket } from './useWebSocket';

interface MemoryContextState {
  profileId: string;
  projectPath: string;
  sessionId?: string;
}

const DEFAULT_FILTERS: MemoryFilters = {
  scope: 'project',
  statuses: ['active'],
  categories: [],
  query: '',
  limit: 50,
  offset: 0,
};

function emptyCounts(): MemoryCounts {
  return {
    projectActive: 0,
    globalActive: 0,
    globalPending: 0,
    archived: 0,
    failedExtractions: 0,
    pinnedOverflow: false,
  };
}

function requestJson<T>(url: string, options?: ApiRequestOptions<unknown>): Promise<T> {
  return apiRequest<T, unknown>(url, {
    ...options,
    fallbackMessage: 'Memory request failed',
  });
}

function jsonOptions(method: string, body: unknown): ApiRequestOptions<unknown> {
  return { method, body };
}

function failedExtractionWarning(count: number): string {
  const noun = count === 1 ? 'extraction' : 'extractions';
  return `${count} memory ${noun} failed`;
}

export function useMemories(options: { clientId: string; autoConnect?: boolean }) {
  const context = ref<MemoryContextState>();
  const memories = ref<MemoryRecord[]>([]);
  const total = ref(0);
  const counts = ref<MemoryCounts>(emptyCounts());
  const failedExtractions = ref<MemoryExtractionRun[]>([]);
  const filters = ref<MemoryFilters>({ ...DEFAULT_FILTERS });
  const loading = ref(false);
  const error = ref<string | null>(null);
  const warning = ref<string | null>(null);
  const toast = ref<MemoryToastState | null>(null);
  const { on } = useWebSocket({ autoConnect: options.autoConnect });

  function setContext(next: MemoryContextState): void {
    const changed = context.value?.profileId !== next.profileId
      || context.value?.projectPath !== next.projectPath
      || context.value?.sessionId !== next.sessionId;
    context.value = { ...next };
    if (!changed) return;
    memories.value = [];
    total.value = 0;
    failedExtractions.value = [];
    filters.value = { ...filters.value, offset: 0, extractionRunId: undefined };
    error.value = null;
  }

  function requireContext(): MemoryContextState {
    if (!context.value?.profileId || !context.value.projectPath) {
      throw new Error('Memory context is not set');
    }
    return context.value;
  }

  function queryContext(): URLSearchParams {
    const current = requireContext();
    return new URLSearchParams({ clientId: options.clientId, projectPath: current.projectPath });
  }

  function mutationContext(): Record<string, string> {
    const current = requireContext();
    return {
      clientId: options.clientId,
      projectPath: current.projectPath,
      ...(current.sessionId ? { sessionId: current.sessionId } : {}),
    };
  }

  function setError(caught: unknown): string {
    const message = caught instanceof Error ? caught.message : String(caught);
    error.value = message;
    return message;
  }

  async function fetchMemoryPage(current: MemoryFilters): Promise<MemoryListResponse> {
    const params = queryContext();
    params.set('scope', current.scope);
    if (current.statuses.length) params.set('statuses', current.statuses.join(','));
    if (current.categories.length) params.set('categories', current.categories.join(','));
    if (current.query.trim()) params.set('query', current.query.trim());
    if (current.extractionRunId) params.set('extractionRunId', current.extractionRunId);
    params.set('limit', String(current.limit));
    params.set('offset', String(current.offset));
    return requestJson<MemoryListResponse>(`/api/memories?${params.toString()}`);
  }

  async function loadMemories(overrides: Partial<MemoryFilters> = {}): Promise<void> {
    filters.value = { ...filters.value, ...overrides, offset: overrides.offset ?? 0 };
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchMemoryPage(filters.value);
      memories.value = result.memories;
      total.value = result.total;
    } catch (caught) {
      setError(caught);
    } finally {
      loading.value = false;
    }
  }

  async function loadMoreMemories(): Promise<void> {
    if (loading.value || memories.value.length >= total.value) return;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchMemoryPage({ ...filters.value, offset: memories.value.length });
      memories.value = [...memories.value, ...result.memories];
      total.value = result.total;
    } catch (caught) {
      setError(caught);
    } finally {
      loading.value = false;
    }
  }

  async function loadCounts(): Promise<void> {
    error.value = null;
    try {
      const result = await requestJson<{ counts: MemoryCounts }>(`/api/memories/counts?${queryContext().toString()}`);
      counts.value = result.counts;
      if (result.counts.failedExtractions > 0) {
        await loadFailedExtractions();
        warning.value = failedExtractionWarning(result.counts.failedExtractions);
      } else {
        failedExtractions.value = [];
        warning.value = null;
      }
    } catch (caught) {
      setError(caught);
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([loadMemories(), loadCounts()]);
  }

  async function mutate<T>(work: () => Promise<T>): Promise<T> {
    error.value = null;
    try {
      const result = await work();
      await refresh();
      return result;
    } catch (caught) {
      setError(caught);
      throw caught;
    }
  }

  async function createMemory(payload: CreateMemoryPayload): Promise<MemoryRecord> {
    return mutate(async () => {
      const result = await requestJson<{ memory: MemoryRecord }>(
        '/api/memories',
        jsonOptions('POST', { ...mutationContext(), ...payload }),
      );
      return result.memory;
    });
  }

  async function updateMemory(id: string, revision: number, patch: MemoryPatchPayload): Promise<MemoryRecord> {
    return mutate(async () => {
      const result = await requestJson<{ memory: MemoryRecord }>(
        `/api/memories/${encodeURIComponent(id)}`,
        jsonOptions('PATCH', { ...mutationContext(), expectedRevision: revision, ...patch }),
      );
      return result.memory;
    });
  }

  async function archiveMemory(id: string, revision: number): Promise<MemoryRecord> {
    return mutate(async () => {
      const result = await requestJson<{ memory: MemoryRecord }>(
        `/api/memories/${encodeURIComponent(id)}`,
        jsonOptions('PATCH', { ...mutationContext(), expectedRevision: revision, archive: true }),
      );
      return result.memory;
    });
  }

  async function restoreMemory(id: string, revision: number): Promise<MemoryRecord> {
    return mutate(async () => {
      const result = await requestJson<{ memory: MemoryRecord }>(
        `/api/memories/${encodeURIComponent(id)}/restore`,
        jsonOptions('POST', { ...mutationContext(), expectedRevision: revision }),
      );
      return result.memory;
    });
  }

  async function deleteMemory(id: string, revision: number): Promise<void> {
    await mutate(async () => {
      await requestJson(
        `/api/memories/${encodeURIComponent(id)}`,
        jsonOptions('DELETE', { ...mutationContext(), expectedRevision: revision }),
      );
    });
  }

  async function approveMemory(id: string, revision: number, patch?: MemoryPatchPayload): Promise<MemoryRecord> {
    return mutate(async () => {
      const result = await requestJson<{ memory: MemoryRecord }>(
        `/api/memories/${encodeURIComponent(id)}/approve`,
        jsonOptions('POST', { ...mutationContext(), expectedRevision: revision, ...patch }),
      );
      return result.memory;
    });
  }

  async function rejectMemory(id: string, revision: number): Promise<void> {
    await mutate(async () => {
      await requestJson(
        `/api/memories/${encodeURIComponent(id)}/reject`,
        jsonOptions('POST', { ...mutationContext(), expectedRevision: revision }),
      );
    });
  }

  async function extractSession(sessionId: string): Promise<void> {
    await mutate(async () => {
      await requestJson('/api/memories/extractions', jsonOptions('POST', {
        clientId: options.clientId,
        sessionId,
      }));
    });
  }

  async function loadFailedExtractions(): Promise<void> {
    const result = await requestJson<{ extractions: MemoryExtractionRun[] }>(
      `/api/memories/extractions/failed?${queryContext().toString()}`,
    );
    failedExtractions.value = result.extractions;
  }

  async function retryExtraction(runId: string): Promise<void> {
    await mutate(async () => {
      await requestJson(
        `/api/memories/extractions/${encodeURIComponent(runId)}/retry`,
        jsonOptions('POST', mutationContext()),
      );
    });
  }

  async function clearExtractionFailure(runId: string): Promise<void> {
    await mutate(async () => {
      await requestJson(
        `/api/memories/extractions/${encodeURIComponent(runId)}/clear`,
        jsonOptions('POST', mutationContext()),
      );
    });
  }

  async function undoExtraction(runId: string): Promise<void> {
    await mutate(async () => {
      await requestJson(
        `/api/memories/batches/${encodeURIComponent(runId)}/undo`,
        jsonOptions('POST', mutationContext()),
      );
    });
  }

  function dismissToast(): void {
    toast.value = null;
  }

  const unsubscribeUpdated = on('memory_updated', (event: MemoryUpdatedEvent) => {
    if (!context.value || event.profileId !== context.value.profileId) return;
    if (event.failed) {
      warning.value = 'Memory extraction failed';
      toast.value = null;
    } else if (event.activeProjectCount > 0 || event.pendingGlobalCount > 0) {
      toast.value = {
        extractionRunId: event.extractionRunId,
        activeProjectCount: event.activeProjectCount,
        pendingGlobalCount: event.pendingGlobalCount,
        failed: false,
      };
    } else {
      toast.value = null;
    }
    void loadCounts();
  });

  onUnmounted(unsubscribeUpdated);

  return {
    context,
    memories,
    total,
    counts,
    failedExtractions,
    filters,
    loading,
    error,
    warning,
    toast,
    setContext,
    loadMemories,
    loadMoreMemories,
    loadCounts,
    createMemory,
    updateMemory,
    archiveMemory,
    restoreMemory,
    deleteMemory,
    approveMemory,
    rejectMemory,
    extractSession,
    retryExtraction,
    clearExtractionFailure,
    undoExtraction,
    dismissToast,
  };
}

export type MemoryController = ReturnType<typeof useMemories>;
