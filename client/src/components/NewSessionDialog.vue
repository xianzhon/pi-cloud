<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="new-session-backdrop">
        <section class="new-session-dialog" role="dialog" aria-modal="true" aria-labelledby="new-session-title">
          <header class="new-session-header">
            <div>
              <h2 id="new-session-title">{{ t('components.newSessionDialog.createSession') }}</h2>

            </div>
            <DialogCloseButton :label="t('components.newSessionDialog.closeNewSessionDialog')" @click="emit('close')" />
          </header>

          <form class="new-session-form" @submit.prevent="submit">

            <SessionLaunchSettings
              v-model="launchValue"
              id-prefix="new-session"
              :models="models"
              :available-skills="availableSkills"
              :presets="presets"
              :branches="branches"
              :copy-files="copyFiles"
              :current-branch="currentBranch"
              :branches-loading="branchesLoading"
              :branches-error="branchesError"
              @validity-change="launchValid = $event"
              @request-branches="emit('requestBranches')"
            />

            <p v-if="error" class="new-session-error" role="alert">{{ error }}</p>
            <footer class="new-session-actions">
              <button type="button" class="action-btn dialog-action action-btn-secondary create-session-cancel" :disabled="submitting" @click="emit('close')">{{ t('components.newSessionDialog.cancel') }}</button>
              <button ref="submitButtonRef" type="submit" class="action-btn dialog-action action-btn-primary create-session-submit" :disabled="submitDisabled">
                {{ submitting ? t('components.newSessionDialog.starting') : t('components.newSessionDialog.createSession') }}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import type { AvailableSkill } from '../composables/useAvailableSkills';
import type { SkillPreset } from '../composables/useSkillPresets';
import type { InitialSkillPolicy } from '../types/session';
import {
  defaultSessionLaunchValue,
  toSessionCreatePayload,
  type ModelOption,
  type SessionLaunchValue,
  type WorktreePayload,
} from '../types/sessionLaunch';
import DialogCloseButton from './DialogCloseButton.vue';
import SessionLaunchSettings from './SessionLaunchSettings.vue';

const t = i18n.global.t;

type StoredNewSessionOptions = {
  mode?: SessionLaunchValue['skillSelection'];
  customMode?: 'enabled' | 'disabled';
  selectedSkills?: string[];
  selectedPresetId?: string;
};

const props = withDefaults(defineProps<{
  visible: boolean;
  projectPath: string;
  agentProfileLabel: string;
  availableSkills: AvailableSkill[];
  presets: SkillPreset[];
  branches: string[];
  models?: ModelOption[];
  initialModel?: string;
  copyFiles?: string[];
  currentBranch?: string;
  branchesLoading?: boolean;
  branchesError?: string;
  initialSkillPolicy?: InitialSkillPolicy | null;
  submitting?: boolean;
  error?: string;
}>(), {
  models: () => [],
  initialModel: '',
  copyFiles: () => [],
  currentBranch: '',
  branchesLoading: false,
  branchesError: '',
  initialSkillPolicy: null,
  submitting: false,
  error: '',
});

const emit = defineEmits<{
  close: [];
  requestBranches: [];
  create: [payload: { cwd: string; modelProvider?: string; modelId?: string; enabledSkills?: string[]; disabledSkills?: string[]; presetId?: string; worktree?: WorktreePayload }];
}>();

const STORAGE_KEY = 'pi-cloud.newSessionOptions';

function storageKey(): string {
  return `${STORAGE_KEY}:${props.projectPath || '~'}`;
}

const launchValue = ref(defaultSessionLaunchValue());
const launchValid = ref(true);
const submitButtonRef = ref<HTMLButtonElement | null>(null);
const submitDisabled = computed(() => props.submitting || !launchValid.value);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    launchValue.value = applyInitialSkillPolicy(initialLaunchValue());
    void nextTick(() => submitButtonRef.value?.focus());
  },
  { immediate: true },
);

watch(
  () => props.presets,
  () => {
    if (launchValue.value.skillSelection !== 'preset') return;
    const preset = props.presets.find((item) => item.id === launchValue.value.presetId) || props.presets[0];
    if (!preset) {
      launchValue.value = { ...launchValue.value, skillSelection: 'all', skillMode: 'all', skills: [], presetId: '' };
      return;
    }
    launchValue.value = { ...launchValue.value, presetId: preset.id, skillMode: preset.mode, skills: preset.skills };
  },
);

