<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="task-editor-backdrop">
        <section class="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
          <header class="task-editor-header">
            <div>
              <h2 id="task-editor-title">{{ task ? t('components.taskEditorDialog.editTask') : t('components.taskEditorDialog.newTask') }}</h2>
              <p>{{ t('components.taskEditorDialog.saveTheCompleteSessionSetupNowAnd') }}</p>
            </div>
            <DialogCloseButton class="task-editor-close" :label="t('components.taskEditorDialog.closeTaskEditor')" @click="emit('close')" />
          </header>

          <form @submit.prevent="submit">
            <div class="task-editor-grid">
              <section class="task-content-fields">
                <label for="task-project">{{ t('components.taskEditorDialog.project') }}</label>
                <div class="project-control">
                  <CustomSelect id="task-project" v-model="selectedProjectPath" :options="projectOptions" :aria-label="t('components.taskEditorDialog.taskProject')" />
                  <button type="button" class="dialog-action browse-project" @click="showFolderPicker = true">{{ t('components.taskEditorDialog.browse') }}</button>
                </div>

                <label for="task-title">{{ t('components.taskEditorDialog.title') }}</label>
                <input id="task-title" ref="titleInput" v-model="title" autocomplete="off" />

                <div class="task-prompt-row">
                  <label for="task-prompt">{{ t('components.taskEditorDialog.promptSentToPi') }}</label>
                  <button
                    type="button"
                    class="task-ai-polish"
                    :disabled="polishingTask || !prompt.trim()"
                    :title="prompt.trim() ? t('components.taskEditorDialog.polishTaskTitleAndPromptWithAi') : t('components.taskEditorDialog.enterARoughPromptToPolishWithAi')"
                    @click="polishTask"
                  >
                    <PhRobot :size="16" weight="bold" aria-hidden="true" />
                    <span>{{ polishingTask ? t('components.taskEditorDialog.polishing') : t('components.taskEditorDialog.aiPolish') }}</span>
                  </button>
                </div>
                <textarea id="task-prompt" v-model="prompt" rows="12" />

                <label for="task-notes">{{ t('components.taskEditorDialog.privateNotesNotSent') }}</label>
                <textarea id="task-notes" v-model="notes" rows="4" />

                <footer class="task-editor-actions">
                  <button class="dialog-action" type="button" @click="emit('close')">{{ t('components.taskEditorDialog.cancel') }}</button>
                  <button class="dialog-action task-save" type="submit" :disabled="submitDisabled">{{ saving ? t('components.taskEditorDialog.saving') : t('components.taskEditorDialog.saveTask') }}</button>
                </footer>
              </section>

              <section class="task-launch-fields">
                <label for="task-profile">{{ t('components.taskEditorDialog.agentProfile') }}</label>
                <CustomSelect id="task-profile" v-model="selectedProfileId" :options="profileOptions" :aria-label="t('components.taskEditorDialog.taskAgentProfile')" />

                <div v-if="loadingResources" class="task-resource-state">{{ t('components.taskEditorDialog.loadingLaunchSettings') }}</div>
                <SessionLaunchSettings
                  v-else
                  v-model="launchValue"
                  id-prefix="task"
                  require-model
                  :models="models"
                  :available-skills="availableSkills"
                  :presets="presets"
                  :branches="branches"
                  :copy-files="copyFiles"
                  :current-branch="currentBranch"
                  :branches-loading="branchesLoading"
                  :branches-error="branchesError"
                  @validity-change="launchValid = $event"
                  @request-branches="loadWorktreeBranches"
                />
              </section>
            </div>

            <p v-if="error" class="task-editor-error" aria-live="polite">{{ error }}</p>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>

  <FolderPickerModal
    :visible="showFolderPicker"
    :initial-path="selectedProjectPath"
    :current-project-path="selectedProjectPath"
    @close="showFolderPicker = false"
    @select="selectFolder"
  />
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { PhRobot } from '@phosphor-icons/vue';
import type { AvailableSkill } from '../composables/useAvailableSkills';
import type { SkillPreset } from '../composables/useSkillPresets';
import { cachedLaunchResource, launchCacheKey } from '../composables/useLaunchResourceCache';
import type { ProjectTask, ProjectTaskDraft } from '../types/projectTask';
import {
  defaultSessionLaunchValue,
  toTaskLaunchSnapshot,
  type ModelOption,
  type SessionLaunchValue,
} from '../types/sessionLaunch';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';
import DialogCloseButton from './DialogCloseButton.vue';
import FolderPickerModal from './FolderPickerModal.vue';
import SessionLaunchSettings from './SessionLaunchSettings.vue';

