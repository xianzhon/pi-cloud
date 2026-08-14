<template>
  <section v-if="worktreeAvailable" class="launch-section">
    <div class="section-heading" :title="t('components.sessionLaunchSettings.useTheCurrentWorkspaceDirectlyOrIsolate')">
      <h3>{{ t('components.sessionLaunchSettings.whereShouldThisSessionWork') }}</h3>
    </div>
    <div class="work-location-list">
      <label class="mode-card compact-option" :class="{ active: workLocation === 'workspace' }" :title="t('components.sessionLaunchSettings.workDirectlyInTheSelectedProjectDirectory')">
        <input :checked="workLocation === 'workspace'" type="radio" value="workspace" :name="fieldName('work-location')" @change="setWorkLocation('workspace')" />
        <span class="mode-card-title">{{ t('components.sessionLaunchSettings.currentWorkspace') }}</span>
      </label>

      <div class="worktree-choice" :class="{ active: workLocation === 'worktree' }">
        <label class="worktree-choice-header compact-option" :title="t('components.sessionLaunchSettings.createOrUseABranchWorktreeManaged')">
          <input :checked="workLocation === 'worktree'" type="radio" value="worktree" :name="fieldName('work-location')" @change="setWorkLocation('worktree')" />
          <span>
            <span class="mode-card-title">{{ t('components.sessionLaunchSettings.managedGitWorktree') }}</span>
            <span class="mode-card-copy">{{ t('components.sessionLaunchSettings.createAnIsolatedWorktreeForThisSession') }}</span>
          </span>
        </label>

        <div v-if="workLocation === 'worktree'" class="config-panel worktree-panel">
          <div class="section-heading compact worktree-panel-heading">
            <h3>{{ t('components.sessionLaunchSettings.worktreeSetup') }}</h3>
            <p>{{ t('components.sessionLaunchSettings.theseSettingsOnlyApplyToTheManaged') }}</p>
          </div>
          <p v-if="branchesLoading" class="field-hint">{{ t('components.sessionLaunchSettings.loadingLocalBranches') }}</p>
          <p v-else-if="branchesError" class="field-hint error">{{ branchesError }}</p>

          <div class="branch-mode-tabs" role="radiogroup" :aria-label="t('components.sessionLaunchSettings.branchMode')">
            <label class="branch-mode-tab" :class="{ active: branchMode === 'new' }">
              <input :checked="branchMode === 'new'" type="radio" value="new" :name="fieldName('branch-mode')" @change="setBranchMode('new')" />
              <span>{{ t('components.sessionLaunchSettings.createNewBranch') }}</span>
            </label>
            <label class="branch-mode-tab" :class="{ active: branchMode === 'existing' }">
              <input :checked="branchMode === 'existing'" type="radio" value="existing" :name="fieldName('branch-mode')" @change="setBranchMode('existing')" />
              <span>{{ t('components.sessionLaunchSettings.useExistingBranch') }}</span>
            </label>
          </div>

          <template v-if="branchMode === 'new'">
            <label class="field-label" :for="`${idPrefix}-branch-name`">{{ t('components.sessionLaunchSettings.branchName') }}</label>
            <input :id="`${idPrefix}-branch-name`" :value="newBranchName" class="preset-select launch-control" placeholder="feature/my-task" @input="setNewBranchName" />
            <label class="field-label" :for="`${idPrefix}-base-branch`">{{ t('components.sessionLaunchSettings.baseBranch') }}</label>
            <CustomSelect class="launch-control" :id="`${idPrefix}-base-branch`" :model-value="baseBranch" :options="branchOptions" :placeholder="t('components.sessionLaunchSettings.selectABaseBranch')" :aria-label="t('components.sessionLaunchSettings.baseBranch')" @update:model-value="setBaseBranch" />
          </template>
          <template v-else>
            <label class="field-label" :for="`${idPrefix}-existing-branch`">{{ t('components.sessionLaunchSettings.existingBranch') }}</label>
            <CustomSelect class="launch-control" :id="`${idPrefix}-existing-branch`" :model-value="existingBranch" :options="branchOptions" :placeholder="t('components.sessionLaunchSettings.selectABranch')" :aria-label="t('components.sessionLaunchSettings.existingBranch')" @update:model-value="setExistingBranch" />
          </template>

          <div class="optional-group">
            <span class="optional-title">{{ t('components.sessionLaunchSettings.optionalFiles') }}</span>
            <CustomSelect class="launch-control" :id="`${idPrefix}-copy-file`" :model-value="copyFile" :options="copyFileOptions" :placeholder="t('components.sessionLaunchSettings.none')" :aria-label="t('components.sessionLaunchSettings.copyIgnoredRootFile')" @update:model-value="setCopyFile" />
            <p class="field-hint">{{ copyFiles.length ? t('components.sessionLaunchSettings.chooseAnIgnoredFileFromTheProjectRoot') : t('components.sessionLaunchSettings.noIgnoredRootLevelFilesFound') }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="launch-section">
    <div class="section-heading compact">
      <h3>{{ t('components.sessionLaunchSettings.model') }}</h3>
      <p v-if="requireModel">{{ t('components.sessionLaunchSettings.chooseTheModelThisTaskWillUse') }}</p>
    </div>
    <CustomSelect class="launch-control launch-control-wide" :model-value="selectedModel" :options="modelOptions" :placeholder="requireModel ? t('components.sessionLaunchSettings.selectAModel') : t('components.sessionLaunchSettings.useProfileDefault')" :aria-label="t('components.sessionLaunchSettings.sessionModel')" @update:model-value="setModel" />
  </section>

  <section class="launch-section">
    <div class="section-heading">
      <h3>{{ t('components.sessionLaunchSettings.skills') }}</h3>
    </div>
    <div class="mode-grid" role="radiogroup" :aria-label="t('components.sessionLaunchSettings.sessionMode')">
      <label class="mode-card" :class="{ active: modelValue.skillSelection === 'preset' }">
        <input :checked="modelValue.skillSelection === 'preset'" type="radio" value="preset" :name="fieldName('session-mode')" @change="setSkillSelection('preset')" />
        <span class="mode-card-title">{{ t('components.sessionLaunchSettings.preset') }}</span>
        <span class="mode-card-copy">{{ t('components.sessionLaunchSettings.snapshotASavedSkillSetup') }}</span>
      </label>
      <label class="mode-card" :class="{ active: modelValue.skillSelection === 'all' }">
        <input :checked="modelValue.skillSelection === 'all'" type="radio" value="all" :name="fieldName('session-mode')" @change="setSkillSelection('all')" />
        <span class="mode-card-title">{{ t('components.sessionLaunchSettings.allSkills') }}</span>
        <span class="mode-card-copy">{{ t('components.sessionLaunchSettings.useTheFullAvailableSkillSet') }}</span>
      </label>
      <label class="mode-card" :class="{ active: modelValue.skillSelection === 'custom' }">
        <input :checked="modelValue.skillSelection === 'custom'" type="radio" value="custom" :name="fieldName('session-mode')" @change="setSkillSelection('custom')" />
        <span class="mode-card-title">{{ t('components.sessionLaunchSettings.customSkills') }}</span>
        <span class="mode-card-copy">{{ t('components.sessionLaunchSettings.allowOrBlockSelectedSkills') }}</span>
      </label>
    </div>
  </section>

  <section class="launch-section config-panel" aria-live="polite">
    <template v-if="modelValue.skillSelection === 'preset'">
      <CustomSelect class="launch-control" :id="`${idPrefix}-preset`" :model-value="modelValue.presetId" :options="presetOptions" :placeholder="t('components.sessionLaunchSettings.selectAPreset')" :aria-label="t('components.sessionLaunchSettings.savedPreset')" @update:model-value="setPreset" />
      <p class="field-hint">{{ presets.length ? t('components.sessionLaunchSettings.theResolvedPolicyIsStoredWithThisLaunch') : t('components.sessionLaunchSettings.noPresetsAreAvailable') }}</p>
    </template>
    <template v-else-if="modelValue.skillSelection === 'custom'">
      <div class="custom-mode-group" role="radiogroup" :aria-label="t('components.sessionLaunchSettings.customSkillMode')">
        <label class="toggle-card" :class="{ active: modelValue.skillMode === 'enabled' }">
          <input :checked="modelValue.skillMode === 'enabled'" class="custom-mode-enabled" type="radio" value="enabled" :name="fieldName('custom-mode')" @change="setSkillMode('enabled')" />
          <span class="toggle-card-title">{{ t('components.sessionLaunchSettings.enableOnlySelectedSkills') }}</span>
        </label>
        <label class="toggle-card" :class="{ active: modelValue.skillMode === 'disabled' }">
          <input :checked="modelValue.skillMode === 'disabled'" class="custom-mode-disabled" type="radio" value="disabled" :name="fieldName('custom-mode')" @change="setSkillMode('disabled')" />
          <span class="toggle-card-title">{{ t('components.sessionLaunchSettings.disableSelectedSkills') }}</span>
        </label>
      </div>
      <div class="skill-picker-panel">
        <div class="skill-picker-header"><h4>{{ t('components.sessionLaunchSettings.selectSkills') }}</h4></div>
        <SkillPicker :model-value="modelValue.skills" :skills="availableSkills" @update:model-value="patch({ skills: $event })" />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, watch } from 'vue';
