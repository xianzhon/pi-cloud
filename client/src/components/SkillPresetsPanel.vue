<template>
  <section class="skill-presets-panel">
    <div class="skill-presets-list-section">
      <div class="section-header">
        <h4>{{ t('components.skillPresetsPanel.existingPresets') }}</h4>
        <p>{{ t('components.skillPresetsPanel.savedPresetsAreAvailableWhenCreatingA') }}</p>
      </div>

      <div v-if="presets.length" class="skill-presets-list">
        <article v-for="preset in presets" :key="preset.id" class="preset-card">
          <div class="preset-card-copy">
            <div class="preset-card-header">
              <strong>{{ preset.name }}</strong>
              <span class="preset-mode-badge">{{ presetModeLabel(preset.mode) }}</span>
            </div>
            <p class="preset-skills-summary">{{ preset.skills.join(', ') || 'No skills selected' }}</p>
          </div>
          <div class="preset-card-actions">
            <button type="button" class="preset-icon-btn" :aria-label="t('components.skillPresetsPanel.editPreset')" :title="t('components.skillPresetsPanel.edit')" @click="startEditing(preset)">
              <PhPencilSimple :size="15" weight="bold" />
            </button>
            <button type="button" class="preset-icon-btn danger" :aria-label="t('components.skillPresetsPanel.deletePreset')" :title="t('components.skillPresetsPanel.delete')" @click="emit('deletePreset', preset.id)">
              <PhTrash :size="15" weight="bold" />
            </button>
          </div>
        </article>
      </div>
      <p v-else class="empty-presets">{{ t('components.skillPresetsPanel.noPresetsYet') }}</p>
    </div>

    <div class="skill-presets-form">
      <div class="section-header">
        <h4>{{ editingPresetId ? t('components.skillPresetsPanel.editPreset') : t('components.skillPresetsPanel.createPreset') }}</h4>
        <p>{{ editingPresetId ? t('components.skillPresetsPanel.updateThisPresetThenItWillReturnTo') : t('components.skillPresetsPanel.saveAReusableAllowlistOrBlocklistForFuture') }}</p>
      </div>
      <div class="preset-name-row">
        <input v-model="name" class="preset-name-input" type="text" :placeholder="t('components.skillPresetsPanel.presetName')" />
        <button type="button" class="preset-save-btn" @click="savePreset">{{ t('components.skillPresetsPanel.save') }}</button>
        <button v-if="editingPresetId" type="button" class="preset-cancel-btn" @click="resetForm">{{ t('components.skillPresetsPanel.cancel') }}</button>
      </div>
      <div class="preset-mode-row">
        <label>
          <input v-model="mode" class="preset-mode-enabled" type="radio" value="enabled" />
          {{ t('components.skillPresetsPanel.enableOnlySelectedSkills') }}
        </label>
        <label>
          <input v-model="mode" class="preset-mode-disabled" type="radio" value="disabled" />
          {{ t('components.skillPresetsPanel.disableSelectedSkills') }}
        </label>
      </div>
      <SkillPicker v-model="selectedSkills" :skills="availableSkills" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { ref } from 'vue';
import { PhPencilSimple, PhTrash } from '@phosphor-icons/vue';
import type { AvailableSkill } from '../composables/useAvailableSkills';
import type { SkillPreset, SkillPresetInput } from '../composables/useSkillPresets';
import SkillPicker from './SkillPicker.vue';

const t = i18n.global.t;

const props = defineProps<{
  presets: SkillPreset[];
  availableSkills: AvailableSkill[];
}>();

const emit = defineEmits<{
  createPreset: [payload: SkillPresetInput];
  updatePreset: [payload: { id: string; changes: SkillPresetInput }];
  deletePreset: [id: string];
}>();

const name = ref('');
const mode = ref<'enabled' | 'disabled'>('enabled');
const selectedSkills = ref<string[]>([]);
const editingPresetId = ref<string | null>(null);

function resetForm() {
  name.value = '';
  mode.value = 'enabled';
  selectedSkills.value = [];
  editingPresetId.value = null;
}

function startEditing(preset: SkillPreset) {
  editingPresetId.value = preset.id;
  name.value = preset.name;
  mode.value = preset.mode;
  selectedSkills.value = [...preset.skills];
}

function savePreset() {
  if (!name.value.trim()) return;
  const payload = {
    name: name.value.trim(),
    mode: mode.value,
    skills: selectedSkills.value,
  };
  if (editingPresetId.value) {
    emit('updatePreset', {
      id: editingPresetId.value,
      changes: payload,
    });
    resetForm();
    return;
  }
  emit('createPreset', payload);
  resetForm();
}

function presetModeLabel(mode: 'enabled' | 'disabled') {
  return mode === 'enabled' ? t('components.skillPresetsPanel.enableOnlySelectedSkills') : t('components.skillPresetsPanel.disableSelectedSkills');
}
</script>

<style scoped>
.skill-presets-panel {
  min-height: 0;
  display: grid;
  gap: 1.5rem;
}

.skill-presets-list-section,
.skill-presets-form {
  display: grid;
  gap: 1rem;
}

.preset-name-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: stretch;
}

.preset-name-input {
  min-width: 0;
}

.preset-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
}

.preset-mode-row label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.preset-save-btn,
.preset-cancel-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.preset-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  align-self: start;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, transform 120ms ease;
}

.preset-icon-btn:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.preset-icon-btn.danger {
  color: var(--error-color, #ef4444);
}

@media (max-width: 640px) {
  .preset-name-row {
    grid-template-columns: 1fr;
  }

  .preset-save-btn,
  .preset-cancel-btn {
    width: 100%;
  }
}

.section-header h4 {
  margin: 0;
  color: var(--text-primary);
}

.section-header p {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
}

.skill-presets-list {
  display: grid;
  gap: 0.75rem;
  max-height: 14rem;
  overflow: auto;
  padding-right: 0.25rem;
}

.preset-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.preset-card-actions {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
}

.preset-card-copy {
  min-width: 0;
}

.preset-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.preset-mode-badge {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.preset-skills-summary {
  margin: 0.375rem 0 0;
  color: var(--text-secondary);
  word-break: break-word;
}

.empty-presets {
  margin: 0;
  color: var(--text-secondary);
}
</style>
