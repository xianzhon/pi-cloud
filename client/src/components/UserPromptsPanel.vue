<template>
  <section class="user-prompts-panel">
    <div class="section-header">
      <h4>{{ t('components.userPromptsPanel.savedPrompts') }}</h4>
      <p>{{ t('components.userPromptsPanel.description') }}</p>
    </div>

    <div v-if="prompts.length" class="user-prompts-list">
      <article v-for="prompt in prompts" :key="prompt.id" class="user-prompt-card">
        <div class="user-prompt-copy">
          <div class="user-prompt-heading">
            <strong>{{ prompt.name }}</strong>
            <time :datetime="prompt.updatedAt">{{ t('components.userPromptsPanel.updated', { date: formatDate(prompt.updatedAt) }) }}</time>
          </div>
          <p>{{ prompt.content }}</p>
        </div>
        <div class="user-prompt-actions">
          <button type="button" :aria-label="t('components.userPromptsPanel.edit')" :title="t('components.userPromptsPanel.edit')" @click="startEditing(prompt)"><PhPencilSimple :size="15" weight="bold" /></button>
          <button type="button" class="danger" :aria-label="t('components.userPromptsPanel.delete')" :title="t('components.userPromptsPanel.delete')" @click="emit('deletePrompt', prompt.id)"><PhTrash :size="15" weight="bold" /></button>
        </div>
      </article>
    </div>
    <p v-else class="empty-prompts">{{ t('components.userPromptsPanel.empty') }}</p>

    <form class="user-prompt-form" @submit.prevent="save">
      <h4>{{ editingId ? t('components.userPromptsPanel.editPrompt') : t('components.userPromptsPanel.addPrompt') }}</h4>
      <label class="form-field">
        <span>{{ t('components.userPromptsPanel.name') }}</span>
        <input v-model="name" type="text" :placeholder="t('components.userPromptsPanel.name')" />
      </label>
      <label class="form-field">
        <span>{{ t('components.userPromptsPanel.content') }}</span>
        <textarea v-model="content" rows="7" :placeholder="t('components.userPromptsPanel.content')"></textarea>
      </label>
      <div class="form-actions">
        <button v-if="editingId" type="button" class="prompt-action-button" @click="reset">{{ t('components.userPromptsPanel.cancel') }}</button>
        <button type="submit" class="prompt-action-button save-button" :disabled="!name.trim() || !content.trim()">
          <PhFloppyDisk :size="16" />
          {{ t('components.userPromptsPanel.save') }}
        </button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { PhFloppyDisk, PhPencilSimple, PhTrash } from '@phosphor-icons/vue';
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

function formatDate(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('components.sessionSidebar.justNow');
  if (diffMins < 60) return formatRelativeUnit(diffMins, 'minute');
  if (diffHours < 24) return formatRelativeUnit(diffHours, 'hour');
  if (diffDays < 7) return formatRelativeUnit(diffDays, 'day');
  return date.toLocaleDateString();
}

function formatRelativeUnit(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  if (i18n.global.locale.value !== 'en') {
    return new Intl.RelativeTimeFormat(i18n.global.locale.value, { numeric: 'always', style: 'long' }).format(-value, unit);
  }
  if (unit === 'minute') return `${value}m ago`;
  if (unit === 'hour') return `${value}h ago`;
  return `${value}d ago`;
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
.user-prompts-panel {
  min-height: 0;
  display: grid;
  gap: 1.5rem;
}

h4 {
  margin: 0;
  color: var(--text-primary);
}

.section-header p,
.empty-prompts {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
}

.user-prompts-list {
  display: grid;
  gap: 0.75rem;
  max-height: 15rem;
  overflow: auto;
  padding-right: 0.25rem;
}

.user-prompt-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.user-prompt-card:hover {
  border-color: color-mix(in srgb, var(--border) 65%, var(--accent));
  background: var(--bg-elevated);
}

.user-prompt-copy {
  min-width: 0;
}

.user-prompt-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.75rem;
}

.user-prompt-copy strong {
  color: var(--text-primary);
  line-height: 1.4;
}

.user-prompt-heading time {
  color: var(--text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.user-prompt-copy p {
  display: -webkit-box;
  margin: 0.4rem 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.user-prompt-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.5rem;
}

.user-prompt-actions button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.user-prompt-actions button:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: color-mix(in srgb, var(--border) 65%, var(--accent));
}

.user-prompt-actions button.danger {
  color: var(--error-color, #ef4444);
}

.user-prompt-form {
  display: grid;
  gap: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
}

.form-field {
  display: grid;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
}

.form-field input,
.form-field textarea {
  width: 100%;
  box-sizing: border-box;
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 400;
}

.form-field textarea {
  min-height: 10rem;
  resize: vertical;
  line-height: 1.5;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.prompt-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  box-sizing: border-box;
  min-width: 5.5rem;
  min-height: 36px;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.prompt-action-button:hover:not(:disabled) {
  background: var(--bg-elevated);
}

.prompt-action-button.save-button {
  color: white;
  background: var(--accent);
  border-color: transparent;
}

.prompt-action-button.save-button:hover:not(:disabled) {
  filter: brightness(1.08);
}

.prompt-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 640px) {
  .user-prompt-card {
    gap: 0.75rem;
  }

  .form-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-actions .save-button:only-child {
    grid-column: 2;
  }
}
</style>
