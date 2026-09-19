<template>
  <section
    class="git-tool-panel"
    :class="{ 'is-resizing': resizing }"
    :style="{ height: `${panelHeight}px` }"
    :aria-label="t('components.gitToolPanel.title')"
  >
    <div
      class="git-tool-resize-handle"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="t('components.gitToolPanel.resize')"
      :aria-valuenow="panelHeight"
      @pointerdown.prevent="startResize"
      @dblclick.stop="resetHeight"
    />
    <div class="git-tool-toolbar" role="toolbar" :aria-label="t('components.gitToolPanel.actions')">
      <button
        type="button"
        class="git-tool-action tooltip"
        :data-tooltip="t('components.gitToolPanel.refresh')"
        :aria-label="t('components.gitToolPanel.refresh')"
        @click="refresh"
      >
        <PhArrowsClockwise :size="17" weight="bold" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="git-tool-action tooltip"
        :data-tooltip="t('components.gitToolPanel.changesView')"
        :aria-label="t('components.gitToolPanel.changesView')"
        :disabled="!isRepository"
        @click="emit('changes')"
      >
        <PhGitCommit :size="17" weight="bold" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="git-tool-action tooltip"
        :data-tooltip="t('components.gitToolPanel.history')"
        :aria-label="t('components.gitToolPanel.history')"
        :disabled="!isRepository"
        @click="emit('history')"
      >
        <PhClockCounterClockwise :size="17" weight="bold" aria-hidden="true" />
      </button>
      <button
        v-for="action in actions"
        :key="action.command"
        type="button"
        class="git-tool-action tooltip"
        :disabled="!isRepository"
        :data-tooltip="action.label"
        :aria-label="action.label"
        @click="emit('command', action.command)"
      >
        <component :is="action.icon" :size="17" weight="bold" aria-hidden="true" />
      </button>
    </div>

    <div class="git-tool-files" aria-live="polite">
      <p v-if="loading" class="git-tool-state">{{ t('components.gitToolPanel.loading') }}</p>
      <p v-else-if="error" class="git-tool-state git-tool-error">{{ error }}</p>
      <p v-else-if="!isRepository" class="git-tool-state">{{ t('components.gitToolPanel.notRepository') }}</p>
      <p v-else-if="files.length === 0" class="git-tool-state">{{ t('components.gitToolPanel.noChanges') }}</p>
      <ul v-else>
        <li v-for="file in files" :key="`${file.status}:${file.path}`">
          <button
            class="git-file-open"
            type="button"
            :title="file.path"
            :aria-label="`${file.path}: ${fileStatusLabel(file)}`"
            @click="openFile(file.path)"
          >
            <span class="git-file-status" :class="fileStatusKind(file)" :title="fileStatusLabel(file)" aria-hidden="true">
              <PhFolder v-if="file.path.endsWith('/')" :size="19" weight="regular" />
              <PhFileText v-else-if="fileStatusKind(file) === 'modified'" :size="19" weight="regular" />
              <PhFile v-else :size="19" weight="regular" />
              <span v-if="fileStatusKind(file) === 'missing'" class="git-file-status-badge"><PhQuestion :size="10" weight="bold" /></span>
              <span v-else-if="fileStatusKind(file) === 'staged'" class="git-file-status-badge"><PhCheck :size="10" weight="bold" /></span>
            </span>
            <span class="git-file-path">{{ file.path }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  PhArrowsClockwise,
  PhCheck,
  PhClockCounterClockwise,
  PhDownloadSimple,
  PhFile,
  PhFileText,
  PhFolder,
  PhGitBranch,
  PhGitCommit,
  PhGitPullRequest,
  PhQuestion,
} from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { createGitOperations } from '../services/gitOperations';

type FileStatusKind = 'modified' | 'untracked' | 'missing' | 'staged';

interface GitStatusFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
}

const DEFAULT_PANEL_HEIGHT = 240;
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT_RATIO = 0.75;

const props = defineProps<{ cwd: string }>();
const emit = defineEmits<{ command: [command: string]; changes: []; history: [] }>();
const t = i18n.global.t;
const gitOperations = createGitOperations();
const files = ref<GitStatusFile[]>([]);
const isRepository = ref(true);
const loading = ref(false);
const error = ref('');
const panelHeight = ref(DEFAULT_PANEL_HEIGHT);
const resizing = ref(false);
let requestId = 0;
let resizeStartY = 0;
let resizeStartHeight = 0;

const actions = computed(() => [
  { command: '/pr', label: t('components.gitToolPanel.pr'), icon: PhGitPullRequest },
  { command: '/pull', label: t('components.gitToolPanel.pull'), icon: PhDownloadSimple },
  { command: '/branch', label: t('components.gitToolPanel.branch'), icon: PhGitBranch },
] as const);

