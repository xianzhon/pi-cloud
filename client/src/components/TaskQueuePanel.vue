<template>
  <section class="task-queue-panel" :class="{ visible: visible !== false }" :style="panelStyle">
    <div
      class="task-queue-resize-handle"
      :class="{ 'is-resizing': isPanelResizing }"
      :title="t('components.taskQueuePanel.resizeTaskQueue')"
      @mousedown="startPanelResize"
    />
    <header class="task-queue-header">
      <div>
        <h2>{{ t('components.taskQueuePanel.taskQueue') }}</h2>
        <p>{{ t('components.taskQueuePanel.captureWorkNowAndStartInNew') }}</p>
      </div>
      <div class="task-queue-actions">
        <button class="new-task" type="button" @click="openNewTask">{{ t('components.taskQueuePanel.newTask') }}</button>
        <button class="close-task-queue" type="button" :aria-label="t('components.taskQueuePanel.closeTaskQueue')" @click="emit('close')">×</button>
      </div>
    </header>

    <div class="task-queue-toolbar">
      <div class="task-filter-group">
        <span class="task-filter-label">{{ t('components.taskQueuePanel.scope') }}</span>
        <div class="task-scope" role="group" :aria-label="t('components.taskQueuePanel.taskProjectScope')">
          <button class="scope-project" :class="{ active: scope === 'project' }" type="button" @click="scope = 'project'">{{ t('components.taskQueuePanel.currentProject') }}</button>
          <button class="scope-all" :class="{ active: scope === 'all' }" type="button" @click="scope = 'all'">{{ t('components.taskQueuePanel.allProjects') }}</button>
        </div>
      </div>
      <div class="task-filter-group task-filter-group-status">
        <span class="task-filter-label">{{ t('components.taskQueuePanel.status') }}</span>
        <div class="task-status-tabs" role="group" :aria-label="t('components.taskQueuePanel.taskStatus')">
          <button v-for="option in statusOptions" :key="option.value" :class="{ active: status === option.value }" type="button" @click="status = option.value">{{ option.label }}</button>
        </div>
      </div>
    </div>

    <p v-if="error || actionError" class="task-error" aria-live="polite">{{ actionError || error }}</p>
    <div v-if="taskToast" class="task-toast" :class="taskToast.type" role="status" aria-live="polite">
      {{ taskToast.message }}
    </div>
    <div v-if="loading" class="task-empty">{{ t('components.taskQueuePanel.loadingTasks') }}</div>
    <div v-else-if="tasks.length === 0" class="task-empty">
      <div class="task-empty-card">
        <div class="task-empty-icon" aria-hidden="true">
          <PhTray :size="28" weight="duotone" />
        </div>
        <h3>{{ t('components.taskQueuePanel.noStatusTasks', { status: t(`components.taskQueuePanel.statuses.${status}`) }) }}</h3>
        <p v-if="status === 'waiting'">{{ t('components.taskQueuePanel.captureYourNextIdeaWithoutInterruptingYour') }}</p>
        <button v-if="status === 'waiting'" class="task-empty-action" type="button" @click="openNewTask">{{ t('components.taskQueuePanel.newTask') }}</button>
      </div>
    </div>
    <div v-else class="task-list">
      <article v-for="task in tasks" :key="task.id" class="task-row" :data-task-id="task.id">
        <div class="task-row-main">
          <div class="task-copy">
            <div class="task-title-line">
              <h3>{{ task.title }}</h3>
              <span class="task-status" :class="`status-${task.status}`">{{ t(`components.taskQueuePanel.statuses.${task.status}`) }}</span>
              <div class="task-title-actions">
                <button v-if="task.status === 'waiting'" class="task-icon-btn" type="button" :aria-label="t('components.taskQueuePanel.editTask')" :title="t('components.taskQueuePanel.edit')" @click="openEditTask(task)">
                  <PhPencilSimple :size="15" weight="bold" />
                </button>
                <button class="task-icon-btn danger" type="button" :aria-label="t('components.taskQueuePanel.deleteTask')" :title="t('components.taskQueuePanel.delete')" @click="requestDelete(task)">
                  <PhTrash :size="15" weight="bold" />
                </button>
              </div>
            </div>
            <div class="task-meta">
              <span v-if="scope === 'all'" class="task-project">{{ task.projectPath }}</span>
              <span class="task-runtime" :title="`${task.agentProfileId} · ${task.modelProvider}/${task.modelId}`">{{ task.agentProfileId }} · {{ task.modelId }}</span>
              <span v-if="task.worktree.mode === 'managed'" class="task-work-location">{{ workLocation(task) }}</span>
              <span class="task-created-at" :title="formatAbsoluteDate(task.createdAt)">{{ formatDate(task.createdAt) }}</span>
            </div>
            <p class="task-prompt" :class="{ expanded: isPromptExpanded(task.id) }">{{ task.prompt }}</p>
            <button
              v-if="isPromptExpandable(task.prompt)"
              class="task-prompt-toggle"
              type="button"
              :aria-expanded="isPromptExpanded(task.id)"
              @click="togglePrompt(task.id)"
            >{{ isPromptExpanded(task.id) ? t('components.taskQueuePanel.showLess') : t('components.taskQueuePanel.showMore') }}</button>
            <p v-if="task.notes" class="task-notes"><strong>{{ t('components.taskQueuePanel.notes') }}</strong> {{ task.notes }}</p>
          </div>
        </div>
        <div class="task-row-actions task-actions">
          <div class="task-primary-actions">
            <button v-if="task.status === 'waiting'" class="task-start primary" type="button" :disabled="startingTaskId === task.id" @click="startTask(task)">{{ startingTaskId === task.id ? t('components.taskQueuePanel.starting') : t('components.taskQueuePanel.start') }}</button>
            <button v-if="task.status !== 'waiting' && task.sessionId" class="task-open-session primary" type="button" @click="emit('openSession', task.sessionId)">{{ t('components.taskQueuePanel.openSession') }}</button>
          </div>
          <div class="task-secondary-actions">
            <button v-if="task.status === 'waiting'" class="task-start-new-tab" type="button" :disabled="startingTaskId === task.id" @click="startTaskInNewTab(task)">{{ t('components.taskQueuePanel.startInNewTab') }}</button>
            <button v-if="task.status === 'started'" class="task-complete" type="button" @click="completeTask(task)">{{ t('components.taskQueuePanel.complete') }}</button>
            <a
              v-if="task.giteaIssue"
              class="task-open-issue"
              :href="task.giteaIssue.url"
              target="_blank"
              rel="noopener noreferrer"
            >Issue #{{ task.giteaIssue.number }}</a>
            <button v-else class="task-create-issue" type="button" @click="openIssueDialog(task)">{{ t('components.taskQueuePanel.createIssue') }}</button>
            <a
              v-if="task.pullRequest"
              class="task-pr-status"
              :class="task.pullRequest.status"
              :href="task.pullRequest.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="task.pullRequest.status === 'merged' ? t('components.taskQueuePanel.pullRequestMerged') : t('components.taskQueuePanel.pullRequestReady')"
              :aria-label="task.pullRequest.status === 'merged' ? t('components.taskQueuePanel.pullRequestMerged') : t('components.taskQueuePanel.pullRequestReady')"
            >
              <PhGitMerge v-if="task.pullRequest.status === 'merged'" :size="13" weight="bold" aria-hidden="true" />
              <PhGitPullRequest v-else :size="13" weight="bold" aria-hidden="true" />
              <span>PR #{{ task.pullRequest.number }}</span>
            </a>
          </div>
        </div>
      </article>
    </div>

    <TaskEditorDialog
      ref="taskEditorRef"
      :visible="editorVisible"
      :client-id="clientId"
      :current-project-path="currentProjectPath"
      :selected-agent-profile-id="selectedAgentProfileId"
      :presets="presets"
      :task="editingTask"
      :saving="saving"
      @close="closeEditor"
      @save="saveTask"
    />

    <ConfirmModal :visible="Boolean(deletingTask)" variant="danger" :confirm-text="t('components.taskQueuePanel.delete')" @confirm="confirmDelete" @cancel="deletingTask = null">
      <template #title>{{ t('components.taskQueuePanel.deleteTask') }}</template>
      <template #message>{{ t('components.taskQueuePanel.deleteThisTaskRecordAnyLinkedPi') }}</template>
    </ConfirmModal>

    <ConfirmModal :visible="Boolean(issueDialogTask)" :confirm-text="t('components.taskQueuePanel.createIssue')" @confirm="confirmCreateIssue" @cancel="issueDialogTask = null">
      <template #title>{{ t('components.taskQueuePanel.createIssue') }}</template>
      <template #message>
        <div class="issue-preview-form">
          <label>{{ t('components.taskQueuePanel.repository') }} <input :value="issueRepositoryName" readonly :aria-label="t('components.taskQueuePanel.issueRepository')" /></label>
          <label>{{ t('components.taskQueuePanel.title') }} <input v-model="issuePreview.title" /></label>
          <div class="issue-ai-row">
            <span>{{ t('components.taskQueuePanel.body') }}</span>
            <button
              type="button"
              class="issue-ai-generate"
              :disabled="generatingIssueContent"
              :title="clientId ? t('components.taskQueuePanel.polishIssueTitleAndBodyWithAi') : t('components.taskQueuePanel.openASessionToPolishIssueContentWith')"
              @click="generateIssueContent"
            >
              <PhRobot :size="16" weight="bold" aria-hidden="true" />
              <span>{{ generatingIssueContent ? t('components.taskQueuePanel.generating') : t('components.taskQueuePanel.aiPolish') }}</span>
            </button>
          </div>
          <label><textarea v-model="issuePreview.body" rows="8"></textarea></label>
          <p v-if="issueGenerationError" class="issue-generation-error">{{ issueGenerationError }}</p>
        </div>
      </template>
    </ConfirmModal>
  </section>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, nextTick, onUnmounted, reactive, ref, watch, type CSSProperties } from 'vue';
