<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop">
      <div class="folder-modal">
        <header class="modal-header">
          <h3>{{ title || t('components.folderPickerModal.openProject') }}</h3>
          <DialogCloseButton :label="t('components.folderPickerModal.cancel')" @click="$emit('close')" />
        </header>

        <div v-if="showClone && clientId" class="project-dialog-tabs" role="tablist" :aria-label="t('components.folderPickerModal.projectAction')">
          <button
            type="button"
            :class="{ active: activeTab === 'browse' }"
            role="tab"
            :aria-selected="activeTab === 'browse'"
            @click="activeTab = 'browse'"
          >
            {{ t('components.folderPickerModal.browse') }}
          </button>
          <button
            type="button"
            :class="{ active: activeTab === 'clone' }"
            role="tab"
            :aria-selected="activeTab === 'clone'"
            @click="activeTab = 'clone'"
          >
            {{ t('components.folderPickerModal.cloneRepository') }}
          </button>
          <button
            type="button"
            :class="{ active: activeTab === 'history' }"
            role="tab"
            :aria-selected="activeTab === 'history'"
            @click="openHistory"
          >
            {{ t('components.folderPickerModal.history') }}
          </button>
        </div>

        <template v-if="activeTab === 'browse'">
        <label class="selected-path-field">
          <span>{{ t('components.folderPickerModal.selectedPath') }}</span>
          <input
            v-model="pathInput"
            class="path-input"
            :title="t('components.folderPickerModal.enterPathHint')"
            @keydown.enter.prevent="browseEnteredPath"
          />
        </label>

        <div class="browse-toolbar">
          <label class="search-field">
            <PhMagnifyingGlass :size="15" class="search-icon" />
            <input
              v-model="searchQuery"
              class="search-input"
              :placeholder="t('components.folderPickerModal.searchFolders')"
              @keyup.escape="searchQuery = ''"
            />
          </label>
          <button
            class="toolbar-btn tooltip"
            type="button"
            :disabled="loading"
            @click="newFolderDialogVisible = true"
            :data-tooltip="t('components.folderPickerModal.newFolder')"
            :aria-label="t('components.folderPickerModal.createNewFolder')"
          >
            <PhFolderPlus :size="15" />
          </button>
          <button
            class="toolbar-btn tooltip"
            :class="{ active: directorySort === 'modified' }"
            type="button"
            @click="toggleDirectorySort"
            :data-tooltip="directorySort === 'modified' ? t('components.folderPickerModal.sortByModifiedDate') : t('components.folderPickerModal.sortByName')"
            :aria-label="directorySort === 'modified' ? t('components.folderPickerModal.sortByModifiedDate') : t('components.folderPickerModal.sortByName')"
            :aria-pressed="directorySort === 'modified'"
          >
            <PhTextAa v-if="directorySort === 'name'" :size="15" />
            <PhClockCounterClockwise v-else :size="15" />
          </button>
          <button
            class="toolbar-btn tooltip"
            :class="{ active: showHiddenFolders }"
            type="button"
            @click="toggleHiddenFolders"
            :data-tooltip="showHiddenFolders ? t('components.folderPickerModal.hideHiddenFolders') : t('components.folderPickerModal.showHiddenFolders')"
            :aria-label="showHiddenFolders ? t('components.folderPickerModal.hideHiddenFolders') : t('components.folderPickerModal.showHiddenFolders')"
            :aria-pressed="showHiddenFolders"
          >
            <PhEyeSlash v-if="showHiddenFolders" :size="15" />
            <PhEye v-else :size="15" />
          </button>
        </div>

        <div v-if="error" class="error-message">{{ error }}</div>

        <div class="directory-list">
          <button class="directory-row" @click="openPath(parentPath)" :disabled="!parentPath">
            <span class="folder-icon"><PhArrowLeft :size="16" /></span>
            <span>{{ t('components.folderPickerModal.parentFolder') }}</span>
          </button>

          <button
            v-for="directory in visibleDirectories"
            :key="directory.path"
            class="directory-row"
            @click="openPath(directory.path)"
          >
            <span class="folder-icon"><PhFolder :size="16" weight="fill" /></span>
            <span>{{ directory.name }}</span>
          </button>

          <div v-if="!isListLoading && visibleDirectories.length === 0" class="empty-state">
            {{ emptyMessage }}
          </div>

          <div v-if="isListLoading" class="empty-state">{{ t('components.folderPickerModal.loading') }}</div>
        </div>

        <div v-if="showRenameOption || showMoveOptions" class="history-option">
          <div class="action-label">{{ t('components.folderPickerModal.projectFolder') }}</div>

          <label v-if="showRenameOption" class="action-item" :class="{ active: moveMode === 'rename' }">
            <input v-model="moveMode" type="radio" name="moveMode" value="rename" />
            <div class="action-text">
              <span class="action-label-text">{{ t('components.folderPickerModal.renameProject') }}</span>
              <span class="action-hint">{{ t('components.folderPickerModal.renamesTheFolderAndUpdatesPiSession') }}</span>
            </div>
          </label>

          <template v-if="showMoveOptions">
            <label class="action-item" :class="{ active: moveMode === 'move-project' }">
              <input v-model="moveMode" type="radio" name="moveMode" value="move-project" />
              <div class="action-text">
                <span class="action-label-text">{{ t('components.folderPickerModal.moveProjectHere') }}</span>
                <span class="action-hint">{{ t('components.folderPickerModal.movesTheProjectFolderAndPiSessions') }}</span>
              </div>
            </label>

            <label class="action-item" :class="{ active: moveMode === 'move-sessions' }">
              <input v-model="moveMode" type="radio" name="moveMode" value="move-sessions" />
              <div class="action-text">
                <span class="action-label-text">{{ t('components.folderPickerModal.moveSessionsHere') }}</span>
                <span class="action-hint">{{ t('components.folderPickerModal.movesOnlyPiSessionHistoryToThe') }}</span>
              </div>
            </label>
          </template>

          <label v-if="showRenameOption && moveMode === 'rename'" class="project-name-field">
            <span>{{ t('components.folderPickerModal.folderName') }}</span>
            <input v-model="projectName" type="text" />
          </label>
        </div>

        <footer class="modal-footer">
          <button class="cancel-btn" @click="$emit('close')">{{ t('components.folderPickerModal.cancel') }}</button>
          <button class="use-btn" @click="selectCurrent">{{ t('components.folderPickerModal.useThisFolder') }}</button>
        </footer>
        </template>

        <CloneRepositoryModal
          v-else-if="activeTab === 'clone'"
          :visible="visible"
          :client-id="clientId"
          embedded
          @close="$emit('close')"
          @cloned="selectClonedProject"
        />

        <div v-else class="project-history-list">
          <div v-if="historyError" class="error-message">{{ historyError }}</div>
          <div v-if="historyLoading" class="empty-state">{{ t('components.folderPickerModal.loading') }}</div>
          <div v-else-if="projectHistory.length === 0" class="empty-state">
            {{ t('components.folderPickerModal.noProjectHistory') }}
          </div>
          <div v-for="entry in projectHistory" v-else :key="entry.path" class="project-history-row">
            <button class="project-history-project" type="button" @click="selectHistoryProject(entry.path)">
              <PhFolder :size="18" weight="fill" />
              <span class="project-history-details">
                <strong>{{ basenamePath(entry.path) }}</strong>
                <span :title="entry.path">{{ entry.path }}</span>
                <span>
                  {{ formatLastAccessed(entry.lastAccessed) }}
                  <template v-if="historyCounts[entry.path] !== undefined">
                    · {{ t('components.folderPickerModal.sessionCount', { count: historyCounts[entry.path] }) }}
                  </template>
                </span>
              </span>
            </button>
            <button
              class="history-remove-btn"
              type="button"
              :disabled="removingHistoryPath === entry.path"
              :title="t('components.folderPickerModal.removeHistory')"
              :aria-label="t('components.folderPickerModal.removeHistoryFor', { path: entry.path })"
              @click="removeHistory(entry.path)"
            >
              <PhTrash :size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <InputPromptModal
    :visible="newFolderDialogVisible"
    :title="t('components.folderPickerModal.createNewFolder')"
    :label="t('components.folderPickerModal.folderName')"
    :description="t('components.folderPickerModal.createFolderInside', { path: currentPath })"
    :confirm-text="t('components.folderPickerModal.createFolder')"
    @confirm="createFolder"
    @cancel="newFolderDialogVisible = false"
  >
    <template #icon><PhFolderPlus :size="20" weight="duotone" /></template>
  </InputPromptModal>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, ref, watch } from 'vue';