const t = i18n.global.t;

interface AgentProfile {
  id: string;
  label: string;
  defaultProvider?: string;
  defaultModel?: string;
}

const props = withDefaults(defineProps<{
  visible: boolean;
  clientId: string;
  currentProjectPath: string;
  selectedAgentProfileId: string;
  presets: SkillPreset[];
  task?: ProjectTask | null;
  saving?: boolean;
}>(), {
  task: null,
  saving: false,
});

const emit = defineEmits<{
  close: [];
  save: [draft: ProjectTaskDraft];
}>();

const titleInput = ref<HTMLInputElement | null>(null);
const title = ref('');
const prompt = ref('');
const notes = ref('');
const selectedProjectPath = ref('');
const selectedProfileId = ref('');
const projectPaths = ref<string[]>([]);
const profiles = ref<AgentProfile[]>([]);
const models = ref<ModelOption[]>([]);
const availableSkills = ref<AvailableSkill[]>([]);
const branches = ref<string[]>([]);
const copyFiles = ref<string[]>([]);
const currentBranch = ref('');
const branchesLoading = ref(false);
const branchesError = ref('');
const launchValue = ref<SessionLaunchValue>(defaultSessionLaunchValue());
const launchValid = ref(false);
const loadingResources = ref(false);
const error = ref('');
const polishingTask = ref(false);
const showFolderPicker = ref(false);
const STORAGE_KEY = 'pi-webui.newSessionOptions';

type StoredSkillOptions = {
  mode?: SessionLaunchValue['skillSelection'];
  customMode?: 'enabled' | 'disabled';
  selectedSkills?: string[];
  selectedPresetId?: string;
};

let loadingGeneration = 0;
let initializing = false;
let preloaded = false;

const projectOptions = computed<CustomSelectOption[]>(() => projectPaths.value.map((path) => ({ value: path, label: path })));
const profileOptions = computed<CustomSelectOption[]>(() => profiles.value.map((profile) => ({ value: profile.id, label: profile.label })));
const submitDisabled = computed(() => props.saving || loadingResources.value || !title.value.trim() || !prompt.value.trim() || !selectedProjectPath.value || !selectedProfileId.value || !launchValid.value);

watch(() => props.visible, (visible) => {
  if (!visible) return;
  if (preloaded) {
    preloaded = false;
    void nextTick(() => titleInput.value?.focus());
    return;
  }
  void initialize();
}, { immediate: true });

watch(selectedProfileId, (value, previous) => {
  if (initializing || !props.visible || !value || !previous || value === previous) return;
  launchValue.value = { ...launchValue.value, modelProvider: '', modelId: '' };
  void loadLaunchResources();
});

watch(selectedProjectPath, (value, previous) => {
  if (initializing || !props.visible || !value || !previous || value === previous) return;
  void loadLaunchResources();
});

async function initialize() {
  await prepareForOpen();
  await nextTick();
  titleInput.value?.focus();
}

