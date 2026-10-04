<template>
  <ConfirmModal :visible="visible" wide hide-icon :confirm-text="t('components.taskExecution.save')" :cancel-text="t('components.taskExecution.close')" @confirm="save" @cancel="emit('close')">
    <template #title>{{ t('components.taskExecution.title') }}</template>
    <template #message>
      <div class="execution-form">
        <p class="execution-description">{{ t('components.taskExecution.description') }}</p>

        <div class="execution-settings">
          <label class="execution-switch">
            <input v-model="enabled" type="checkbox" role="switch" :disabled="loading || saving" />
            <span>
              <strong>{{ t('components.taskExecution.enabled') }}</strong>
              <small>{{ t('components.taskExecution.pauseHint') }}</small>
            </span>
          </label>
          <label class="scope-field">
            <span>{{ t('components.taskInboxPanel.scope') }}</span>
            <CustomSelect v-model="scope" :options="scopeOptions" :disabled="loading || saving" :aria-label="t('components.taskInboxPanel.scope')" />
          </label>
        </div>

        <p v-for="id in activeTaskIds" :key="id" class="execution-status" role="status">{{ t('components.taskExecution.running', { title: taskTitle(id) }) }}</p>
        <p v-if="error || queue.error" class="execution-error" role="alert">{{ error || queue.error }}</p>

        <div class="task-columns">
          <section class="task-panel queue-panel">
            <header class="panel-header">
              <h3>{{ t('components.taskExecution.order') }}</h3>
              <span>{{ selected.length }}</span>
            </header>
            <ol v-if="selected.length" class="execution-list queue-list">
              <li v-for="(id, index) in selected" :key="id">
                <span class="queue-position">{{ index + 1 }}</span>
                <span class="task-title">{{ taskTitle(id) }}</span>
                <span class="queue-actions">
                  <button type="button" :disabled="loading || saving || !canMove(index, -1)" :aria-label="t('components.taskExecution.moveUp')" @click="move(index, -1)">
                    <PhArrowUp :size="16" weight="bold" aria-hidden="true" />
                  </button>
                  <button type="button" :disabled="loading || saving || !canMove(index, 1)" :aria-label="t('components.taskExecution.moveDown')" @click="move(index, 1)">
                    <PhArrowDown :size="16" weight="bold" aria-hidden="true" />
                  </button>
                  <button class="remove-task" type="button" :disabled="loading || saving || isPersisted(id)" :aria-label="t('components.taskExecution.remove')" @click="selected.splice(index, 1)">
                    <PhX :size="16" weight="bold" aria-hidden="true" />
                  </button>
                </span>
              </li>
            </ol>
            <p v-else class="empty-queue">{{ t('components.taskExecution.empty') }}</p>
          </section>

          <section class="task-panel available-panel">
            <header class="panel-header">
              <h3>{{ t('components.taskExecution.available') }}</h3>
              <span>{{ available.length }}</span>
            </header>
            <div class="execution-list available">
              <label v-for="task in available" :key="task.id" :class="{ selected: selected.includes(task.id) }">
                <input type="checkbox" :checked="selected.includes(task.id)" :disabled="loading || saving || isPersisted(task.id)" @change="toggle(task.id)" />
                <span class="task-copy">
                  <strong>{{ task.title }}</strong>
                  <small>{{ task.projectPath }}</small>
                </span>
              </label>
            </div>
          </section>
        </div>
      </div>
    </template>
  </ConfirmModal>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { PhArrowDown, PhArrowUp, PhX } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { apiRequest, getApiErrorMessage } from '../services/apiClient';
import type { ProjectTask } from '../types/projectTask';
import ConfirmModal from './ConfirmModal.vue';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';