import { PhArrowLeft, PhClockCounterClockwise, PhEye, PhEyeSlash, PhFolder, PhFolderPlus, PhMagnifyingGlass, PhTextAa, PhTrash } from '@phosphor-icons/vue';
import CloneRepositoryModal from './CloneRepositoryModal.vue';
import DialogCloseButton from './DialogCloseButton.vue';
import InputPromptModal from './InputPromptModal.vue';

const t = i18n.global.t;

interface DirectoryNode {
  name: string;
  path: string;
  type: 'directory';
}

interface ProjectHistoryEntry {
  path: string;
  lastAccessed: number;
}

const props = withDefaults(defineProps<{
  visible: boolean;
  initialPath: string;
  currentProjectPath?: string;
  clientId?: string;
  title?: string;
  showClone?: boolean;
  projectHistory?: ProjectHistoryEntry[];
}>(), {
  clientId: '',
  title: undefined,
  showClone: true,
  projectHistory: () => [],
});

type MoveMode = 'rename' | 'move-project' | 'move-sessions';

const emit = defineEmits<{
  close: [];
  select: [payload: { path: string; moveMode?: MoveMode; projectName?: string; refreshProjectPaths?: boolean }];
  historyRemoved: [path: string];
}>();

const currentPath = ref('~');
const pathInput = ref('~');
const parentPath = ref('');
const directories = ref<DirectoryNode[]>([]);
const loading = ref(false);
const error = ref('');
const moveMode = ref<MoveMode | undefined>('rename');
const projectName = ref('');
const showHiddenFolders = ref(false);
const directorySort = ref<'name' | 'modified'>('modified');
const searchQuery = ref('');
const activeTab = ref<'browse' | 'history' | 'clone'>('browse');
const newFolderDialogVisible = ref(false);
const historyCounts = ref<Record<string, number>>({});
const historyLoading = ref(false);
const historyError = ref('');
const removingHistoryPath = ref('');

