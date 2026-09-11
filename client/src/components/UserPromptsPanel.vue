<template>
  <section class="user-prompts-panel">
    <div>
      <h4>{{ t('components.userPromptsPanel.savedPrompts') }}</h4>
      <p>{{ t('components.userPromptsPanel.description') }}</p>
    </div>

    <div v-if="prompts.length" class="user-prompts-list">
      <article v-for="prompt in prompts" :key="prompt.id" class="user-prompt-card">
        <div class="user-prompt-copy">
          <strong>{{ prompt.name }}</strong>
          <p>{{ prompt.content }}</p>
        </div>
        <div class="user-prompt-actions">
          <button type="button" :aria-label="t('components.userPromptsPanel.edit')" @click="startEditing(prompt)"><PhPencilSimple :size="15" /></button>
          <button type="button" class="danger" :aria-label="t('components.userPromptsPanel.delete')" @click="emit('deletePrompt', prompt.id)"><PhTrash :size="15" /></button>
        </div>
      </article>
    </div>
    <p v-else class="empty-prompts">{{ t('components.userPromptsPanel.empty') }}</p>

    <form class="user-prompt-form" @submit.prevent="save">
      <h4>{{ editingId ? t('components.userPromptsPanel.editPrompt') : t('components.userPromptsPanel.addPrompt') }}</h4>
      <input v-model="name" type="text" :placeholder="t('components.userPromptsPanel.name')" />
      <textarea v-model="content" rows="7" :placeholder="t('components.userPromptsPanel.content')"></textarea>
      <div class="form-actions">
        <button type="submit" :disabled="!name.trim() || !content.trim()">{{ t('components.userPromptsPanel.save') }}</button>
        <button v-if="editingId" type="button" @click="reset">{{ t('components.userPromptsPanel.cancel') }}</button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { PhPencilSimple, PhTrash } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import type { UserPrompt, UserPromptInput } from '../composables/useUserPrompts';

const t = i18n.global.t;
const props = defineProps<{ prompts: UserPrompt[] }>();
const emit = defineEmits<{
  createPrompt: [input: UserPromptInput];
  updatePrompt: [payload: { id: string; changes: UserPromptInput }];
  deletePrompt: [id: string];
}>();
const editingId = ref<string | null>(null);
const name = ref('');
const content = ref('');

function startEditing(prompt: UserPrompt): void {
  editingId.value = prompt.id;
  name.value = prompt.name;
  content.value = prompt.content;
}

function reset(): void {
  editingId.value = null;
  name.value = '';
  content.value = '';
}

function save(): void {
  const changes = { name: name.value.trim(), content: content.value.trim() };
  if (!changes.name || !changes.content) return;
  if (editingId.value) emit('updatePrompt', { id: editingId.value, changes });
  else emit('createPrompt', changes);
  reset();
}
</script>

<style scoped>
.user-prompts-panel { display: grid; gap: 1.25rem; }
h4 { margin: 0; color: var(--text-primary); }
p { color: var(--text-secondary); }
.user-prompts-panel > div:first-child p, .empty-prompts { margin: 0.25rem 0 0; }
.user-prompts-list { display: grid; gap: 0.75rem; max-height: 16rem; overflow: auto; }
.user-prompt-card { display: flex; justify-content: space-between; gap: 1rem; padding: 0.875rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); }
.user-prompt-copy { min-width: 0; }
.user-prompt-copy p { margin: 0.35rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.user-prompt-actions { display: flex; gap: 0.5rem; }
.user-prompt-actions button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.user-prompt-actions button.danger { color: var(--error-color, #ef4444); }
.user-prompt-form { display: grid; gap: 0.75rem; }
.user-prompt-form input, .user-prompt-form textarea { width: 100%; box-sizing: border-box; }
.form-actions { display: flex; gap: 0.75rem; }
.form-actions button { padding: 0.55rem 1rem; }
</style>