interface QueueState { enabled: boolean; taskIds: string[]; activeTaskId: string | null; activeTaskIds?: string[]; error: string }
const props = defineProps<{ visible: boolean; currentProjectPath: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const t = i18n.global.t;
const queue = ref<QueueState>({ enabled: false, taskIds: [], activeTaskId: null, error: '' });
const tasks = ref<ProjectTask[]>([]);
const selected = ref<string[]>([]);
const enabled = ref(false);
const scope = ref<'project' | 'all'>('project');
const error = ref('');
const loading = ref(false);
const saving = ref(false);
const activeTaskIds = computed(() => queue.value.activeTaskIds || (queue.value.activeTaskId ? [queue.value.activeTaskId] : []));
const executionActive = computed(() => queue.value.enabled || activeTaskIds.value.length > 0);
const scopeOptions = computed<CustomSelectOption[]>(() => [
  { value: 'project', label: t('components.taskInboxPanel.currentProject') },
  { value: 'all', label: t('components.taskInboxPanel.allProjects') },
]);
const available = computed(() => tasks.value.filter((task) => task.status === 'waiting' && (scope.value === 'all' || task.projectPath === props.currentProjectPath)));
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function taskTitle(id: string): string { return tasks.value.find((task) => task.id === id)?.title || id; }
function isPersisted(id: string): boolean { return executionActive.value && queue.value.taskIds.includes(id); }
function toggle(id: string): void {
  if (isPersisted(id)) return;
  const index = selected.value.indexOf(id);
  if (index === -1) selected.value.push(id);
  else selected.value.splice(index, 1);
}
function canMove(index: number, direction: number): boolean {
  const target = index + direction;
  return target >= 0 && target < selected.value.length
    && !isPersisted(selected.value[index]!) && !isPersisted(selected.value[target]!);
}
function move(index: number, direction: number): void {
  if (!canMove(index, direction)) return;
  const ids = [...selected.value];
  [ids[index], ids[index + direction]] = [ids[index + direction]!, ids[index]!];
  selected.value = ids;
}

async function load(initial: boolean, requestGeneration: number): Promise<void> {
  if (initial) loading.value = true;
  try {
    const [state, data] = await Promise.all([
      apiRequest<QueueState>('/api/tasks/execution-queue'),
      apiRequest<{ tasks: ProjectTask[] }>('/api/tasks?scope=all'),
    ]);
    if (requestGeneration !== generation) return;
    const changed = JSON.stringify(queue.value) !== JSON.stringify(state);
    if (initial) {
      selected.value = [...state.taskIds];
      enabled.value = state.enabled;
    } else if (changed) {
      const waitingIds = new Set(data.tasks.filter((task) => task.status === 'waiting').map((task) => task.id));
      const pending = selected.value.filter((id) => !queue.value.taskIds.includes(id) && waitingIds.has(id));
      selected.value = [...state.taskIds, ...pending.filter((id) => !state.taskIds.includes(id))];
      enabled.value = state.enabled;
    }
    queue.value = state;
    tasks.value = data.tasks;
    if (changed) emit('changed');
  } catch (cause) {
    if (requestGeneration === generation) error.value = getApiErrorMessage(cause, t('components.taskInboxPanel.taskActionFailed'));
  } finally {
    if (requestGeneration === generation) {
      loading.value = false;
      if (props.visible) timer = setTimeout(() => void load(false, requestGeneration), 2000);
    }
  }
}

async function save(): Promise<void> {
  if (loading.value || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    queue.value = await apiRequest<QueueState, { taskIds: string[]; enabled: boolean }>('/api/tasks/execution-queue', {
      method: 'PUT', body: { taskIds: selected.value, enabled: enabled.value },
    });
    emit('changed');
    emit('close');
  } catch (cause) {
    error.value = getApiErrorMessage(cause, t('components.taskInboxPanel.taskActionFailed'));
  } finally {
    saving.value = false;
  }
}

watch(() => props.visible, (visible) => {
  clearTimeout(timer);
  const requestGeneration = ++generation;
  if (visible) {
    error.value = '';
    void load(true, requestGeneration);
  }
}, { immediate: true });
onUnmounted(() => { ++generation; clearTimeout(timer); });
</script>

<style scoped>
.execution-form {
  display: grid;
  gap: 1rem;
  width: 100%;
}

.execution-form p,
.execution-form h3 {
  margin: 0;
}

.execution-description {
  max-width: 72ch;
  line-height: 1.5;
}

.execution-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.25rem;
  align-items: center;
  padding: 0.875rem 1rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.execution-switch {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  cursor: pointer;
}

.execution-switch > span,
.task-copy {
  min-width: 0;
}

.execution-switch strong,
.execution-switch small,
.task-copy strong,
.task-copy small {
  display: block;
}

.execution-switch strong,
.task-copy strong {
  color: var(--text-primary);
  font-weight: 600;
}

.execution-switch small,
.task-copy small {
  margin-top: 0.15rem;
  color: var(--text-secondary);
  font-size: 0.78rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.execution-switch input {
  appearance: none;
  position: relative;
  width: 2.5rem;
  height: 1.4rem;
  flex: 0 0 auto;
  margin: 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}

.execution-switch input::after {
  content: '';
  position: absolute;
  top: 0.18rem;
  left: 0.2rem;
  width: 0.9rem;
  height: 0.9rem;
  background: var(--text-secondary);
  border-radius: 50%;
  transition: transform var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
}

.execution-switch input:checked {
  background: var(--accent);
  border-color: var(--accent);
}

.execution-switch input:checked::after {
  background: white;
  transform: translateX(1.05rem);
}

.execution-switch input:focus-visible,
.available input:focus-visible,
.execution-list button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.scope-field {
  display: grid;
  grid-template-columns: auto minmax(10rem, 12rem);
  gap: 0.625rem;
  align-items: center;
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 600;
}

.execution-status,
.execution-error {
  padding: 0.65rem 0.8rem;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
}

.execution-status {
  color: var(--text-primary);
  background: var(--accent-muted);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}

.execution-error {
  color: var(--error-color, #ef4444);
  background: var(--error-muted);
  border: 1px solid color-mix(in srgb, var(--error-color, #ef4444) 30%, transparent);
}

.task-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

.task-panel {
  min-width: 0;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 2.75rem;
  padding: 0.65rem 0.875rem;
  border-bottom: 1px solid var(--border-subtle);
}

.panel-header h3 {
  color: var(--text-primary);
  font-size: 0.82rem;
  font-weight: 650;
}

.panel-header > span {
  min-width: 1.6rem;
  padding: 0.12rem 0.42rem;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
  font-size: 0.72rem;
  text-align: center;
}

.execution-list {
  max-height: min(42vh, 360px);
  overflow-y: auto;
  margin: 0;
}

.queue-list {
  padding: 0.4rem;
  list-style: none;
}

.queue-list li {
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: center;
  min-height: 3.25rem;
  padding: 0.45rem 0.5rem;
  border-radius: var(--radius-md);
}

.queue-list li + li {
  border-top: 1px solid var(--border-subtle);
}

.queue-list li:hover {
  background: var(--bg-elevated);
}

.queue-position {
  display: grid;
  width: 1.65rem;
  height: 1.65rem;
  place-items: center;
  color: var(--accent);
  background: var(--accent-muted);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 700;
}

.task-title {
  min-width: 0;
  color: var(--text-primary);
  font-size: 0.86rem;
  font-weight: 550;
  overflow-wrap: anywhere;
}

.queue-actions {
  display: flex;
  gap: 0.25rem;
}

.execution-list button {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
}

.execution-list button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: var(--border);
}

.execution-list .remove-task:hover:not(:disabled) {
  color: var(--error-color, #ef4444);
}

.available {
  display: grid;
  padding: 0.4rem;
}

.available label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.7rem;
  align-items: center;
  min-height: 3.25rem;
  padding: 0.5rem 0.6rem;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.available label + label {
  border-top: 1px solid var(--border-subtle);
}

.available label:hover,
.available label.selected {
  background: var(--bg-elevated);
}

.available label.selected .task-copy strong {
  color: var(--accent);
}

.available input {
  width: 1rem;
  height: 1rem;
  margin: 0;
  accent-color: var(--accent);
}

.empty-queue {
  display: grid;
  min-height: 7rem;
  place-items: center;
  padding: 1rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  text-align: center;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@media (max-width: 760px) {
  .execution-form {
    width: auto;
  }

  .execution-settings,
  .task-columns {
    grid-template-columns: 1fr;
  }

  .scope-field {
    grid-template-columns: 1fr;
  }

  .execution-list {
    max-height: 14rem;
  }
}

@media (max-width: 520px) {
  .queue-list li {
    grid-template-columns: 1.75rem minmax(0, 1fr);
  }

  .queue-actions {
    grid-column: 2;
  }
}
</style>