const currentProjectName = computed(() => basenamePath(props.currentProjectPath || ''));
const isCurrentProjectPath = computed(() => Boolean(props.currentProjectPath) && currentPath.value === props.currentProjectPath);
const showRenameOption = computed(() => isCurrentProjectPath.value);
const showMoveOptions = computed(() => Boolean(props.currentProjectPath) && !isCurrentProjectPath.value);
const isSearching = computed(() => searchQuery.value.trim().length > 0);
const visibleDirectories = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return directories.value;
  return directories.value.filter((directory) => directory.name.toLowerCase().includes(query));
});
const isListLoading = computed(() => loading.value);
const emptyMessage = computed(() => (isSearching.value ? t('components.folderPickerModal.noMatchingFoldersFound') : t('components.folderPickerModal.noVisibleSubfolders')));

watch(
  () => isCurrentProjectPath.value,
  (isCurrent) => {
    if (isCurrent) {
      moveMode.value = 'rename';
    } else if (moveMode.value === 'rename') {
      moveMode.value = undefined;
    }
  },
);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      moveMode.value = 'rename';
      projectName.value = currentProjectName.value;
      searchQuery.value = '';
      activeTab.value = 'browse';
      newFolderDialogVisible.value = false;
      browse(props.initialPath || '~');
    }
  },
  { immediate: true },
);