import { PhGitMerge, PhGitPullRequest, PhPencilSimple, PhRobot, PhTrash, PhTray } from '@phosphor-icons/vue';
import type { SkillPreset } from '../composables/useSkillPresets';
import { useProjectTasks } from '../composables/useProjectTasks';
import { useGitHosting, type GitHostingIssuePreview } from '../composables/useGitHosting';
import type { ProjectTask, ProjectTaskDraft, ProjectTaskStartResult, ProjectTaskVisibleStatus } from '../types/projectTask';
import ConfirmModal from './ConfirmModal.vue';
import TaskEditorDialog from './TaskEditorDialog.vue';

const t = i18n.global.t;

const props = defineProps<{
  visible?: boolean;
  clientId: string;
  currentProjectPath: string;
  selectedAgentProfileId: string;
  presets: SkillPreset[];
  loadPresets: () => Promise<void>;
}>();

const emit = defineEmits<{
  close: [];
  started: [result: ProjectTaskStartResult];
  openSession: [sessionId: string];
}>();

const { tasks, scope, status, loading, error, startingTaskId, load, create, update, remove, start, complete } = useProjectTasks(props.clientId);
const gitHosting = useGitHosting();
const editorVisible = ref(false);
const editingTask = ref<ProjectTask | null>(null);
const taskEditorRef = ref<InstanceType<typeof TaskEditorDialog> | null>(null);
const deletingTask = ref<ProjectTask | null>(null);
const saving = ref(false);
const actionError = ref('');
const issueDialogTask = ref<ProjectTask | null>(null);
const issuePreview = reactive<GitHostingIssuePreview>({ owner: '', repo: '', title: '', body: '' });
const issueRepositoryName = computed(() => [issuePreview.owner, issuePreview.repo].filter(Boolean).join('/'));
type TaskToast = { message: string; type: 'success' | 'error' };