function initialLaunchValue(): SessionLaunchValue {
  const stored = readStoredOptions();
  const availableNames = new Set(props.availableSkills.map((skill) => skill.name));
  const selectedSkills = Array.isArray(stored.selectedSkills)
    ? stored.selectedSkills.filter((skill): skill is string => typeof skill === 'string' && availableNames.has(skill))
    : [];
  const selectedPreset = props.presets.find((preset) => preset.id === stored.selectedPresetId) || props.presets[0];
  const requestedSelection = stored.mode === 'preset' || stored.mode === 'custom' ? stored.mode : 'all';
  const skillSelection = requestedSelection === 'preset' && !selectedPreset ? 'all' : requestedSelection;
  const [modelProvider = '', modelId = ''] = props.initialModel.split('\u0000');

  return {
    modelProvider,
    modelId,
    skillSelection,
    skillMode: skillSelection === 'preset'
      ? selectedPreset!.mode
      : skillSelection === 'custom' && stored.customMode === 'enabled' ? 'enabled' : skillSelection === 'custom' ? 'disabled' : 'all',
    skills: skillSelection === 'preset' ? selectedPreset!.skills : skillSelection === 'custom' ? selectedSkills : [],
    presetId: skillSelection === 'preset' ? selectedPreset!.id : selectedPreset?.id || '',
    worktree: { mode: 'none' },
  };
}

function readStoredOptions(): StoredNewSessionOptions {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function applyInitialSkillPolicy(value: SessionLaunchValue): SessionLaunchValue {
  const policy = props.initialSkillPolicy;
  if (!policy) return value;

  if (policy.presetId && props.presets.some((preset) => preset.id === policy.presetId)) {
    const preset = props.presets.find((item) => item.id === policy.presetId)!;
    return { ...value, skillSelection: 'preset', presetId: preset.id, skillMode: preset.mode, skills: preset.skills };
  }

  if (policy.mode === 'all') {
    return { ...value, skillSelection: 'all', skillMode: 'all', skills: [], presetId: '' };
  }

  const skillNames = new Set(props.availableSkills.map((skill) => skill.name));
  return {
    ...value,
    skillSelection: 'custom',
    skillMode: policy.mode,
    skills: policy.skills.filter((skill) => skillNames.has(skill)),
    presetId: '',
  };
}

function saveStoredOptions() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      mode: launchValue.value.skillSelection,
      customMode: launchValue.value.skillMode === 'enabled' ? 'enabled' : 'disabled',
      selectedSkills: launchValue.value.skills,
      selectedPresetId: launchValue.value.presetId,
    } satisfies StoredNewSessionOptions));
  } catch {
    // Session creation must still work when browser storage is unavailable.
  }
}

function submit() {
  if (submitDisabled.value) return;
  saveStoredOptions();
  emit('create', { cwd: props.projectPath, ...toSessionCreatePayload(launchValue.value) });
}
</script>

<style scoped>
.new-session-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.58);
}
.new-session-dialog {
  width: min(760px, 100%);
  max-height: min(900px, calc(100vh - 48px));
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}
.new-session-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
}
.new-session-header h2 {
  margin: 0;
  color: var(--text-primary);
}
.new-session-form {
  padding: 0 24px 24px;
}
.new-session-error {
  margin: 16px 0 0;
  color: var(--error-color, #ef4444);
  font-size: 13px;
}
.new-session-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 20px;
}
.action-btn {
  border: 1px solid var(--border-color);
  cursor: pointer;
}
.action-btn-secondary {
  color: var(--text-primary);
  background: var(--bg-secondary);
}
.action-btn-primary {
  border-color: var(--accent);
  color: white;
  background: var(--accent);
}
.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 160ms var(--ease-out);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
@media (max-width: 768px) {
  .new-session-backdrop {
    align-items: stretch;
    padding: 0;
  }
  .new-session-dialog {
    max-height: 100vh;
    border-radius: 0;
  }
}
</style>