async function browse(path: string) {
  loading.value = true;
  error.value = '';

  try {
    const params = createTreeParams(path || '~', '1');
    const response = await fetch(`/api/files/tree?${params}`);
    if (!response.ok) throw new Error(t('components.folderPickerModal.browseFailedStatus', { status: response.status }));
    const data = await response.json();
    currentPath.value = data.path || path || '~';
    pathInput.value = currentPath.value;
    parentPath.value = data.parentPath || '';
    directories.value = data.tree || [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('components.folderPickerModal.failedToBrowseFolder');
  } finally {
    loading.value = false;
  }
}

function openPath(path: string) {
  if (!path) return;
  searchQuery.value = '';
  void browse(path);
}

function browseEnteredPath() {
  const enteredPath = pathInput.value.trim();
  if (!enteredPath) return;
  // On Windows, a bare drive letter means its current directory; users expect the drive root here.
  const targetPath = /^[A-Za-z]:$/.test(enteredPath) ? `${enteredPath}\\` : enteredPath;
  searchQuery.value = '';
  void browse(targetPath);
}

async function toggleDirectorySort() {
  directorySort.value = directorySort.value === 'name' ? 'modified' : 'name';
  await browse(currentPath.value);
}

async function toggleHiddenFolders() {
  showHiddenFolders.value = !showHiddenFolders.value;
  await browse(currentPath.value);
}

function createTreeParams(path: string, depth: string) {
  const params = new URLSearchParams({
    path,
    depth,
    type: 'directory',
    hidden: showHiddenFolders.value ? 'true' : 'false',
  });
  if (directorySort.value === 'modified') params.set('sort', 'modified');
  return params;
}

function selectClonedProject(payload: { projectPath: string }) {
  emit('select', { path: payload.projectPath, refreshProjectPaths: true });
}

async function openHistory() {
  activeTab.value = 'history';
  historyError.value = '';
  if (!props.clientId || props.projectHistory.length === 0) return;

  historyLoading.value = true;
  try {
    const response = await fetch('/api/sessions/project-history-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, projectPaths: props.projectHistory.map((entry) => entry.path) }),
    });
    if (!response.ok) throw new Error(t('components.folderPickerModal.failedToLoadHistory'));
    const data = await response.json() as { projects?: Array<{ path: string; sessionCount: number }> };
    historyCounts.value = Object.fromEntries((data.projects || []).map((project) => [project.path, project.sessionCount]));
  } catch (err) {
    historyError.value = err instanceof Error ? err.message : t('components.folderPickerModal.failedToLoadHistory');
  } finally {
    historyLoading.value = false;
  }
}

function selectHistoryProject(path: string) {
  emit('select', { path });
}

async function removeHistory(path: string) {
  if (!window.confirm(t('components.folderPickerModal.removeHistoryConfirm', { path }))) return;
  removingHistoryPath.value = path;
  historyError.value = '';
  try {
    const response = await fetch('/api/sessions/project-history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, projectPath: path }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('components.folderPickerModal.failedToRemoveHistory'));
    emit('historyRemoved', path);
  } catch (err) {
    historyError.value = err instanceof Error ? err.message : t('components.folderPickerModal.failedToRemoveHistory');
  } finally {
    removingHistoryPath.value = '';
  }
}

function formatLastAccessed(timestamp: number): string {
  if (!timestamp) return t('components.folderPickerModal.lastAccessedUnknown');
  return t('components.folderPickerModal.lastAccessed', { date: new Date(timestamp).toLocaleString() });
}

async function createFolder(value: string) {
  const folderName = value.trim();
  newFolderDialogVisible.value = false;

  if (!folderName || folderName === '.' || folderName === '..' || /[\\/]/.test(folderName)) {
    error.value = t('components.folderPickerModal.invalidFolderName');
    return;
  }

  const separator = currentPath.value.includes('\\') && !currentPath.value.includes('/') ? '\\' : '/';
  const folderPath = currentPath.value.endsWith('/') || currentPath.value.endsWith('\\')
    ? `${currentPath.value}${folderName}`
    : `${currentPath.value}${separator}${folderName}`;

  loading.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    if (response.status === 409) {
      error.value = t('components.folderPickerModal.folderAlreadyExists');
      return;
    }
    if (!response.ok) {
      throw new Error(t('components.folderPickerModal.createFolderFailedStatus', { status: response.status }));
    }

    const data = await response.json();
    await browse(data.path || folderPath);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('components.folderPickerModal.failedToCreateFolder');
  } finally {
    loading.value = false;
  }
}

function selectCurrent() {
  const isRename = moveMode.value === 'rename' && showRenameOption.value;
  const isMoveProject = moveMode.value === 'move-project' && showMoveOptions.value;
  const isMoveSessions = moveMode.value === 'move-sessions' && showMoveOptions.value;
  const shouldMove = isMoveProject || isMoveSessions;

  emit('select', {
    path: shouldMove ? currentPath.value : (isRename ? dirnamePath(currentPath.value) : currentPath.value),
    moveMode: (isRename || isMoveProject || isMoveSessions) ? moveMode.value : undefined,
    projectName: isRename ? projectName.value.trim() || currentProjectName.value : currentProjectName.value,
  });
}