const creatingIssue = ref(false);
const generatingIssueContent = ref(false);
const issueGenerationError = ref('');
const taskToast = ref<TaskToast | null>(null);
const expandedTaskIds = ref(new Set<string>());
let toastTimer: number | undefined;
const defaultPanelWidth = 480;
const panelWidthPx = ref<number>();
const panelStyle = computed<CSSProperties>(() => ({
  '--task-queue-panel-width': `${panelWidthPx.value || defaultPanelWidth}px`,
}));
const minPanelWidth = 360;
const maxPanelWidthRatio = 0.85;
let resizeStartX = 0;
let resizeStartWidth = 0;
const isPanelResizing = ref(false);
const statusOptions: Array<{ value: ProjectTaskVisibleStatus; label: string }> = [
  { value: 'waiting', label: t('components.taskQueuePanel.waiting') },
  { value: 'started', label: t('components.taskQueuePanel.started') },
  { value: 'completed', label: t('components.taskQueuePanel.completed') },
];

watch([() => props.currentProjectPath, scope, status], () => void load(props.currentProjectPath), { immediate: true });

function openNewTask() {
  void openTaskEditor(null);
}

function openEditTask(task: ProjectTask) {
  void openTaskEditor(task);
}

async function openTaskEditor(task: ProjectTask | null) {
  actionError.value = '';
  editingTask.value = task;
  editorVisible.value = true;
  try {
    await props.loadPresets();
    await nextTick();
    await taskEditorRef.value?.preload?.();
  } catch (exception) {
    editorVisible.value = false;
    editingTask.value = null;
    actionError.value = messageOf(exception);
  }
}

