<template>
  <div class="skill-picker">
    <div class="skill-picker-summary">
      <span>{{ t('components.skillPicker.selectionSummary', { selected: selectedCount, available: skills.length }) }}</span>
      <div class="skill-picker-actions" :aria-label="t('components.skillPicker.skillSelectionActions')">
        <button type="button" :disabled="!filteredSkills.length" @click="selectFiltered">{{ t('components.skillPicker.selectVisible') }}</button>
        <button type="button" :disabled="!modelValue.length" @click="clearSelection">{{ t('components.skillPicker.clearAll') }}</button>
        <button type="button" :disabled="!filteredSkills.length" @click="invertFiltered">{{ t('components.skillPicker.invertVisible') }}</button>
      </div>
    </div>

    <input
      v-model="query"
      type="text"
      class="skill-picker-search"
      :placeholder="t('components.skillPicker.searchSkills')"
    />

    <div v-if="filteredSkills.length" class="skill-picker-list">
      <section v-for="group in visibleSkillGroups" :key="group.title" class="skill-picker-group">
        <h5 class="skill-picker-group-title">{{ group.title }}</h5>
        <label
          v-for="skill in group.skills"
          :key="skill.name"
          class="skill-option"
        >
          <input
            class="skill-option-checkbox"
            type="checkbox"
            :checked="selectedNames.has(skill.name)"
            @change="toggleSkill(skill.name, ($event.target as HTMLInputElement).checked)"
          />
          <span class="skill-option-copy">
            <span class="skill-option-name">{{ skill.name }}</span>
            <span v-if="skill.description" class="skill-option-description">{{ skill.description }}</span>
          </span>
        </label>
      </section>
    </div>
    <p v-else class="skill-picker-empty">
      {{ skills.length ? t('components.skillPicker.noSkillsMatch', { query: query.trim() }) : t('components.skillPicker.noSkillsFound') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, ref } from 'vue';
import type { AvailableSkill } from '../composables/useAvailableSkills';

const t = i18n.global.t;

const props = defineProps<{
  skills: AvailableSkill[];
  modelValue: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const query = ref('');

const selectedNames = computed(() => new Set(props.modelValue));
const selectedCount = computed(() => props.modelValue.length);
const filteredSkills = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  if (!normalized) return props.skills;
  return props.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(normalized));
});
const visibleSkillGroups = computed(() => [
  { title: t('components.skillPicker.selected'), skills: filteredSkills.value.filter((skill) => selectedNames.value.has(skill.name)) },
  { title: t('components.skillPicker.available'), skills: filteredSkills.value.filter((skill) => !selectedNames.value.has(skill.name)) },
].filter((group) => group.skills.length));

function toggleSkill(name: string, checked: boolean): void {
  const next = checked
    ? Array.from(new Set([...props.modelValue, name]))
    : props.modelValue.filter((value) => value !== name);
  emit('update:modelValue', next);
}

function selectFiltered(): void {
  const visibleNames = filteredSkills.value.map((skill) => skill.name);
  emit('update:modelValue', Array.from(new Set([...props.modelValue, ...visibleNames])));
}

function clearSelection(): void {
  emit('update:modelValue', []);
}

function invertFiltered(): void {
  const visibleNames = filteredSkills.value.map((skill) => skill.name);
  const visibleSkillNames = new Set(visibleNames);
  const keptHiddenNames = props.modelValue.filter((name) => !visibleSkillNames.has(name));
  const invertedVisibleNames = visibleNames.filter((name) => !selectedNames.value.has(name));
  emit('update:modelValue', [...keptHiddenNames, ...invertedVisibleNames]);
}
</script>

<style scoped>
.skill-picker {
  display: grid;
  gap: 0.625rem;
}

.skill-picker-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.skill-picker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.skill-picker-actions button {
  min-height: 1.75rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  font-size: 0.75rem;
  cursor: pointer;
}

.skill-picker-actions button:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border));
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

.skill-picker-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.skill-picker-search {
  width: 100%;
}

.skill-picker-list {
  display: grid;
  gap: 0.625rem;
  max-height: 16rem;
  overflow: auto;
}

.skill-picker-group {
  display: grid;
  gap: 0.375rem;
}

.skill-picker-group-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.skill-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.625rem;
  align-items: start;
  padding: 0.5rem 0.625rem;
  background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.skill-option:hover {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border));
}

.skill-option-checkbox {
  margin-top: 0.125rem;
}

.skill-option-copy {
  min-width: 0;
  display: grid;
  gap: 0.125rem;
}

.skill-option-name {
  min-width: 0;
  color: var(--text-primary);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-option-description,
.skill-picker-empty {
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.35;
}

.skill-option-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.skill-picker-empty {
  margin: 0;
  padding: 0.75rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  text-align: center;
}
</style>