import type { AvailableSkill } from '../composables/useAvailableSkills';
import type { SkillPreset } from '../composables/useSkillPresets';
import type { ModelOption, SessionLaunchValue, SkillMode } from '../types/sessionLaunch';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';
import SkillPicker from './SkillPicker.vue';

const t = i18n.global.t;

const props = withDefaults(defineProps<{
  modelValue: SessionLaunchValue;
  models: ModelOption[];
  availableSkills: AvailableSkill[];
  presets: SkillPreset[];
  branches: string[];
  idPrefix: string;
  copyFiles?: string[];
  currentBranch?: string;
  branchesLoading?: boolean;
  branchesError?: string;
  requireModel?: boolean;
}>(), {
  copyFiles: () => [],
  currentBranch: '',
  branchesLoading: false,
  branchesError: '',
  requireModel: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: SessionLaunchValue];
  'validity-change': [valid: boolean];
  'request-branches': [];
}>();

const worktreeAvailable = computed(() => !props.branchesError);
const workLocation = computed(() => props.modelValue.worktree.mode === 'managed' ? 'worktree' : 'workspace');
const branchMode = computed(() => props.modelValue.worktree.mode === 'managed' ? props.modelValue.worktree.branchMode : 'new');
const newBranchName = computed(() => props.modelValue.worktree.mode === 'managed' && props.modelValue.worktree.branchMode === 'new' ? props.modelValue.worktree.branchName : '');
const baseBranch = computed(() => props.modelValue.worktree.mode === 'managed' && props.modelValue.worktree.branchMode === 'new' ? props.modelValue.worktree.baseBranch : defaultBaseBranch());
const existingBranch = computed(() => props.modelValue.worktree.mode === 'managed' && props.modelValue.worktree.branchMode === 'existing' ? props.modelValue.worktree.branchName : '');
const copyFile = computed(() => props.modelValue.worktree.mode === 'managed' ? props.modelValue.worktree.copyFile || '' : '');
const selectedModel = computed(() => props.modelValue.modelProvider && props.modelValue.modelId ? `${props.modelValue.modelProvider}\u0000${props.modelValue.modelId}` : '');
const branchOptions = computed<CustomSelectOption[]>(() => prioritizedBranches().map((branch) => ({ value: branch, label: branch })));
const copyFileOptions = computed<CustomSelectOption[]>(() => [{ value: '', label: t('components.sessionLaunchSettings.none') }, ...props.copyFiles.map((file) => ({ value: file, label: file }))]);
const presetOptions = computed<CustomSelectOption[]>(() => props.presets.map((preset) => ({ value: preset.id, label: preset.name })));
const modelOptions = computed<CustomSelectOption[]>(() => [
  ...(props.requireModel ? [] : [{ value: '', label: t('components.sessionLaunchSettings.useProfileDefault') }]),
  ...props.models.map((model) => ({ value: `${model.provider}\u0000${model.id}`, label: `${model.name || model.id} [${model.provider}]` })),
]);
const valid = computed(() => {
  if (props.requireModel && (!props.modelValue.modelProvider || !props.modelValue.modelId)) return false;
  if (props.modelValue.skillSelection === 'preset' && !props.modelValue.presetId) return false;
  if (props.modelValue.worktree.mode === 'managed') {
    if (!props.modelValue.worktree.branchName.trim()) return false;
    if (props.modelValue.worktree.branchMode === 'new' && !props.modelValue.worktree.baseBranch) return false;
  }
  return true;
});