function closeEditor() {
  editorVisible.value = false;
  editingTask.value = null;
}

async function saveTask(draft: ProjectTaskDraft) {
  saving.value = true;
  actionError.value = '';
  try {
    if (editingTask.value) await update(editingTask.value.id, draft);
    else await create(draft);
    closeEditor();
  } catch (exception) {
    actionError.value = messageOf(exception);
  } finally {
    saving.value = false;
  }
}

async function startTask(task: ProjectTask) {
  actionError.value = '';
  try {
    emit('started', await start(task.id));
  } catch (exception) {
    actionError.value = messageOf(exception);
  }
}

function startTaskInNewTab(task: ProjectTask) {
  actionError.value = '';
  const url = new URL('/', window.location.origin);
  url.searchParams.set('startTask', task.id);
  if (task.projectPath && task.projectPath !== '~') url.searchParams.set('project', task.projectPath);
  if (task.agentProfileId && task.agentProfileId !== 'default') url.searchParams.set('profile', task.agentProfileId);
  window.open(url.toString(), '_blank', 'noopener');
}

async function completeTask(task: ProjectTask) {
  actionError.value = '';
  try {
    await complete(task.id);
  } catch (exception) {
    actionError.value = messageOf(exception);
  }
}

function requestDelete(task: ProjectTask) {
  deletingTask.value = task;
}

async function confirmDelete() {
  if (!deletingTask.value) return;
  actionError.value = '';
  try {
    await remove(deletingTask.value.id);
    deletingTask.value = null;
  } catch (exception) {
    actionError.value = messageOf(exception);
  }
}

async function openIssueDialog(task: ProjectTask) {
  actionError.value = '';
  issueGenerationError.value = '';
  try {
    const preview = await gitHosting.previewIssue(task.id);
    Object.assign(issuePreview, preview);
    issueDialogTask.value = task;
  } catch (exception) {
    actionError.value = messageOf(exception);
  }
}

async function generateIssueContent() {
  if (!issueDialogTask.value || generatingIssueContent.value) return;
  generatingIssueContent.value = true;
  issueGenerationError.value = '';
  try {
    const content = await gitHosting.generateIssueContent(props.clientId, issueDialogTask.value.id, { ...issuePreview });
    issuePreview.title = content.title;
    issuePreview.body = content.body;
  } catch (exception) {
    issueGenerationError.value = messageOf(exception);
  } finally {
    generatingIssueContent.value = false;
  }
}

async function confirmCreateIssue() {
  if (!issueDialogTask.value || creatingIssue.value) return;
  creatingIssue.value = true;
  actionError.value = '';
  try {
    const task = await gitHosting.createIssue(issueDialogTask.value.id, { ...issuePreview });
    issueDialogTask.value = null;
    await load(props.currentProjectPath);
    showToast(task.giteaIssue ? t('components.taskQueuePanel.issueNumberCreated', { number: task.giteaIssue.number }) : t('components.taskQueuePanel.issueCreated'), 'success');
  } catch (exception) {
    actionError.value = messageOf(exception);
    showToast(actionError.value, 'error');
  } finally {
    creatingIssue.value = false;
  }
}

