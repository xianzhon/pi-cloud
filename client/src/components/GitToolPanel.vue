<template>
  <section class="git-tool-panel" :aria-label="t('components.gitToolPanel.title')">
    <div class="git-tool-toolbar" role="toolbar" :aria-label="t('components.gitToolPanel.actions')">
      <button
        v-for="action in actions"
        :key="action.command"
        type="button"
        class="git-tool-action"
        :disabled="action.command === '/commit' && files.length === 0"
        :title="action.label"
        @click="runAction(action.command)"
      >
        <component :is="action.icon" :size="15" weight="bold" aria-hidden="true" />
        <span>{{ action.label }}</span>
      </button>
    </div>

    <div class="git-tool-files" aria-live="polite">
      <p v-if="loading" class="git-tool-state">{{ t('components.gitToolPanel.loading') }}</p>
      <p v-else-if="error" class="git-tool-state git-tool-error">{{ error }}</p>
      <p v-else-if="files.length === 0" class="git-tool-state">{{ t('components.gitToolPanel.noChanges') }}</p>
      <ul v-else>
        <li v-for="file in files" :key="`${file.status}:${file.path}`" :title="file.path">
          <span class="git-file-status">{{ file.status }}</span>
          <span class="git-file-path">{{ file.path }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  PhArrowsClockwise,
  PhGitBranch,
  PhGitCommit,
  PhGitPullRequest,
  PhUploadSimple,
  PhDownloadSimple,
} from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { createGitOperations } from '../services/gitOperations';

interface GitStatusFile {
  path: string;
  status: string;
}

const props = defineProps<{ cwd: string }>();
const emit = defineEmits<{ command: [command: string] }>();
const t = i18n.global.t;
const gitOperations = createGitOperations();
const files = ref<GitStatusFile[]>([]);
const loading = ref(false);
const error = ref('');
let requestId = 0;

const actions = computed(() => [
  { command: '/status', label: t('components.gitToolPanel.refresh'), icon: PhArrowsClockwise },
  { command: '/commit', label: t('components.gitToolPanel.commit'), icon: PhGitCommit },
  { command: '/push', label: t('components.gitToolPanel.push'), icon: PhUploadSimple },
  { command: '/pull', label: t('components.gitToolPanel.pull'), icon: PhDownloadSimple },
  { command: '/branch', label: t('components.gitToolPanel.branch'), icon: PhGitBranch },
  { command: '/pr', label: t('components.gitToolPanel.pr'), icon: PhGitPullRequest },
] as const);

async function refresh(): Promise<void> {
  const currentRequestId = ++requestId;
  if (!props.cwd) {
    files.value = [];
    loading.value = false;
    error.value = '';
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    const result = await gitOperations.getStatus({ cwd: props.cwd }) as { files?: GitStatusFile[] };
    if (currentRequestId === requestId) files.value = result.files || [];
  } catch (cause) {
    if (currentRequestId !== requestId) return;
    files.value = [];
    error.value = cause instanceof Error ? cause.message : t('components.gitToolPanel.loadFailed');
  } finally {
    if (currentRequestId === requestId) loading.value = false;
  }
}

function runAction(command: string): void {
  emit('command', command);
  if (command === '/status') void refresh();
}

watch(() => props.cwd, () => void refresh());
onMounted(() => void refresh());

defineExpose({ refresh });
</script>

<style scoped>
.git-tool-panel {
  flex: 0 0 auto;
  max-height: 240px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

.git-tool-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.git-tool-action {
  min-width: 0;
  padding: 5px 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.git-tool-action:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.git-tool-action:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.git-tool-files {
  max-height: 150px;
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
  gap: 7px;
  padding: 4px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.git-file-status {
  flex: 0 0 1.5rem;
  color: var(--accent);
  font-weight: 600;
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
