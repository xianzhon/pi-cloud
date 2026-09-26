<template>
  <section class="managed-skills">
    <h4>{{ t('components.managedSkills.title') }}</h4>
    <p>{{ t('components.managedSkills.description') }}</p>
    <p v-if="error" role="alert" class="skill-error">{{ error }}</p>
    <div v-for="skill in skills" :key="skill.name" class="skill-row">
      <strong>{{ skill.name }}</strong>
      <div class="skill-actions">
        <button type="button" class="skill-icon-btn" :aria-label="t('components.managedSkills.edit')" :title="t('components.managedSkills.edit')" :disabled="busy" @click="editSkill(skill)">
          <PhPencilSimple :size="15" weight="bold" />
        </button>
        <button type="button" class="skill-icon-btn danger" :aria-label="t('components.managedSkills.delete')" :title="t('components.managedSkills.delete')" :disabled="busy" @click="deleteSkill(skill)">
          <PhTrash :size="15" weight="bold" />
        </button>
      </div>
    </div>
    <form @submit.prevent="save">
      <label>{{ t('components.managedSkills.name') }} <input v-model="name" :disabled="!!editing" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="64" /></label>
      <label>{{ t('components.managedSkills.content') }} <textarea v-model="content" required rows="9" spellcheck="false" /></label>
      <button v-if="!editing" type="button" class="skill-sample-btn" @click="useSample">{{ t('components.managedSkills.useSample') }}</button>
      <div class="skill-actions">
        <button type="submit" :disabled="busy">{{ editing ? t('components.managedSkills.update') : t('components.managedSkills.add') }}</button>
        <button v-if="editing" type="button" @click="reset">{{ t('components.managedSkills.cancel') }}</button>
      </div>
    </form>
    <form @submit.prevent="cloneSkill">
      <label>{{ t('components.managedSkills.githubUrl') }} <input v-model="url" type="url" required placeholder="https://github.com/owner/repo/tree/main/skills/example" /></label>
      <button type="submit" :disabled="busy">{{ t('components.managedSkills.clone') }}</button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { PhPencilSimple, PhTrash } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { apiRequest, getApiErrorMessage } from '../services/apiClient';

const t = i18n.global.t;
const emit = defineEmits<{ changed: [] }>();
const skills = ref<{ name: string; content: string }[]>([]);
const name = ref('');
const content = ref('');
const editing = ref(false);
const url = ref('');
const error = ref('');
const busy = ref(false);

function sample(skillName: string) {
  return `---\nname: ${skillName}\ndescription: Helps with a specific task using a repeatable workflow.\n---\n\n# ${skillName}\n\n## Instructions\n\n1. Describe when to use this skill.\n2. List the steps the agent should follow.\n`;
}
function useSample() {
  if (!name.value.trim()) name.value = 'example';
  content.value = sample(name.value.trim());
}
watch(name, (current, previous) => {
  if (!editing.value && content.value === sample(previous.trim())) content.value = sample(current.trim());
});

async function load() {
  skills.value = (await apiRequest<{ skills: { name: string; content: string }[] }>('/api/sessions/managed-skills')).skills;
}
onMounted(() => { void load().catch((cause) => { error.value = getApiErrorMessage(cause, t('components.managedSkills.failed')); }); });

function editSkill(skill: { name: string; content: string }) {
  name.value = skill.name;
  content.value = skill.content;
  editing.value = true;
  error.value = '';
}
function reset() {
  name.value = '';
  content.value = '';
  editing.value = false;
}
async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    await load();
    reset();
    emit('changed');
  } catch (cause) {
    error.value = getApiErrorMessage(cause, t('components.managedSkills.failed'));
  } finally {
    busy.value = false;
  }
}
async function save() {
  const skillName = name.value.trim();
  const path = `/api/sessions/managed-skills${editing.value ? `/${encodeURIComponent(skillName)}` : ''}`;
  await run(() => apiRequest(path, { method: editing.value ? 'PUT' : 'POST', body: editing.value ? { content: content.value } : { name: skillName, content: content.value } }));
}
async function deleteSkill(skill: { name: string; content: string }) {
  if (!window.confirm(t('components.managedSkills.deleteConfirm', { name: skill.name }))) return;
  await run(() => apiRequest(`/api/sessions/managed-skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' }));
}
async function cloneSkill() {
  await run(() => apiRequest('/api/sessions/managed-skills/clone', { method: 'POST', body: { url: url.value.trim() } }));
  if (!error.value) url.value = '';
}
</script>

<style scoped>
.managed-skills, .managed-skills form { display: grid; gap: 0.75rem; }

.managed-skills h4, .managed-skills p { margin: 0; }
.managed-skills label { display: grid; gap: 0.3rem; }
.managed-skills input, .managed-skills textarea { width: 100%; min-width: 0; box-sizing: border-box; }
.skill-row, .skill-actions { display: flex; align-items: center; gap: 0.75rem; }
.skill-row { justify-content: space-between; }
.skill-sample-btn { justify-self: start; }
.skill-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, transform 120ms ease;
}
.skill-icon-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
.skill-icon-btn.danger { color: var(--error-color, #ef4444); }
.skill-error { color: var(--error-color, #ef4444); }
</style>