function workLocation(task: ProjectTask): string {
  return task.worktree.mode === 'managed' ? t('components.taskQueuePanel.worktreeBranch', { branch: task.worktree.branchName }) : '';
}

function formatDate(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('components.taskQueuePanel.justNow');
  if (diffMins < 60) return formatRelativeUnit(diffMins, 'minute');
  if (diffHours < 24) return formatRelativeUnit(diffHours, 'hour');
  if (diffDays < 7) return formatRelativeUnit(diffDays, 'day');
  if (diffDays < 30) return formatRelativeUnit(Math.floor(diffDays / 7), 'week');

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return formatRelativeUnit(diffMonths, 'month');

  return formatRelativeUnit(Math.floor(diffDays / 365), 'year');
}

function formatRelativeUnit(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  if (i18n.global.locale.value !== 'en') {
    return new Intl.RelativeTimeFormat(i18n.global.locale.value, { numeric: 'always', style: 'long' }).format(-value, unit);
  }
  if (unit === 'minute') return `${value}m ago`;
  if (unit === 'hour') return `${value}h ago`;
  if (unit === 'day') return `${value}d ago`;
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

function formatAbsoluteDate(value: string): string {
  return new Date(value).toLocaleString();
}

function isPromptExpandable(prompt: string): boolean {
  return prompt.trim().length > 240;
}

function isPromptExpanded(taskId: string): boolean {
  return expandedTaskIds.value.has(taskId);
}

function togglePrompt(taskId: string): void {
  const next = new Set(expandedTaskIds.value);
  if (next.has(taskId)) next.delete(taskId);
  else next.add(taskId);
  expandedTaskIds.value = next;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : t('components.taskQueuePanel.taskActionFailed');
}

function showToast(message: string, type: TaskToast['type']): void {
  taskToast.value = { message, type };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    taskToast.value = null;
  }, 2_000);
}

function clampPanelWidth(width: number): number {
  const maxPanelWidth = Math.max(minPanelWidth, Math.floor(window.innerWidth * maxPanelWidthRatio));
  return Math.min(maxPanelWidth, Math.max(minPanelWidth, width));
}

function getCurrentPanelWidth(): number {
  return panelWidthPx.value || defaultPanelWidth;
}

function handlePanelResize(event: MouseEvent) {
  const delta = resizeStartX - event.clientX;
  panelWidthPx.value = clampPanelWidth(resizeStartWidth + delta);
}

function stopPanelResize() {
  isPanelResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', handlePanelResize);
  window.removeEventListener('mouseup', stopPanelResize);
  window.removeEventListener('blur', stopPanelResize);
}

function startPanelResize(event: MouseEvent) {
  event.preventDefault();
  isPanelResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = getCurrentPanelWidth();
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', handlePanelResize);
  window.addEventListener('mouseup', stopPanelResize);
  window.addEventListener('blur', stopPanelResize);
}

onUnmounted(() => {
  stopPanelResize();
  window.clearTimeout(toastTimer);
});

defineExpose({ openNewTask });
</script>

<style scoped>
.task-queue-panel {
  --accent-color: var(--accent);
  --border-color: var(--border);
  position: relative;
  flex: 0 0 var(--task-queue-panel-width);
  width: var(--task-queue-panel-width);
  min-width: 360px;
  height: 100vh;
  color: var(--text-primary);
  background: var(--bg-primary);
  border-left: 1px solid var(--border);
  display: none;
  flex-direction: column;
  overflow: hidden;
  container-type: inline-size;
}
.task-queue-panel.visible {
  display: flex;
}
.task-queue-resize-handle {
  position: absolute;
  top: 0;
  left: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}
.task-queue-resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  left: 5px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s;
}
.task-queue-resize-handle:hover::after,
.task-queue-resize-handle.is-resizing::after {
  background: var(--accent);
}
.task-queue-header,
.task-queue-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}
.task-queue-header {
  position: relative;
  padding: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent),
    var(--bg-elevated);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 1px 0 rgba(0, 0, 0, 0.28);
}
.task-queue-header::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: 3px;
  background: var(--accent);
  opacity: 0.85;
}
.task-queue-header h2 {
  margin: 0;
  font-size: 18px;
  letter-spacing: -0.015em;
}
.task-queue-header p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.task-queue-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.new-task,
.task-actions .primary {
  border-color: var(--accent-color) !important;
  color: white !important;
  background: var(--accent-color) !important;
}
.new-task {
  padding: 8px 11px;
  border: 1px solid;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 650;
  white-space: nowrap;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}