async function prepareForOpen() {
  initializing = true;
  error.value = '';
  title.value = props.task?.title || '';
  prompt.value = props.task?.prompt || '';
  notes.value = props.task?.notes || '';
  selectedProjectPath.value = props.task?.projectPath || props.currentProjectPath;
  launchValue.value = props.task ? launchFromTask(props.task) : defaultSessionLaunchValue();

  try {
    const [loadedProjectPaths, loadedProfiles] = await Promise.all([
      loadProjectPaths(),
      loadAgentProfiles(),
    ]);
    projectPaths.value = Array.from(new Set([
      selectedProjectPath.value,
      ...loadedProjectPaths,
    ].filter(Boolean)));
    profiles.value = loadedProfiles;
    selectedProfileId.value = initialProfileId();
    await nextTick();
    initializing = false;
    await loadLaunchResources();
  } catch (exception) {
    initializing = false;
    error.value = messageOf(exception);
  }
}

async function loadProjectPaths(): Promise<string[]> {
  return cachedLaunchResource(
    launchCacheKey(['project-paths', props.clientId]),
    async () => {
      const response = await fetch(`/api/sessions/project-paths?clientId=${encodeURIComponent(props.clientId)}`);
      if (response.ok === false) throw new Error(t('components.taskEditorDialog.failedToLoadProjectPaths'));
      const data = await response.json();
      return Array.isArray(data.projectPaths) ? data.projectPaths : [];
    },
  );
}

async function loadAgentProfiles(): Promise<AgentProfile[]> {
  return cachedLaunchResource('agent-profiles', async () => {
    const response = await fetch('/api/sessions/agent-profiles');
    if (response.ok === false) throw new Error(t('components.taskEditorDialog.failedToLoadAgentProfiles'));
    const data = await response.json();
    return Array.isArray(data.profiles) ? data.profiles : [];
  });
}

async function loadAgentProfileModels(profileId: string): Promise<ModelOption[]> {
  return cachedLaunchResource(
    launchCacheKey(['models', profileId]),
    async () => {
      const response = await fetch(`/api/sessions/agent-profiles/${encodeURIComponent(profileId)}/models`);
      if (response.ok === false) throw new Error(t('components.taskEditorDialog.failedToLoadModels'));
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    },
  );
}

async function loadAgentProfileSkills(profileId: string, projectPath: string): Promise<AvailableSkill[]> {
  return cachedLaunchResource(
    launchCacheKey(['agent-profile-skills', profileId, projectPath]),
    async () => {
      const response = await fetch(`/api/sessions/agent-profiles/${encodeURIComponent(profileId)}/skills?projectPath=${encodeURIComponent(projectPath)}`);
      if (response.ok === false) throw new Error(t('components.taskEditorDialog.failedToLoadSkills'));
      const data = await response.json();
      return Array.isArray(data.skills) ? data.skills : [];
    },
  );
}

async function loadWorktreeCopyFiles(projectPath: string): Promise<string[]> {
  return cachedLaunchResource(
    launchCacheKey(['worktree-copy-files', props.clientId, projectPath]),
    async () => {
      const params = new URLSearchParams({ clientId: props.clientId, projectPath });
      const response = await fetch(`/api/sessions/worktree-copy-files?${params.toString()}`);
      if (response.ok === false) throw new Error(t('components.taskEditorDialog.failedToLoadCopyFiles'));
      const data = await response.json();
      return Array.isArray(data.files) ? data.files : [];
    },
  ).catch(() => []);
}

async function loadGitStatus(projectPath: string): Promise<{ isGitRepo?: boolean; detached?: boolean; branch?: string }> {
  const params = new URLSearchParams({ clientId: props.clientId, projectPath });
  const response = await fetch(`/api/sessions/git-status?${params.toString()}`);
  if (response.ok === false) return {};
  return response.json();
}

