<template>
  <section class="user-prompts-panel">
    <header class="section-header">
      <p>{{ t('components.userPromptsPanel.description') }}</p>
    </header>

    <div class="prompt-workspace">
      <section class="prompt-library" :aria-label="t('components.userPromptsPanel.savedPrompts')">
        <div class="prompt-library-header">
          <div class="prompt-library-title">
            <span>{{ t('components.userPromptsPanel.savedPrompts') }}</span>
            <span class="prompt-count">{{ prompts.length }}</span>
          </div>
          <button type="button" class="add-prompt-button" :disabled="saving" @click="startCreating">
            <PhPlus :size="14" weight="bold" aria-hidden="true" />
            {{ t('components.userPromptsPanel.addPrompt') }}
          </button>
        </div>

        <div v-if="prompts.length" class="user-prompts-list">
          <article
            v-for="prompt in prompts"
            :key="prompt.id"
            class="user-prompt-card"
            :class="{ active: selectedId === prompt.id }"
            @click="selectPrompt(prompt)"
          >
            <div class="user-prompt-copy">
              <div class="user-prompt-heading">
                <strong>{{ prompt.name }}</strong>
                <time :datetime="prompt.updatedAt">{{ t('components.userPromptsPanel.updated', { date: formatDate(prompt.updatedAt) }) }}</time>
              </div>
              <p>{{ prompt.content }}</p>
            </div>
            <div class="user-prompt-actions">
              <button type="button" :aria-label="t('components.userPromptsPanel.edit')" :title="t('components.userPromptsPanel.edit')" @click.stop="startEditing(prompt)"><PhPencilSimple :size="15" weight="bold" /></button>
              <button type="button" class="danger" :aria-label="t('components.userPromptsPanel.delete')" :title="t('components.userPromptsPanel.delete')" @click.stop="emit('deletePrompt', prompt.id)"><PhTrash :size="15" weight="bold" /></button>
            </div>
          </article>
        </div>
        <div v-else class="empty-prompts">
          <strong>{{ t('components.userPromptsPanel.empty') }}</strong>
          <p>{{ t('components.userPromptsPanel.description') }}</p>
        </div>
      </section>

      <section v-if="mode === 'preview'" class="prompt-preview">
        <template v-if="selectedPrompt">
          <div class="preview-header">
            <div>
              <h4>{{ selectedPrompt.name }}</h4>
              <time :datetime="selectedPrompt.updatedAt">{{ t('components.userPromptsPanel.updated', { date: formatDate(selectedPrompt.updatedAt) }) }}</time>
            </div>
            <button type="button" class="prompt-action-button" @click="startEditing(selectedPrompt)">
              <PhPencilSimple :size="15" weight="bold" aria-hidden="true" />
              {{ t('components.userPromptsPanel.edit') }}
            </button>
          </div>
          <div class="preview-content">{{ selectedPrompt.content }}</div>
        </template>
        <div v-else class="empty-prompts">
          <strong>{{ t('components.userPromptsPanel.empty') }}</strong>
          <p>{{ t('components.userPromptsPanel.description') }}</p>
        </div>
      </section>

      <form v-else class="user-prompt-form" @submit.prevent="save">
        <div class="form-header">
          <div>
            <h4>{{ editingId ? t('components.userPromptsPanel.editPrompt') : t('components.userPromptsPanel.addPrompt') }}</h4>
            <p>{{ editingId ? t('components.userPromptsPanel.editDescription') : t('components.userPromptsPanel.addDescription') }}</p>
          </div>
        </div>
        <label class="form-field name-field">
          <span>{{ t('components.userPromptsPanel.name') }}</span>
          <input v-model="name" type="text" :placeholder="t('components.userPromptsPanel.namePlaceholder')" autocomplete="off" />
        </label>
        <label class="form-field content-field">
          <span>{{ t('components.userPromptsPanel.content') }}</span>
          <textarea v-model="content" rows="10" :placeholder="t('components.userPromptsPanel.contentPlaceholder')"></textarea>
        </label>
        <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
        <div class="form-actions">
          <button type="button" class="prompt-action-button" :disabled="saving" @click="showPreview">{{ t('components.userPromptsPanel.cancel') }}</button>
          <button type="submit" class="prompt-action-button save-button" :disabled="saving || !name.trim() || !content.trim()">
            <PhFloppyDisk :size="16" aria-hidden="true" />
            {{ t('components.userPromptsPanel.save') }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PhFloppyDisk, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import type { UserPrompt, UserPromptInput } from '../composables/useUserPrompts';

const t = i18n.global.t;
const props = defineProps<{ prompts: UserPrompt[] }>();
type SaveComplete = (error?: unknown) => void;

const emit = defineEmits<{
  createPrompt: [input: UserPromptInput, complete: SaveComplete];
  updatePrompt: [payload: { id: string; changes: UserPromptInput }, complete: SaveComplete];
  deletePrompt: [id: string];
}>();
const selectedId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const mode = ref<'preview' | 'create' | 'edit'>('preview');
const name = ref('');
const content = ref('');
const saving = ref(false);
const saveError = ref('');
const selectedPrompt = computed(() => props.prompts.find((prompt) => prompt.id === selectedId.value) ?? null);

watch(() => props.prompts, (prompts) => {
  if (!prompts.some((prompt) => prompt.id === selectedId.value)) selectedId.value = prompts[0]?.id ?? null;
}, { immediate: true });

function selectPrompt(prompt: UserPrompt): void {
  selectedId.value = prompt.id;
  showPreview();
}

function startCreating(): void {
  editingId.value = null;
  name.value = '';
  content.value = '';
  saveError.value = '';
  mode.value = 'create';
}

function startEditing(prompt: UserPrompt): void {
  selectedId.value = prompt.id;
  editingId.value = prompt.id;
  name.value = prompt.name;
  content.value = prompt.content;
  saveError.value = '';
  mode.value = 'edit';
}

function showPreview(): void {
  editingId.value = null;
  name.value = '';
  content.value = '';
  saveError.value = '';
  mode.value = 'preview';
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
  if (!changes.name || !changes.content || saving.value) return;

  saving.value = true;
  saveError.value = '';
  const complete: SaveComplete = (error) => {
    saving.value = false;
    if (error) {
      saveError.value = error instanceof Error ? error.message : t('components.userPromptsPanel.saveFailed');
      return;
    }
    showPreview();
  };

  if (editingId.value) emit('updatePrompt', { id: editingId.value, changes }, complete);
  else emit('createPrompt', changes, complete);
}
</script>

<style scoped>
.user-prompts-panel {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 1.5rem;
}

h4 {
  margin: 0;
  color: var(--text-primary);
}

.section-header p,
.form-header p {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.section-header p {
  margin-top: 0;
}

.prompt-workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(18rem, 0.85fr) minmax(26rem, 1.15fr);
  gap: 1rem;
}

.prompt-library,
.prompt-preview,
.user-prompt-form {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
}

.prompt-library {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.prompt-library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.prompt-library-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.prompt-count {
  display: inline-grid;
  place-items: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.75rem;
  letter-spacing: normal;
}

.add-prompt-button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 30px;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: normal;
  text-transform: none;
  cursor: pointer;
}

.add-prompt-button:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--border) 65%, var(--accent));
}

