<template>
  <section class="managed-skills">
    <p class="skill-description">{{ t('components.managedSkills.description') }}</p>
    <p v-if="error" role="alert" class="skill-error">{{ error }}</p>
    <div class="skill-list">
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
    </div>
    <button v-if="!showEditor" type="button" class="skill-add-toggle" :disabled="busy" @click="showEditor = true">{{ t('components.managedSkills.add') }}</button>
    <form v-show="showEditor" class="skill-editor" @submit.prevent="save">
      <label>{{ t('components.managedSkills.name') }} <input v-model="name" class="skill-name-input" :disabled="editing" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="64" /></label>
      <label>{{ t('components.managedSkills.content') }} <textarea v-model="content" required rows="9" spellcheck="false" /></label>
      <div class="skill-form-actions">
        <button v-if="!editing" type="button" class="skill-sample-btn" @click="useSample">{{ t('components.managedSkills.useSample') }}</button>
        <button type="submit" class="skill-primary-btn" :disabled="busy">{{ editing ? t('components.managedSkills.update') : t('components.managedSkills.add') }}</button>
        <button type="button" class="skill-cancel-btn" @click="reset">{{ t('components.managedSkills.cancel') }}</button>
      </div>
    </form>
    <form class="skill-clone" @submit.prevent="cloneSkill">
      <label for="skill-clone-url">{{ t('components.managedSkills.githubUrl') }}</label>
      <div class="skill-clone-row">
        <input id="skill-clone-url" v-model="url" type="url" required placeholder="https://github.com/owner/repo/tree/main/skills/example" />
        <button type="submit" class="skill-primary-btn" :disabled="busy" :aria-busy="cloning">
          <span v-if="cloning" class="skill-clone-spinner" aria-hidden="true" />
          {{ t('components.managedSkills.clone') }}
        </button>
      </div>
      <p v-if="cloneError" role="alert" class="skill-error">{{ cloneError }}</p>
      <p class="skill-description">{{ t('components.managedSkills.githubTip') }}</p>
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
const showEditor = ref(false);
const url = ref('');
const error = ref('');
const cloneError = ref('');
const busy = ref(false);
const cloning = ref(false);

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
  showEditor.value = true;
  error.value = '';
}
function reset() {
  name.value = '';
  content.value = '';
  editing.value = false;
  showEditor.value = false;
}
async function run(action: () => Promise<unknown>, errorTarget = error) {
  busy.value = true;
  errorTarget.value = '';
  try {
    await action();
    await load();
    reset();
    emit('changed');
  } catch (cause) {
    errorTarget.value = getApiErrorMessage(cause, t('components.managedSkills.failed'));
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
  cloning.value = true;
  try {
    await run(() => apiRequest('/api/sessions/managed-skills/clone', { method: 'POST', body: { url: url.value.trim() } }), cloneError);
    if (!cloneError.value) url.value = '';
  } finally {
    cloning.value = false;
  }
}
</script>

<style scoped>
.managed-skills { display: grid; gap: 1rem; }
.managed-skills p { margin: 0; }
.skill-description { color: var(--text-secondary); font-size: 0.875rem; line-height: 1.5; }
.skill-error { color: var(--error-color, #ef4444); }
.skill-list { border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.skill-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.5rem 0.75rem; min-height: 2.75rem; }
.skill-row + .skill-row { border-top: 1px solid var(--border); }
.skill-row strong { min-width: 0; overflow-wrap: anywhere; font-size: 0.875rem; }
.skill-actions { display: flex; align-items: center; gap: 0.4rem; flex: 0 0 auto; }
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
  transition: color 120ms ease, background 120ms ease;
}
.skill-icon-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
.skill-icon-btn.danger { color: var(--error-color, #ef4444); }
.skill-icon-btn.danger:hover { background: color-mix(in srgb, var(--error-color, #ef4444) 10%, transparent); }
.skill-add-toggle, .skill-form-actions button, .skill-clone-row button {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  white-space: nowrap;
}
.skill-add-toggle { justify-self: start; }
.skill-add-toggle:hover, .skill-form-actions button:hover, .skill-clone-row button:hover { background: var(--bg-tertiary); }
.skill-form-actions .skill-primary-btn, .skill-clone-row .skill-primary-btn { background: var(--accent); border-color: var(--accent); color: white; }
.skill-form-actions .skill-primary-btn:hover, .skill-clone-row .skill-primary-btn:hover { background: var(--accent-hover, var(--accent)); }
.managed-skills button:disabled { opacity: 0.5; cursor: not-allowed; }
.skill-editor { display: grid; gap: 0.85rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-secondary); }
.skill-editor label { display: grid; justify-items: start; gap: 0.4rem; color: var(--text-secondary); font-size: 0.875rem; }
.skill-editor input, .skill-editor textarea, .skill-clone input { min-width: 0; box-sizing: border-box; }
.skill-editor .skill-name-input { width: min(100%, 20rem); }
.skill-editor textarea { width: 100%; resize: vertical; font-family: var(--font-mono, monospace); }
.skill-form-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.skill-form-actions .skill-primary-btn { margin-left: auto; }
.skill-clone { display: grid; gap: 0.4rem; padding-top: 1rem; border-top: 1px solid var(--border); }
.skill-clone label { color: var(--text-secondary); font-size: 0.875rem; }
.skill-clone-row { display: flex; align-items: center; gap: 0.5rem; }
.skill-clone-row input { flex: 1; width: 100%; }
.skill-clone-spinner { display: inline-block; width: 0.85em; height: 0.85em; margin-right: 0.35em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: -0.1em; animation: skill-clone-spin 0.7s linear infinite; }
@keyframes skill-clone-spin { to { transform: rotate(360deg); } }
@media (max-width: 540px) {
  .skill-clone-row { flex-wrap: wrap; }
  .skill-clone-row button { margin-left: auto; }
}
</style>
