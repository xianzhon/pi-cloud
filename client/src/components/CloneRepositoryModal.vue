<template>
  <Teleport to="body" :disabled="embedded">
    <div v-if="visible" class="modal-overlay" :class="{ embedded }" @click.self="requestClose">
      <div class="modal clone-repository-modal">
        <header v-if="!embedded" class="modal-header">
          <h3>{{ t('components.cloneRepositoryModal.cloneRepository') }}</h3>
          <button type="button" class="icon-button" @click="requestClose">×</button>
        </header>

        <section v-if="existingPath" class="clone-existing-state">
          <h4>{{ t('components.cloneRepositoryModal.folderAlreadyExists') }}</h4>
          <p><strong>{{ existingPath }}</strong> {{ t('components.cloneRepositoryModal.alreadyExists') }}</p>
          <div class="clone-actions">
            <button class="dialog-action" data-testid="clone-use-existing-button" type="button" @click="useExistingFolder">{{ t('components.cloneRepositoryModal.useExistingFolder') }}</button>
            <button class="dialog-action" type="button" @click="existingPath = ''">{{ t('components.cloneRepositoryModal.chooseAnotherPath') }}</button>
            <button class="dialog-action" type="button" @click="emit('close')">{{ t('components.cloneRepositoryModal.cancel') }}</button>
          </div>
        </section>

        <section v-else class="clone-form">
          <label>
            {{ t('components.cloneRepositoryModal.gitURL') }}
            <input data-testid="clone-url-input" v-model="remoteUrl" class="modal-input" placeholder="https://github.com/owner/repo.git" :disabled="isRunning" />
          </label>
          <label>
            {{ t('components.cloneRepositoryModal.destination') }}
            <input
              data-testid="clone-destination-input"
              v-model="destinationPath"
              class="modal-input"
              :placeholder="t('components.cloneRepositoryModal.chooseADestination')"
              :disabled="isRunning"
              @focus="browseDestinationPath"
              @input="handleDestinationInput"
            />
          </label>
          <div v-if="showDestinationBrowser" class="directory-list">
            <button
              class="directory-row"
              type="button"
              :disabled="!destinationParentPath"
              @click="chooseDestinationDirectory(destinationParentPath)"
            >
              <span class="folder-icon"><PhArrowLeft :size="16" /></span>
              <span>{{ t('components.cloneRepositoryModal.parentFolder') }}</span>
            </button>

            <button
              v-for="directory in destinationDirectories"
              :key="directory.path"
              class="directory-row"
              type="button"
              @click="chooseDestinationDirectory(directory.path)"
            >
              <span class="folder-icon"><PhFolder :size="16" weight="fill" /></span>
              <span>{{ directory.name }}</span>
            </button>

            <div v-if="!isDestinationListLoading && destinationDirectories.length === 0" class="empty-state">
              {{ t('components.cloneRepositoryModal.noVisibleSubfolders') }}
            </div>
            <div v-if="isDestinationListLoading" class="empty-state">{{ t('components.cloneRepositoryModal.loading') }}</div>
          </div>
          <p v-if="needsDestination" class="field-hint">{{ t('components.cloneRepositoryModal.chooseADestinationForNonGitHubURLs') }}</p>
          <p v-if="error" class="form-error">{{ error }}</p>

          <div v-if="isRunning" class="clone-progress">
            <div class="clone-progress-row">
              <span>{{ progress.status }}</span>
              <span v-if="progress.percent !== undefined">{{ progress.percent }}%</span>
            </div>
            <div class="progress-track" :class="{ indeterminate: progress.percent === undefined }">
              <div class="progress-fill" :style="progress.percent !== undefined ? { width: `${progress.percent}%` } : undefined" />
            </div>
          </div>

          <label class="shallow-clone-option">
            <input data-testid="clone-shallow-checkbox" v-model="shallow" type="checkbox" :disabled="isRunning" />
            {{ t('components.cloneRepositoryModal.shallowClone') }}
          </label>

          <footer class="modal-actions">
            <button v-if="isRunning" class="dialog-action cancel-btn" type="button" :disabled="canceling" @click="cancelClone">{{ canceling ? t('components.cloneRepositoryModal.canceling') : t('components.cloneRepositoryModal.cancel') }}</button>
            <button v-else class="dialog-action cancel-btn" type="button" @click="emit('close')">{{ t('components.cloneRepositoryModal.cancel') }}</button>
            <button data-testid="clone-start-button" class="dialog-action clone-start-btn" type="button" :disabled="!canStart" @click="startClone">{{ t('components.cloneRepositoryModal.clone') }}</button>
          </footer>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { PhArrowLeft, PhFolder } from '@phosphor-icons/vue';