.add-prompt-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.user-prompts-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 0.5rem;
  overflow-y: auto;
  padding: 0.75rem;
}

.user-prompt-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.user-prompt-card:hover {
  border-color: var(--border);
  background: var(--bg-elevated);
}

.user-prompt-card.active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: var(--accent-muted);
}

.user-prompt-copy {
  min-width: 0;
}

.user-prompt-heading {
  display: grid;
  gap: 0.15rem;
}

.user-prompt-copy strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-prompt-heading time {
  color: var(--text-muted);
  font-size: 0.6875rem;
}

.user-prompt-copy p {
  display: -webkit-box;
  margin: 0.45rem 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.user-prompt-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.35rem;
  transition: opacity var(--duration-fast) var(--ease-out);
}

@media (hover: hover) {
  .user-prompt-actions {
    opacity: 0;
  }

  .user-prompt-card:hover .user-prompt-actions,
  .user-prompt-card:focus-within .user-prompt-actions,
  .user-prompt-card.active .user-prompt-actions {
    opacity: 1;
  }
}

.user-prompt-actions button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
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

.empty-prompts {
  align-self: center;
  padding: 2rem;
  color: var(--text-secondary);
  text-align: center;
}

.empty-prompts strong {
  color: var(--text-primary);
  font-size: 0.875rem;
}

.empty-prompts p {
  margin: 0.35rem auto 0;
  max-width: 17rem;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.prompt-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border-bottom: 1px solid var(--border);
}

.preview-header time {
  display: block;
  margin-top: 0.3rem;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.preview-content {
  overflow-y: auto;
  padding: 1.25rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.user-prompt-form {
  display: grid;
  grid-template-rows: auto auto minmax(10rem, 1fr) auto auto;
  gap: 1rem;
  padding: 1.25rem;
}

.form-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.25rem;
}

.form-field {
  display: grid;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
}

.content-field {
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
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
  resize: none;
  line-height: 1.55;
}

.save-error {
  margin: 0;
  color: var(--error-color, #ef4444);
  font-size: 0.8125rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 0.25rem;
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
  cursor: pointer;
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

@media (max-width: 1180px) {
  .user-prompts-panel {
    height: auto;
  }

  .prompt-workspace {
    grid-template-columns: 1fr;
  }

  .prompt-library {
    max-height: 24rem;
  }

  .user-prompt-form {
    min-height: 32rem;
  }
}

@media (max-width: 640px) {
  .section-header {
    display: none;
  }

  .user-prompts-panel {
    grid-template-rows: auto;
  }

  .prompt-library,
  .prompt-preview,
  .user-prompt-form {
    border-radius: var(--radius-md);
  }

  .user-prompt-actions {
    opacity: 1;
  }

  .user-prompt-form {
    min-height: 30rem;
    padding: 1rem;
  }

  .form-header {
    align-items: stretch;
    flex-direction: column;
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