.close-task-queue {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.close-task-queue:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}
.task-queue-toolbar {
  align-items: flex-end;
  margin: 0;
  padding: 14px 18px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--border-color) 70%, transparent);
}
.task-filter-group {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.task-filter-group-status {
  justify-items: end;
}
.task-filter-label {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.task-scope,
.task-status-tabs {
  display: flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
}
.task-scope button,
.task-status-tabs button {
  padding: 6px 9px;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
  transition:
    color 120ms ease,
    background 120ms ease,
    transform 120ms ease;
}
.task-scope button.active,
.task-status-tabs button.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.task-list {
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px 18px;
}
.task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  transition:
    border-color 150ms ease,
    background 150ms ease,
    transform 150ms ease,
    box-shadow 150ms ease;
}
.task-row:hover,
.task-row:focus-within {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--bg-secondary) 96%, var(--accent-color));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
}
.task-row-main {
  min-width: 0;
}
.task-title-line,
.task-meta,
.task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-title-line h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-title-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.task-title-actions .task-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition:
    color 120ms ease,
    background 120ms ease,
    transform 120ms ease;
}
.task-title-actions .task-icon-btn:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}
.task-title-actions .task-icon-btn.danger {
  color: var(--error-color, #ef4444);
}
.task-status {
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.task-status::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  margin: 0 4px 1px 0;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.75;
}
.status-waiting {
  color: var(--accent-color);
}
.status-started {
  color: var(--success-color, #22c55e);
}
.status-completed {
  color: var(--text-secondary);
}
.task-meta {
  flex-wrap: wrap;
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}
.task-meta span + span::before {
  content: "·";
  margin-right: 8px;
  color: var(--border-color);
}
.task-project {
  color: var(--accent-color);
}
.task-pr-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid
    color-mix(in srgb, var(--success-color, #22c55e) 45%, var(--border-color));
  border-radius: 999px;
  color: var(--success-color, #22c55e);
  background: color-mix(
    in srgb,
    var(--success-color, #22c55e) 10%,
    transparent
  );
  font-size: 11px;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}
.task-pr-status:hover {
  border-color: var(--success-color, #22c55e);
  color: var(--text-primary);
  background: color-mix(
    in srgb,
    var(--success-color, #22c55e) 18%,
    transparent
  );
}
.task-pr-status.merged {
  border-color: color-mix(
    in srgb,
    var(--accent-color) 45%,
    var(--border-color)
  );
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}
.task-pr-status.merged:hover {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}
.task-runtime {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-prompt {
  display: -webkit-box;
  max-width: 68ch;
  margin: 10px 0 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--text-primary) 92%, var(--text-secondary));
  font-size: 14px;
  letter-spacing: -0.005em;
  line-height: 1.5;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
.task-prompt.expanded {
  display: block;
}
.task-prompt-toggle {
  margin-top: 5px;
  padding: 0;
  border: 0;
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}
.task-prompt-toggle:hover {
  text-decoration: underline;
}
.task-notes {
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.task-actions {
  align-self: end;
  flex-wrap: wrap;
  justify-content: flex-start;
}
.task-primary-actions,
.task-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.task-secondary-actions {
  color: var(--text-secondary);
}
.task-secondary-actions button {
  border-color: transparent;
  color: var(--text-secondary);
}
.task-secondary-actions button:hover {
  color: var(--text-primary);
}
.task-secondary-actions .task-open-issue {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid
    color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  border-radius: 999px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  font-size: 11px;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}
.task-secondary-actions .task-open-issue:hover {
  border-color: var(--accent-color);
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}
.task-actions button {
  min-height: 30px;
  padding: 6px 9px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}
.task-actions .primary {
  font-weight: 650;
}
.task-actions button:hover {
  border-color: color-mix(
    in srgb,
    var(--accent-color) 45%,
    var(--border-color)
  );
  background: var(--bg-tertiary);
}
.task-actions .primary:hover:not(:disabled),
.new-task:hover:not(:disabled) {
  border-color: var(--accent-hover) !important;
  background: var(--accent-hover) !important;
  color: white !important;
  box-shadow: 0 3px 10px
    color-mix(in srgb, var(--accent-color) 35%, transparent);
}
.task-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.task-actions .danger {
  color: var(--error-color, #ef4444);
}
button:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
.new-task:active,
.task-actions button:active,
.task-title-actions .task-icon-btn:active,
.task-scope button:active,
.task-status-tabs button:active {
  transform: scale(0.97);
}
@container (min-width: 560px) {
  .task-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
  .task-row-actions {
    max-width: 190px;
    justify-content: flex-end;
  }
}
.task-empty {
  display: flex;
  flex: 1;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  padding: 40px 20px;
  color: var(--text-secondary);
  text-align: center;
}
.task-empty-card {
  width: min(100%, 390px);
  padding: 34px 24px 28px;
  border: 1px solid
    color-mix(in srgb, var(--border-color) 85%, var(--accent-color));
  border-radius: 14px;
  background: var(--bg-secondary);
  box-shadow:
    0 12px 30px rgba(0, 0, 0, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.task-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  margin-bottom: 16px;
  border: 1px solid
    color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
  border-radius: 50%;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}
.task-empty h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  letter-spacing: -0.015em;
}
.task-empty p {
  max-width: 30ch;
  margin: 8px auto 0;
  font-size: 13px;
  line-height: 1.5;
}
.task-empty-action {
  margin-top: 20px;
  padding: 9px 14px;
  border: 1px solid var(--accent-color);
  border-radius: 8px;
  color: white;
  background: var(--accent-color);
  cursor: pointer;
  font-weight: 650;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}
.task-empty-action:hover {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
  box-shadow: 0 3px 10px
    color-mix(in srgb, var(--accent-color) 35%, transparent);
}
.task-empty-action:active {
  transform: scale(0.97);
}
.task-empty-action:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
.task-error {
  margin: 12px 18px;
  padding: 10px 12px;
  border: 1px solid
    color-mix(in srgb, var(--error-color, #ef4444) 45%, transparent);
  border-radius: 7px;
  color: var(--error-color, #ef4444);
}
.task-toast {
  position: sticky;
  top: 10px;
  z-index: 3;
  align-self: center;
  margin: 10px 18px;
  padding: 9px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
}
.task-toast.success {
  border-color: color-mix(
    in srgb,
    var(--success, #22c55e) 45%,
    var(--border-color)
  );
}
.task-toast.error {
  border-color: color-mix(
    in srgb,
    var(--error, #ef4444) 45%,
    var(--border-color)
  );
  color: var(--error, #ef4444);
}
.issue-preview-form {
  display: grid;
  gap: 10px;
}
.issue-preview-form label {
  display: grid;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}
.issue-preview-form input,
.issue-preview-form textarea {
  width: 100%;
  padding: 8px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}
.issue-preview-form input[readonly] {
  color: var(--text-secondary);
  background: var(--bg-secondary);
  cursor: default;
}
.issue-ai-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.issue-ai-generate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 12px;
}
.issue-ai-generate:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.issue-generation-error {
  margin: 0;
  color: var(--error-color, #ef4444);
  font-size: 12px;
}
@media (max-width: 768px) {
  .task-queue-panel {
    min-width: 0;
  }
  .task-queue-header,
  .task-queue-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .task-queue-header {
    gap: 12px;
  }
  .task-queue-actions {
    justify-content: space-between;
  }
  .task-filter-group-status {
    justify-items: stretch;
  }
  .task-scope,
  .task-status-tabs {
    overflow-x: auto;
  }
  .task-scope button,
  .task-status-tabs button {
    flex: 1 0 auto;
  }
  .task-prompt {
    max-width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .task-row,
  .new-task,
  .task-actions button,
  .task-title-actions .task-icon-btn,
  .task-scope button,
  .task-status-tabs button {
    transition: none;
  }
}
</style>