watch(valid, (value) => emit('validity-change', value), { immediate: true });

function patch(value: Partial<SessionLaunchValue>) {
  emit('update:modelValue', { ...props.modelValue, ...value });
}

function fieldName(base: string): string {
  return props.idPrefix === 'new-session' ? base : `${props.idPrefix}-${base}`;
}

function prioritizedBranches(): string[] {
  if (!props.currentBranch) return props.branches;
  return [props.currentBranch, ...props.branches.filter((branch) => branch !== props.currentBranch)];
}

function defaultBaseBranch(): string {
  return prioritizedBranches()[0] || '';
}

function setModel(value: string) {
  const [modelProvider = '', modelId = ''] = value.split('\u0000');
  patch({ modelProvider, modelId });
}

function setSkillSelection(selection: SessionLaunchValue['skillSelection']) {
  if (selection === 'all') return patch({ skillSelection: 'all', skillMode: 'all', skills: [], presetId: '' });
  if (selection === 'preset') {
    const preset = props.presets.find((item) => item.id === props.modelValue.presetId) || props.presets[0];
    return patch({
      skillSelection: 'preset',
      presetId: preset?.id || '',
      skillMode: preset?.mode || 'enabled',
      skills: preset?.skills || [],
    });
  }
  patch({ skillSelection: 'custom', presetId: '', skillMode: props.modelValue.skillMode === 'enabled' ? 'enabled' : 'disabled' });
}