async function loadWorktreeBranches(): Promise<void> {
  const projectPath = selectedProjectPath.value;
  if (!projectPath) return;
  branchesLoading.value = true;
  branchesError.value = '';
  try {
    const params = new URLSearchParams({ clientId: props.clientId, projectPath });
    const response = await fetch(`/api/sessions/worktree-branches?${params.toString()}`);
    if (!response.ok) throw new Error(t('components.taskEditorDialog.managedWorktreesAreUnavailableForThisProject'));
    const data = await response.json();
    if (selectedProjectPath.value !== projectPath) return;
    branches.value = Array.isArray(data.branches) ? data.branches : [];
  } catch (exception) {
    branches.value = [];
    branchesError.value = messageOf(exception);
  } finally {
    branchesLoading.value = false;
  }
}

async function loadLaunchResources() {
  if (!selectedProjectPath.value || !selectedProfileId.value) return;
  const generation = ++loadingGeneration;
  loadingResources.value = true;
  error.value = '';
  branchesError.value = '';
  try {
    branches.value = [];
    const [loadedModels, loadedSkills, loadedCopyFiles, gitData] = await Promise.all([
      loadAgentProfileModels(selectedProfileId.value),
      loadAgentProfileSkills(selectedProfileId.value, selectedProjectPath.value),
      loadWorktreeCopyFiles(selectedProjectPath.value),
      loadGitStatus(selectedProjectPath.value),
    ]);
    if (generation !== loadingGeneration) return;
    models.value = loadedModels;
    availableSkills.value = loadedSkills;
    copyFiles.value = loadedCopyFiles;
    currentBranch.value = gitData.isGitRepo && !gitData.detached ? gitData.branch || '' : '';
    branchesError.value = gitData.isGitRepo ? '' : t('components.taskEditorDialog.managedWorktreesAreUnavailableForThisProject');

    const selectedStillExists = models.value.some((model) => model.provider === launchValue.value.modelProvider && model.id === launchValue.value.modelId);
    if (!selectedStillExists) {
      const profile = profiles.value.find((item) => item.id === selectedProfileId.value);
      const initial = models.value.find((model: ModelOption & { current?: boolean }) => model.current)
        || models.value.find((model) => model.provider === profile?.defaultProvider && model.id === profile?.defaultModel)
        || models.value[0];
      launchValue.value = {
        ...launchValue.value,
        modelProvider: initial?.provider || '',
        modelId: initial?.id || '',
      };
    }
    if (!props.task) applyCachedSkillOptions();
  } catch (exception) {
    if (generation === loadingGeneration) error.value = messageOf(exception);
  } finally {
    if (generation === loadingGeneration) loadingResources.value = false;
  }
}

function initialProfileId(): string {
  if (props.task?.agentProfileId) return props.task.agentProfileId;

  const selectedProfileExists = profiles.value.some((profile) => profile.id === props.selectedAgentProfileId);
  if (selectedProfileExists) return props.selectedAgentProfileId;

  return profiles.value[0]?.id || '';
}

// New tasks follow the last launch choice for this project; editing a task uses its saved snapshot instead.
function applyCachedSkillOptions(): void {
  const stored = readStoredSkillOptions(selectedProjectPath.value);

  if (stored.mode === 'preset') {
    const preset = props.presets.find((item) => item.id === stored.selectedPresetId);
    if (!preset) return;
    launchValue.value = {
      ...launchValue.value,
      skillSelection: 'preset',
      skillMode: preset.mode,
      skills: preset.skills,
      presetId: preset.id,
    };
    return;
  }
  if (stored.mode !== 'custom') return;

  const skillNames = new Set(availableSkills.value.map((skill) => skill.name));
  const skills = Array.isArray(stored.selectedSkills)
    ? stored.selectedSkills.filter((skill): skill is string => typeof skill === 'string' && skillNames.has(skill))
    : [];
  launchValue.value = {
    ...launchValue.value,
    skillSelection: 'custom',
    skillMode: stored.customMode === 'enabled' ? 'enabled' : 'disabled',
    skills,
    presetId: '',
  };
}

