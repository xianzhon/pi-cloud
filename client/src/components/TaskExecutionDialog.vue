<template>
  <ConfirmModal :visible="visible" hide-icon :confirm-text="t('components.taskExecution.save')" :cancel-text="t('components.taskExecution.close')" @confirm="save" @cancel="emit('close')">
    <template #title>{{ t('components.taskExecution.title') }}</template>
    <template #message>
      <div class="execution-form">
        <p>{{ t('components.taskExecution.description') }}</p>
        <label class="execution-switch">
          <input v-model="enabled" type="checkbox" role="switch" :disabled="loading || saving" />
          {{ t('components.taskExecution.enabled') }}
        </label>
        <p>{{ t('components.taskExecution.pauseHint') }}</p>
        <p v-if="queue.activeTaskId" role="status">{{ t('components.taskExecution.running', { title: taskTitle(queue.activeTaskId) }) }}</p>
        <p v-if="error || queue.error" class="execution-error" role="alert">{{ error || queue.error }}</p>
        <label>{{ t('components.taskInboxPanel.scope') }}
          <select v-model="scope" :disabled="locked">
            <option value="project">{{ t('components.taskInboxPanel.currentProject') }}</option>
            <option value="all">{{ t('components.taskInboxPanel.allProjects') }}</option>
          </select>
        </label>
        <h3>{{ t('components.taskExecution.order') }}</h3>
        <ol class="execution-list">
          <li v-for="(id, index) in selected" :key="id">
            <span>{{ index + 1 }}. {{ taskTitle(id) }}</span>
            <button type="button" :disabled="locked || index === 0" :aria-label="t('components.taskExecution.moveUp')" @click="move(index, -1)">↑</button>
            <button type="button" :disabled="locked || index === selected.length - 1" :aria-label="t('components.taskExecution.moveDown')" @click="move(index, 1)">↓</button>
            <button type="button" :disabled="locked" :aria-label="t('components.taskExecution.remove')" @click="selected.splice(index, 1)">×</button>
          </li>
        </ol>
        <p v-if="!selected.length">{{ t('components.taskExecution.empty') }}</p>
        <h3>{{ t('components.taskExecution.available') }}</h3>
        <div class="execution-list available">
          <label v-for="task in available" :key="task.id">
            <input type="checkbox" :checked="selected.includes(task.id)" :disabled="locked" @change="toggle(task.id)" />
            <span>{{ task.title }}<small>{{ task.projectPath }}</small></span>
          </label>
        </div>
      </div>
    </template>
  </ConfirmModal>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { i18n } from '../i18n';
import { apiRequest, getApiErrorMessage } from '../services/apiClient';
import type { ProjectTask } from '../types/projectTask';
import ConfirmModal from './ConfirmModal.vue';

interface QueueState { enabled: boolean; taskIds: string[]; activeTaskId: string | null; error: string }
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
const locked = computed(() => loading.value || saving.value || queue.value.enabled || Boolean(queue.value.activeTaskId));
const available = computed(() => tasks.value.filter((task) => task.status === 'waiting' && (scope.value === 'all' || task.projectPath === props.currentProjectPath)));
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function taskTitle(id: string): string { return tasks.value.find((task) => task.id === id)?.title || id; }
function toggle(id: string): void {
  const index = selected.value.indexOf(id);
  if (index === -1) selected.value.push(id);
  else selected.value.splice(index, 1);
}
function move(index: number, direction: number): void {
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
    if (initial || changed) {
      selected.value = [...state.taskIds];
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
.execution-form { display: grid; gap: 12px; }
.execution-form p, .execution-form h3 { margin: 0; }
.execution-form h3 { font-size: 14px; }
.execution-switch, .execution-list li, .available label { display: flex; align-items: center; gap: 8px; }
.execution-list { max-height: 220px; overflow-y: auto; margin: 0; padding-left: 22px; }
.execution-list li { margin-bottom: 8px; }
.execution-list li span { flex: 1; overflow-wrap: anywhere; }
.execution-list button, select { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; }
.available { padding: 0; display: grid; gap: 10px; }
.available small { display: block; color: var(--text-secondary); overflow-wrap: anywhere; }
.execution-error { color: var(--error-color, #ef4444); }
button:disabled { opacity: 0.5; }
</style>