function basenamePath(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

function dirnamePath(path: string): string {
  if (!path || path === '/' || path === '~') return '';
  if (path.startsWith('~/')) {
    const relative = path.slice(2).replace(/\/$/, '');
    const index = relative.lastIndexOf('/');
    return index === -1 ? '~' : `~/${relative.slice(0, index)}`;
  }
  const trimmed = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return '/';
  return trimmed.slice(0, index);
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.folder-modal {
  width: min(560px, calc(100vw - 2rem));
  max-height: min(680px, calc(100vh - 2rem));
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
}

.modal-header,
.modal-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
}

.modal-header {
  justify-content: space-between;
}

.modal-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  border-bottom: 0;
}

.project-dialog-tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.project-dialog-tabs button {
  flex: 1;
  padding: 0.45rem 0.65rem;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.project-dialog-tabs button:hover,
.project-dialog-tabs button.active {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.project-dialog-tabs button.active {
  color: var(--accent);
}

.selected-path-field {
  display: grid;
  gap: 0.35rem;
  padding: 0.75rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  border-bottom: 1px solid var(--border);
}

.browse-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.path-input {
  width: 100%;
  min-width: 0;
  padding: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.search-field {
  flex: 1 1 auto;
  min-width: 130px;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.5rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.search-field:focus-within {
  background: var(--bg-secondary);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.search-input {
  width: 100%;
  min-width: 0;
  padding: 0.5rem 0;
  color: var(--text-primary);
  background: transparent;
  border: 0;
  outline: 0;
}

.search-input:focus {
  box-shadow: none;
}

.search-input::placeholder {
  color: var(--text-secondary);
}

.search-icon {
  color: var(--text-secondary);
  flex: 0 0 auto;
  transition: color var(--duration-fast) var(--ease-out);
}

.search-field:focus-within .search-icon {
  color: var(--accent);
}

.directory-list {
  overflow: auto;
  padding: 0.5rem;
}

.project-history-list {
  min-height: 240px;
  overflow: auto;
  padding: 0.5rem;
}

.project-history-row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
}

.project-history-row:hover {
  background: var(--bg-surface);
}

.project-history-project {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem;
  color: var(--text-primary);
  text-align: left;
}

.project-history-details {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.project-history-details span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-remove-btn {
  margin-right: 0.4rem;
  padding: 0.45rem;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.history-remove-btn:hover:not(:disabled) {
  color: var(--error);
  background: var(--error-muted);
}

.history-remove-btn:disabled {
  opacity: 0.45;
}

.history-option {
  padding: 0.75rem;
  border-top: 1px solid var(--border);
}

.history-option .action-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0.5rem;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.action-item:hover {
  background: var(--bg-surface);
}

.action-item.active {
  background: var(--accent-muted);
}

.action-item input[type="radio"] {
  accent-color: var(--accent);
  cursor: pointer;
  flex: 0 0 auto;
}

.action-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.action-label-text {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.action-hint {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.project-name-field {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.project-name-field input {
  padding: 0.45rem 0.5rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.directory-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background var(--duration-fast) var(--ease-out);
}

.directory-row:hover:not(:disabled) {
  background: var(--bg-surface);
}

.directory-row:active:not(:disabled) {
  transform: scale(0.98);
}

.directory-row:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}


.error-message {
  margin: 0.75rem;
  padding: 0.5rem;
  color: var(--error);
  background: var(--error-muted);
  border: 1px solid rgba(248, 113, 113, 0.25);
  border-radius: var(--radius-sm);
}

.empty-state {
  padding: 1rem;
  color: var(--text-secondary);
  text-align: center;
}

.use-btn {
  background: var(--accent);
  color: white;
  transition: background var(--duration-fast) var(--ease-out);
}

.use-btn:hover {
  background: var(--accent-hover);
}

.toolbar-btn {
  position: relative;
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.toolbar-btn:hover:not(:disabled),
.toolbar-btn.active {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.toolbar-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-btn.active {
  color: var(--accent);
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  padding: 4px 10px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  font-size: 0.75rem;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.tooltip:hover::after {
  opacity: 1;
}

.cancel-btn,
.use-btn,
.icon-btn {
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius-sm);
}
</style>
