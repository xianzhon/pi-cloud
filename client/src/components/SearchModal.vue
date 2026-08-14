<!-- client/src/components/SearchModal.vue -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-backdrop">
        <div class="search-modal" @keydown="handleKeydown">
          <!-- Search Header -->
          <div class="search-header">
            <div class="search-input-wrapper" :class="{ 'result-focused': focusedIndex >= 0 }">
              <PhMagnifyingGlass :size="18" weight="bold" class="search-icon" />
              <input
                ref="searchInputRef"
                v-model="query"
                type="text"
                class="search-input"
                :placeholder="t('components.searchModal.searchSessions')"
                @input="handleInput"
                autofocus
              />
              <kbd class="shortcut-hint">ESC</kbd>
              <button class="search-close-btn" type="button" :aria-label="t('components.searchModal.closeSearch')" @click="close">
                <PhX :size="18" weight="bold" aria-hidden="true" />
              </button>
            </div>

            <!-- Scope Toggle -->
            <div class="scope-toggle">
              <button
                type="button"
                :class="{ active: scope === 'project' }"
                :aria-pressed="scope === 'project'"
                @click="setScope('project')"
              >
                {{ t('components.searchModal.project') }}
              </button>
              <button
                type="button"
                :class="{ active: scope === 'all' }"
                :aria-pressed="scope === 'all'"
                @click="setScope('all')"
              >
                {{ t('components.searchModal.allSessions') }}
              </button>
            </div>
          </div>

          <!-- Results -->
          <div class="search-results">
            <div v-if="isLoading" class="loading-state">
              <span class="loading-spinner"></span>
              {{ t('components.searchModal.searching') }}
            </div>

            <div v-else-if="query.trim() && results.length === 0" class="empty-state">
              {{ t('components.searchModal.noResultsFound') }}
            </div>

            <div v-else-if="!query.trim()" class="hint-state">
              {{ t('components.searchModal.typeToSearchAcrossSessionMessages') }}
            </div>

            <template v-else>
              <div class="results-count">
                {{ total }} result{{ total !== 1 ? 's' : '' }} found
              </div>

              <div class="results-list" :class="{ 'keyboard-navigation': navigationMode === 'keyboard' }" ref="resultsListRef">
                <div
                  v-for="(result, index) in displayedResults"
                  :key="result.id"
                  class="result-item"
                  :class="{ focused: focusedIndex === index }"
                  @click="selectResult(result)"
                  @mouseenter="handleResultMouseEnter(index)"
                >
                  <div class="result-header">
                    <span class="result-title">{{ formatTitle(result) }}</span>
                    <span class="result-meta">{{ t('components.searchModal.messageCount', { count: result.messageCount }) }}</span>
                  </div>

                  <div
                    class="result-snippet"
                    v-html="highlightSnippet(result.snippet)"
                  />

                  <div class="result-footer">
                    <span v-if="scope === 'all' && result.cwd" class="result-path">
                      {{ formatPath(result.cwd) }}
                    </span>
                    <span class="result-date">{{ formatDate(result.created) }}</span>
                    <span class="match-count">{{ t(result.matchCount === 1 ? 'components.searchModal.matchCount' : 'components.searchModal.matchesCount', { count: result.matchCount }) }}</span>
                  </div>
                </div>
              </div>

              <button
                v-if="displayedResults.length < results.length"
                class="load-more-btn"
                @click="loadMore"
              >
                {{ t('components.searchModal.loadMore') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { ref, computed, watch, nextTick } from 'vue';
import { useSearch } from '../composables/useSearch';
import type { SearchResult } from '../composables/useSearch';
import { PhMagnifyingGlass, PhX } from '@phosphor-icons/vue';

const t = i18n.global.t;

const props = defineProps<{
  isOpen: boolean;
  projectPath?: string;
}>();

const emit = defineEmits<{
  close: [];
  selectSession: [sessionId: string];
}>();

const {
  query,
  scope,
  results,
  total,
  isLoading,
  displayCount,
  search,
  debouncedSearch,
  loadMore,
  setScope,
} = useSearch();

const searchInputRef = ref<HTMLInputElement>();
const focusedIndex = ref(-1);
const navigationMode = ref<'mouse' | 'keyboard'>('mouse');
const resultsListRef = ref<HTMLElement>();

const displayedResults = computed(() => {
  return results.value.slice(0, displayCount.value);
});

// Focus input when modal opens
watch(() => props.isOpen, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    searchInputRef.value?.focus();
    focusedIndex.value = -1;
    navigationMode.value = 'mouse';
  }
});

// Reset focused index when results change
watch(displayedResults, () => {
  focusedIndex.value = -1;
  navigationMode.value = 'mouse';
});

function handleInput() {
  focusedIndex.value = -1;
  navigationMode.value = 'mouse';
  debouncedSearch(props.projectPath);
}

function handleKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'Escape':
      close();
      break;
    case 'ArrowDown':
      event.preventDefault();
      navigateResults(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      navigateResults(-1);
      break;
    case 'Enter':
      // Let Enter activate the currently focused result while typing in the search input.
      // Keep native button/select behavior intact.
      const activeElement = document.activeElement;
      const isInteractiveElement = activeElement?.tagName === 'BUTTON' ||
                                    activeElement?.tagName === 'TEXTAREA' ||
                                    activeElement?.tagName === 'SELECT';

      if (!isInteractiveElement && focusedIndex.value >= 0 && focusedIndex.value < displayedResults.value.length) {
        event.preventDefault();
        selectResult(displayedResults.value[focusedIndex.value]);
      }
      break;
    case 'Tab':
      trapFocus(event);
      break;
  }
}

function trapFocus(event: KeyboardEvent) {
  const modal = document.querySelector('.search-modal');
  if (!modal) return;

  const focusableElements = modal.querySelectorAll<HTMLElement>(
    'input, button, [tabindex]:not([tabindex="-1"])'
  );
  
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey) {
    // Shift + Tab: go to last element if at first
    if (document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    }
  } else {
    // Tab: go to first element if at last
    if (document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }
}

function handleResultMouseEnter(index: number) {
  navigationMode.value = 'mouse';
  focusedIndex.value = index;
}

function navigateResults(direction: number) {
  const maxIndex = displayedResults.value.length - 1;
  if (maxIndex < 0) return;

  navigationMode.value = 'keyboard';

  if (focusedIndex.value === -1) {
    focusedIndex.value = direction > 0 ? 0 : maxIndex;
  } else {
    const newIndex = focusedIndex.value + direction;
    
    // At the end going down - trigger load more if available
    if (newIndex > maxIndex && direction > 0) {
      if (displayedResults.value.length < results.value.length) {
        loadMore();
        // Stay at current index, new items will appear below
        return;
      }
      return;
    }
    
    // Stop at beginning, don't cycle
    if (newIndex < 0) return;
    focusedIndex.value = newIndex;
  }

  // Scroll the focused item into view
  nextTick(() => {
    const items = resultsListRef.value?.querySelectorAll('.result-item');
    items?.[focusedIndex.value]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function close() {
  focusedIndex.value = -1;
  navigationMode.value = 'mouse';
  emit('close');
}

function selectResult(result: SearchResult) {
  emit('selectSession', result.id);
  close();
}

function formatTitle(result: SearchResult): string {
  if (result.name) return result.name;
  if (result.firstMessage) {
    const skillMatch = result.firstMessage.match(/^<skill\s+name="([^"]+)"/);
    if (skillMatch) return skillMatch[1];
    return result.firstMessage.slice(0, 50);
  }
  return result.id.slice(0, 8);
}

function formatPath(path: string): string {
  return path
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('components.searchModal.justNow');
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function highlightSnippet(snippet: string): string {
  if (!query.value.trim()) return escapeHtml(snippet);

  const escapedQuery = query.value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return escapeHtml(snippet).replace(regex, '<mark>$1</mark>');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.search-modal {
  width: min(640px, calc(100vw - 2rem));
  max-height: 70vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-xl);
}

.search-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border);
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 0.75rem;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.search-input-wrapper:focus-within {
  background: var(--bg-secondary);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.search-input-wrapper.result-focused {
  background: var(--bg-primary);
  border-color: var(--border);
  box-shadow: none;
}

.search-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: color var(--duration-fast) var(--ease-out);
}

.search-input-wrapper:focus-within .search-icon {
  color: var(--accent);
}

.search-input-wrapper.result-focused .search-icon {
  color: var(--text-tertiary);
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 1rem;
  color: var(--text-primary);
}

.search-input:focus {
  box-shadow: none;
}

.search-input::placeholder {
  color: var(--text-secondary);
}

.shortcut-hint {
  padding: 0.25rem 0.5rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-family: monospace;
  color: var(--text-tertiary);
}

.search-close-btn {
  display: inline-flex;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 1.5rem;
  line-height: 1;
}

.search-close-btn:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.scope-toggle {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.scope-toggle button {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.scope-toggle button.active {
  background: var(--accent-muted);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.scope-toggle button:hover:not(.active) {
  color: var(--text-primary);
}

.search-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
}

.loading-state,
.empty-state,
.hint-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.results-count {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin-bottom: 0.75rem;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.result-item {
  padding: 1rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.result-item:hover,
.result-item.focused {
  border-color: var(--accent);
  background: var(--bg-surface);
}

.results-list.keyboard-navigation .result-item:hover:not(.focused) {
  border-color: var(--border);
  background: var(--bg-primary);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.result-title {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  font-size: 0.75rem;
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-left: 0.75rem;
}

.result-snippet {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 0.5rem;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.result-snippet :deep(mark) {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 0.125rem 0.25rem;
  border-radius: 2px;
}

.result-footer {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.result-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.result-date,
.match-count {
  flex-shrink: 0;
}

.load-more-btn {
  width: 100%;
  padding: 0.75rem;
  margin-top: 0.75rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.load-more-btn:hover {
  background: var(--bg-elevated);
  border-color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .modal-backdrop {
    align-items: stretch;
    padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem max(0.75rem, env(safe-area-inset-bottom));
  }

  .search-modal {
    width: 100%;
    max-height: none;
  }

  .shortcut-hint {
    display: none;
  }
}

/* Transition */
.modal-enter-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}

.modal-leave-active {
  transition: opacity 100ms var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