async function refresh(): Promise<void> {
  const currentRequestId = ++requestId;
  if (!props.cwd) {
    files.value = [];
    isRepository.value = true;
    loading.value = false;
    error.value = '';
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    const result = await gitOperations.getStatus({ cwd: props.cwd }) as { files?: GitStatusFile[]; isRepository?: boolean };
    if (currentRequestId === requestId) {
      files.value = result.files || [];
      isRepository.value = result.isRepository !== false;
    }
  } catch (cause) {
    if (currentRequestId !== requestId) return;
    files.value = [];
    error.value = cause instanceof Error ? cause.message : t('components.gitToolPanel.loadFailed');
  } finally {
    if (currentRequestId === requestId) loading.value = false;
  }
}

function fileStatusKind(file: GitStatusFile): FileStatusKind {
  if (file.staged) return 'staged';
  if (file.status === '??') return 'untracked';
  if (file.status.endsWith('D')) return 'missing';
  return 'modified';
}

function fileStatusLabel(file: GitStatusFile): string {
  const keys: Record<FileStatusKind, string> = {
    modified: 'modifiedNotStaged',
    untracked: 'untrackedNotStaged',
    missing: 'missing',
    staged: 'stagedForCommit',
  };
  return t(`components.gitChanges.${keys[fileStatusKind(file)]}`);
}

function openFile(path: string): void {
  window.dispatchEvent(new CustomEvent('open-file-in-editor', {
    detail: { path, kind: 'path' },
  }));
}

function resize(event: PointerEvent): void {
  const nextHeight = resizeStartHeight + resizeStartY - event.clientY;
  panelHeight.value = Math.min(
    window.innerHeight * MAX_PANEL_HEIGHT_RATIO,
    Math.max(MIN_PANEL_HEIGHT, nextHeight),
  );
}

function stopResize(): void {
  resizing.value = false;
  window.removeEventListener('pointermove', resize);
  window.removeEventListener('pointerup', stopResize);
  window.removeEventListener('pointercancel', stopResize);
}

function resetHeight(): void {
  stopResize();
  panelHeight.value = DEFAULT_PANEL_HEIGHT;
}

function startResize(event: PointerEvent): void {
  resizing.value = true;
  resizeStartY = event.clientY;
  resizeStartHeight = panelHeight.value;
  window.addEventListener('pointermove', resize);
  window.addEventListener('pointerup', stopResize);
  window.addEventListener('pointercancel', stopResize);
}

function handleGitStatusRefresh(): void {
  void refresh();
}

watch(() => props.cwd, () => void refresh());
onMounted(() => {
  window.addEventListener('refresh-git-status', handleGitStatusRefresh);
  void refresh();
});
onBeforeUnmount(() => {
  window.removeEventListener('refresh-git-status', handleGitStatusRefresh);
  stopResize();
});

defineExpose({ refresh });
</script>

<style scoped>
.git-tool-panel {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 120px;
  max-height: 75vh;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

.git-tool-resize-handle {
  position: absolute;
  top: -5px;
  right: 0;
  left: 0;
  z-index: 2;
  height: 10px;
  cursor: row-resize;
}

.git-tool-resize-handle::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 0;
  left: 0;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}

.git-tool-resize-handle:hover::after,
.is-resizing .git-tool-resize-handle::after {
  background: var(--accent);
}

.git-tool-toolbar {
  display: flex;
  justify-content: space-around;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.git-tool-action {
  width: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.git-tool-action:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.git-tool-action:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  z-index: 100;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  color: var(--text-primary);
  font-size: 0.75rem;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition: opacity var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.tooltip:hover::after,
.tooltip:focus-visible::after {
  opacity: 1;
}

.git-tool-action:first-child::after {
  left: 0;
  transform: none;
}

.git-tool-action:last-child::after {
  right: 0;
  left: auto;
  transform: none;
}

.git-tool-files {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 6px 8px 8px;
}

.git-tool-files ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.git-tool-files li {
  display: flex;
  min-width: 0;
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.git-tool-files li:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.git-file-open {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
  padding: 6px 4px;
  color: inherit;
  text-align: left;
}

.git-file-status {
  position: relative;
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.git-file-status.untracked {
  color: var(--text-muted);
}

.git-file-status.missing {
  color: var(--git-deleted);
}

.git-file-status.staged {
  color: var(--git-added);
}

.git-file-status-badge {
  position: absolute;
  right: -2px;
  bottom: -1px;
  display: inline-flex;
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bg-secondary);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: currentColor;
}

.git-file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-tool-state {
  margin: 0;
  padding: 10px 4px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

.git-tool-error {
  color: var(--error);
}
</style>