function readStoredSkillOptions(projectPath: string): StoredSkillOptions {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${projectPath || '~'}`) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function launchFromTask(task: ProjectTask): SessionLaunchValue {
  return {
    modelProvider: task.modelProvider,
    modelId: task.modelId,
    skillSelection: task.skillMode === 'all' ? 'all' : 'custom',
    skillMode: task.skillMode,
    skills: [...task.skills],
    presetId: '',
    worktree: task.worktree,
  };
}

function selectFolder(selection: string | { path: string }) {
  selectedProjectPath.value = typeof selection === 'string' ? selection : selection.path;
  if (!projectPaths.value.includes(selectedProjectPath.value)) projectPaths.value.push(selectedProjectPath.value);
  showFolderPicker.value = false;
}

async function polishTask() {
  if (polishingTask.value || !prompt.value.trim()) return;
  polishingTask.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/tasks/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, title: title.value, prompt: prompt.value }),
    });
    const data = await response.json().catch(() => ({})) as { content?: { title?: string; prompt?: string }; error?: string };
    if (!response.ok || !data.content?.title || !data.content?.prompt) throw new Error(data.error || t('components.taskEditorDialog.failedToPolishTask'));
    title.value = data.content.title;
    prompt.value = data.content.prompt;
  } catch (exception) {
    error.value = messageOf(exception);
  } finally {
    polishingTask.value = false;
  }
}

function submit() {
  if (submitDisabled.value) return;
  emit('save', {
    projectPath: selectedProjectPath.value,
    title: title.value.trim(),
    prompt: prompt.value.trim(),
    notes: notes.value,
    agentProfileId: selectedProfileId.value,
    ...toTaskLaunchSnapshot(launchValue.value),
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : t('components.taskEditorDialog.failedToLoadTaskSettings');
}

defineExpose({
  async preload() {
    await prepareForOpen();
    preloaded = true;
  },
});
</script>

<style scoped>
.task-editor-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.62);
}
.task-editor-dialog {
  width: min(1080px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}
.task-editor-header {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
}
.task-editor-header > div {
  min-width: 0;
}
.task-editor-header h2,
.task-editor-header p {
  margin: 0;
}
.task-editor-header p {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 13px;
}
.task-editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 18px;
  padding: 20px 24px;
}
.task-content-fields,
.task-launch-fields {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.task-launch-fields {
  gap: 6px;
  padding-left: 18px;
  border-left: 1px solid var(--border-color);
}
.task-editor-grid label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.task-editor-grid input,
.task-editor-grid textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  font: inherit;
}
.task-editor-grid textarea {
  resize: vertical;
}
.project-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.project-control button,
.task-editor-actions button {
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  background: var(--bg-secondary);
  cursor: pointer;
}
.task-resource-state {
  padding: 30px;
  color: var(--text-secondary);
  text-align: center;
}
.task-editor-error {
  margin: 0 24px;
  color: var(--error-color, #ef4444);
}
.task-prompt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.task-prompt-row label {
  margin: 0;
}
.task-ai-polish {
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
.task-ai-polish:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.task-editor-actions {
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  margin-top: 4px;
  padding: 0;
  border-top: 0;
}
.task-editor-actions .task-save {
  border-color: var(--accent);
  color: white;
  background: var(--accent);
}
.task-editor-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
@media (max-width: 768px) {
  .task-editor-backdrop {
    align-items: stretch;
    padding: 0;
  }
  .task-editor-dialog {
    width: 100%;
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
  }
  .task-editor-header {
    padding: calc(16px + env(safe-area-inset-top))
      calc(16px + env(safe-area-inset-right)) 16px
      calc(16px + env(safe-area-inset-left));
  }
  .task-editor-close {
    margin-top: -4px;
    color: var(--text-primary);
  }
  .task-editor-grid {
    grid-template-columns: 1fr;
    padding: 18px;
  }
  .task-launch-fields {
    padding: 18px 0 0;
    border-top: 1px solid var(--border-color);
    border-left: 0;
  }
}
</style>