import { usePreferences } from '../composables/usePreferences';

const t = i18n.global.t;

interface CloneProgressEvent { type: 'progress' | 'completed' | 'failed' | 'canceled'; status: string; percent?: number; projectPath?: string; error?: string; }
interface DirectoryNode { name: string; path: string; type: 'directory'; }

const props = withDefaults(defineProps<{ visible: boolean; clientId: string; embedded?: boolean }>(), {
  embedded: false,
});
const emit = defineEmits<{ close: []; cloned: [payload: { projectPath: string }] }>();

const remoteUrl = ref('');
const destinationPath = ref('');
const shallow = ref(false);
const existingPath = ref('');
const error = ref('');
const jobId = ref('');
const canceling = ref(false);
const isStarting = ref(false);
const destinationWasAutoSuggested = ref(false);
const progress = ref<CloneProgressEvent>({ type: 'progress', status: t('components.cloneRepositoryModal.cloning') });
const destinationDirectories = ref<DirectoryNode[]>([]);
const destinationBrowsePath = ref('');
const isDestinationListLoading = ref(false);
const showDestinationBrowser = ref(false);
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let events: EventSource | null = null;
const { gitCloneParentPath, loadPreferences } = usePreferences();

const isRunning = computed(() => Boolean(jobId.value));
const needsDestination = computed(() => Boolean(remoteUrl.value.trim()) && !destinationPath.value.trim());
const canStart = computed(() => Boolean(remoteUrl.value.trim() && destinationPath.value.trim()) && !isRunning.value && !isStarting.value);
const destinationParentPath = computed(() => dirnamePath(destinationBrowsePath.value));

watch(() => props.visible, (visible) => {
  if (!visible) return;
  reset();
  void (async () => {
    await loadPreferences();
    await browseDestinationDirectories(defaultBrowsePath());
  })();
}, { immediate: true });

watch(remoteUrl, () => {
  if (!props.visible || isRunning.value) return;
  if (destinationWasAutoSuggested.value) {
    destinationPath.value = '';
    destinationWasAutoSuggested.value = false;
  }
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(previewRepository, 250);
});

async function previewRepository() {
  const value = remoteUrl.value.trim();
  if (!value) return;
  error.value = '';
  const response = await fetch('/api/sessions/clone-repository/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remoteUrl: value }),
  });
  const data = await response.json().catch(() => ({}));
  if (remoteUrl.value.trim() !== value) return;
  if (!response.ok) {
    error.value = data.error || t('components.cloneRepositoryModal.previewFailedStatus', { status: response.status });
    return;
  }
  if (data.preview?.suggestedPath && !destinationPath.value.trim()) {
    destinationPath.value = data.preview.suggestedPath;
    destinationWasAutoSuggested.value = true;
    void browseDestinationPath();
  }
}

function handleDestinationInput() {
  destinationWasAutoSuggested.value = false;
  showDestinationBrowser.value = true;
  void browseDestinationPath();
}

async function browseDestinationPath() {
  if (isRunning.value) return;
  showDestinationBrowser.value = true;
  const path = destinationPath.value.trim() || defaultBrowsePath();
  const browsePath = basenamePath(path) ? dirnamePath(path) : path;
  await browseDestinationDirectories(browsePath || '~');
}

async function browseDestinationDirectories(path: string) {
  isDestinationListLoading.value = true;
  try {
    const params = new URLSearchParams({ path, depth: '1', type: 'directory', hidden: 'false' });
    const response = await fetch(`/api/files/tree?${params}`);
    if (!response.ok) throw new Error(t('components.cloneRepositoryModal.browseFailedStatus', { status: response.status }));
    const data = await response.json();
    destinationBrowsePath.value = data.path || path;
    destinationDirectories.value = data.tree || [];
  } catch (err) {
    console.error(t('components.cloneRepositoryModal.failedToBrowseDestinationFolders'), err);
    destinationDirectories.value = [];
  } finally {
    isDestinationListLoading.value = false;
  }
}

async function chooseDestinationDirectory(path: string) {
  if (!path) return;
  destinationPath.value = path;
  destinationWasAutoSuggested.value = false;
  await browseDestinationDirectories(path);
}

