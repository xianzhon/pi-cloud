// client/src/composables/useSearch.ts
import { ref } from 'vue';
import { getTabClientId } from '../utils/tabClientId';

export interface SearchResult {
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

export function useSearch() {
  const query = ref('');
  const scope = ref<'project' | 'all'>('all');
  const results = ref<SearchResult[]>([]);
  const total = ref(0);
  const isLoading = ref(false);
  const isOpen = ref(false);
  const displayCount = ref(10);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function search(projectPath?: string) {
    if (!query.value.trim()) {
      results.value = [];
      total.value = 0;
      return;
    }

    isLoading.value = true;

    try {
      const clientId = getTabClientId();
      const params = new URLSearchParams({
        clientId,
        q: query.value.trim(),
        scope: scope.value,
      });

      if (scope.value === 'project' && projectPath) {
        params.set('projectPath', projectPath);
      }

      const response = await fetch(`/api/sessions/search?${params}`);
      const data = await response.json();

      results.value = data.results || [];
      total.value = data.total || 0;
      displayCount.value = 10;
    } catch (error) {
      console.error('Search failed:', error);
      results.value = [];
      total.value = 0;
    } finally {
      isLoading.value = false;
    }
  }

  function debouncedSearch(projectPath?: string) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => search(projectPath), 300);
  }

  function loadMore() {
    displayCount.value += 10;
  }

  function open() {
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
    query.value = '';
    results.value = [];
    total.value = 0;
    displayCount.value = 10;
  }

  function setScope(newScope: 'project' | 'all', projectPath?: string) {
    scope.value = newScope;
    if (query.value.trim()) {
      search(projectPath);
    }
  }

  return {
    query,
    scope,
    results,
    total,
    isLoading,
    isOpen,
    displayCount,
    search,
    debouncedSearch,
    loadMore,
    open,
    close,
    setScope,
  };
}
