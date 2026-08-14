<!-- client/src/components/FileSearchMenu.vue -->
<template>
  <div v-if="isOpen" ref="menuRef" class="file-search-menu" role="listbox" :aria-label="t('components.fileSearchMenu.fileSearchResults')">
    <div class="file-search-header">
      <span class="header-label">{{ query ? t('components.fileSearchMenu.searchResults') : t('components.fileSearchMenu.recentFiles') }}</span>
      <span v-if="query" class="header-query">{{ query }}</span>
    </div>
    
    <div v-if="isLoading" class="loading-indicator">
      <span>{{ t('components.fileSearchMenu.loading') }}</span>
    </div>
    
    <div v-else-if="files.length === 0" class="empty-state">
      <span class="empty-icon">🔍</span>
      <span class="empty-text">{{ t('components.fileSearchMenu.noFilesFound') }}</span>
      <span class="empty-hint">{{ t('components.fileSearchMenu.tryADifferentSearchTerm') }}</span>
    </div>
    
    <div v-else class="file-search-list">
      <button
        v-for="(file, index) in files"
        :key="file.path"
        type="button"
        class="file-search-item"
        :class="{ active: index === activeIndex }"
        role="option"
        :aria-selected="index === activeIndex"
        @mousedown.prevent
        @click="$emit('select', file)"
      >
        <span class="file-icon">📄</span>
        <div class="file-info">
          <span class="file-label">
            <span class="file-directory">{{ file.directory }}/</span><span class="file-name">{{ file.name }}</span>
          </span>
        </div>
        <span v-if="file.isRecent" class="recent-badge">{{ t('components.fileSearchMenu.recent') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { nextTick, ref, watch } from 'vue';
import type { FileSearchResult } from '../types/fileSearch';

const t = i18n.global.t;

const props = defineProps<{
  files: FileSearchResult[];
  activeIndex: number;
  isLoading: boolean;
  query: string;
  isOpen: boolean;
}>();

defineEmits<{
  select: [file: FileSearchResult];
}>();

const menuRef = ref<HTMLElement | null>(null);

async function scrollActiveItemIntoView() {
  await nextTick();
  const activeItem = menuRef.value?.querySelector<HTMLElement>('.file-search-item.active');
  activeItem?.scrollIntoView({ block: 'nearest' });
}

watch(() => props.activeIndex, () => {
  scrollActiveItemIntoView();
});
</script>

<style scoped>
.file-search-menu {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: calc(100% - 0.75rem);
  z-index: 20;
  max-height: 320px;
  overflow-y: auto;
  padding: 0.375rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
}

.file-search-header {
  padding: 0.75rem 1rem 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}

.header-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.header-query {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  font-family: monospace;
}

.loading-indicator {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.empty-state {
  padding: 2rem 1rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty-icon {
  font-size: 2rem;
}

.empty-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.file-search-list {
  padding: 0.25rem 0;
}

.file-search-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  color: var(--text-primary);
  background: transparent;
  border: 0;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
}

.file-search-item:hover,
.file-search-item.active {
  background: var(--bg-surface);
}

.file-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
}

.file-directory {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 0.8rem;
}

.file-name {
  font-weight: 600;
}

.recent-badge {
  flex-shrink: 0;
  padding: 0.2rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.7rem;
  text-transform: uppercase;
}
</style>