async function startClone() {
  error.value = '';
  existingPath.value = '';
  isStarting.value = true;
  progress.value = { type: 'progress', status: t('components.cloneRepositoryModal.startingClone') };
  try {
    const response = await fetch('/api/sessions/clone-repository', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, remoteUrl: remoteUrl.value.trim(), destinationPath: destinationPath.value.trim(), shallow: shallow.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.status === 'destination_exists') {
      existingPath.value = data.existingPath;
      return;
    }
    if (!response.ok) {
      error.value = data.error || t('components.cloneRepositoryModal.cloneFailedStatus', { status: response.status });
      return;
    }
    jobId.value = data.jobId;
    openEventStream(data.jobId);
  } finally {
    isStarting.value = false;
  }
}

function openEventStream(id: string) {
  events?.close();
  events = new EventSource(`/api/sessions/clone-repository/${encodeURIComponent(id)}/events`);
  events.onmessage = (event) => {
    let next: CloneProgressEvent;
    try {
      next = JSON.parse(event.data) as CloneProgressEvent;
    } catch {
      events?.close();
      jobId.value = '';
      error.value = t('components.cloneRepositoryModal.cloneProgressUpdateWasInvalid');
      return;
    }
    progress.value = next;
    if (next.type === 'completed' && next.projectPath) {
      events?.close();
      jobId.value = '';
      emit('cloned', { projectPath: next.projectPath });
    } else if (next.type === 'failed') {
      events?.close();
      jobId.value = '';
      error.value = next.error || t('components.cloneRepositoryModal.cloneFailed');
    } else if (next.type === 'canceled') {
      events?.close();
      jobId.value = '';
    }
  };
  events.onerror = () => {
    events?.close();
    jobId.value = '';
    error.value = t('components.cloneRepositoryModal.cloneProgressConnectionFailed');
  };
}

async function cancelClone() {
  if (!jobId.value) return;
  canceling.value = true;
  try {
    await fetch(`/api/sessions/clone-repository/${encodeURIComponent(jobId.value)}/cancel`, { method: 'POST' });
  } finally {
    canceling.value = false;
  }
}

function useExistingFolder() {
  emit('cloned', { projectPath: existingPath.value });
}

function requestClose() {
  if (isRunning.value && !window.confirm(t('components.cloneRepositoryModal.cancelCloneAndDeleteThePartialFolder'))) return;
  if (isRunning.value) void cancelClone();
  emit('close');
}

function reset() {
  remoteUrl.value = '';
  destinationPath.value = '';
  shallow.value = false;
  existingPath.value = '';
  error.value = '';
  jobId.value = '';
  canceling.value = false;
  isStarting.value = false;
  destinationWasAutoSuggested.value = false;
  progress.value = { type: 'progress', status: t('components.cloneRepositoryModal.cloning') };
  events?.close();
  events = null;
  destinationDirectories.value = [];
  destinationBrowsePath.value = '';
  isDestinationListLoading.value = false;
  showDestinationBrowser.value = true;
}

function defaultBrowsePath(): string {
  return gitCloneParentPath.value.trim() || '~/git/github';
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

onBeforeUnmount(() => events?.close());
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.58);
}

.modal-overlay.embedded {
  position: static;
  display: block;
  padding: 0;
  background: transparent;
}

.clone-repository-modal {
  width: min(560px, calc(100vw - 2rem));
  max-height: calc(100vh - 3rem);
  padding: 1.25rem;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.embedded .clone-repository-modal {
  width: 100%;
  max-height: none;
  padding: 0.75rem;
  overflow: visible;
  background: transparent;
  border: 0;
  box-shadow: none;
}

.modal-header,
.modal-actions,
.clone-actions,
.clone-progress-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.modal-header {
  justify-content: space-between;
  margin-bottom: 1rem;
}

.modal-header h3,
.clone-existing-state h4 {
  margin: 0;
  color: var(--text-primary);
}

.icon-button {
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  color: var(--text-secondary);
}

.clone-form {
  display: grid;
  gap: 0.875rem;
}

.clone-form label {
  display: grid;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.clone-form .shallow-clone-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-input {
  width: 100%;
  padding: 0.65rem 0.75rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.directory-list {
  max-height: 13rem;
  overflow: auto;
  padding: 0.35rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
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

.directory-row:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.empty-state {
  padding: 1rem;
  color: var(--text-secondary);
  text-align: center;
}

.field-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.form-error {
  margin: 0;
  color: var(--error);
}

.clone-progress {
  display: grid;
  gap: 0.45rem;
}

.clone-progress-row {
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.progress-track {
  height: 0.5rem;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: var(--radius-full);
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width var(--duration-fast) var(--ease-out);
}

.progress-track.indeterminate .progress-fill {
  width: 35%;
}

.modal-actions,
.clone-actions {
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.clone-start-btn {
  background: var(--accent);
  color: white;
  transition: background var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
}

.clone-start-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.clone-start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