function setPreset(id: string) {
  const preset = props.presets.find((item) => item.id === id);
  patch({ presetId: id, skillMode: preset?.mode || 'enabled', skills: preset?.skills || [] });
}

function setSkillMode(skillMode: SkillMode) {
  patch({ skillMode });
}

function setWorkLocation(location: 'workspace' | 'worktree') {
  if (location === 'workspace') return patch({ worktree: { mode: 'none' } });
  emit('request-branches');
  patch({ worktree: { mode: 'managed', branchMode: 'new', branchName: '', baseBranch: defaultBaseBranch() } });
}

function setBranchMode(mode: 'new' | 'existing') {
  emit('request-branches');
  if (mode === 'new') patch({ worktree: { mode: 'managed', branchMode: 'new', branchName: '', baseBranch: defaultBaseBranch() } });
  else {
    patch({ worktree: { mode: 'managed', branchMode: 'existing', branchName: '' } });
  }
}

function setNewBranchName(event: Event) {
  patch({ worktree: { mode: 'managed', branchMode: 'new', branchName: (event.target as HTMLInputElement).value, baseBranch: baseBranch.value, ...(copyFile.value ? { copyFile: copyFile.value } : {}) } });
}
function setBaseBranch(value: string) {
  patch({ worktree: { mode: 'managed', branchMode: 'new', branchName: newBranchName.value, baseBranch: value, ...(copyFile.value ? { copyFile: copyFile.value } : {}) } });
}
function setExistingBranch(value: string) {
  patch({ worktree: { mode: 'managed', branchMode: 'existing', branchName: value, ...(copyFile.value ? { copyFile: copyFile.value } : {}) } });
}
function setCopyFile(value: string) {
  const suffix = value ? { copyFile: value } : {};
  if (branchMode.value === 'new') patch({ worktree: { mode: 'managed', branchMode: 'new', branchName: newBranchName.value, baseBranch: baseBranch.value, ...suffix } });
  else patch({ worktree: { mode: 'managed', branchMode: 'existing', branchName: existingBranch.value, ...suffix } });
}
</script>

<style scoped>
.launch-section {
  margin: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}
.section-heading {
  margin-bottom: 8px;
}
.section-heading h3,
.skill-picker-header h4 {
  margin: 0;
  color: var(--text-primary);
}
.section-heading p,
.field-hint {
  margin: 3px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.mode-grid,
.custom-mode-group {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.work-location-list {
  display: grid;
  gap: 8px;
}
.custom-mode-group {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 10px;
}
.mode-card,
.toggle-card,
.worktree-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 8px;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition:
    border-color 0.14s ease,
    background 0.14s ease;
}
.mode-card,
.toggle-card,
.worktree-choice-header,
.branch-mode-tab {
  cursor: pointer;
}
.compact-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
}
.mode-card:hover,
.toggle-card:hover,
.worktree-choice:hover {
  border-color: color-mix(
    in srgb,
    var(--accent-color) 55%,
    var(--border-color)
  );
}
.mode-card.active,
.toggle-card.active,
.worktree-choice.active {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}
.mode-card input,
.toggle-card input {
  grid-row: 1;
  align-self: center;
  margin-top: 1px;
}
.compact-option input {
  align-self: center;
}
.mode-card-title,
.toggle-card-title {
  min-width: 0;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.25;
}
.mode-card-copy,
.toggle-card-copy {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
}
.mode-card > .mode-card-copy,
.toggle-card-copy {
  grid-column: 2;
}
.worktree-choice {
  grid-template-columns: minmax(0, 1fr);
}
.worktree-choice-header {
  width: fit-content;
}
.config-panel {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.worktree-panel {
  display: grid;
  gap: 8px;
  margin-left: 24px;
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
}
.worktree-panel-heading {
  margin-bottom: 0;
}
.branch-mode-tabs {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 420px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}
.branch-mode-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.branch-mode-tab.active {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
}
.optional-group {
  display: grid;
  gap: 7px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}
.optional-title {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.field-label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.launch-control {
  max-width: 360px;
}
.launch-control-wide {
  max-width: 460px;
}
.preset-select {
  width: 100%;
  box-sizing: border-box;
  padding: 9px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  background: var(--bg-secondary);
}
.skill-picker-panel {
  margin-top: 8px;
}
.skill-picker-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.error {
  color: var(--error-color, #ef4444);
}
@media (max-width: 768px) {
  .mode-grid,
  .custom-mode-group,
  .branch-mode-tabs {
    grid-template-columns: 1fr;
  }
  .worktree-panel {
    margin-left: 0;
  }
  .launch-control,
  .launch-control-wide {
    max-width: none;
  }
}
</style>
