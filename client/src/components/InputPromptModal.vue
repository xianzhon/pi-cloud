<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="prompt-backdrop">
        <section class="prompt-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
          <header class="prompt-header">
            <div class="prompt-icon">
              <slot name="icon"><PhPencilSimple :size="20" weight="duotone" /></slot>
            </div>
            <div class="prompt-heading">
              <h2 :id="titleId">{{ title }}</h2>
              <p v-if="description">{{ description }}</p>
            </div>
            <DialogCloseButton :label="t('components.inputPromptModal.closeDialog')" @click="onCancel" />
          </header>

          <form class="prompt-form" @submit.prevent="onSubmit">
            <label class="prompt-label" :for="inputId">{{ label || t('components.inputPromptModal.value') }}</label>
            <input
              :id="inputId"
              ref="inputRef"
              v-model="value"
              class="prompt-input"
              :placeholder="placeholder"
              autocomplete="off"
              @keydown.esc.prevent="onCancel"
            />

            <footer class="prompt-actions">
              <button type="button" class="prompt-btn prompt-btn-secondary" @click="onCancel">{{ cancelText || t('components.inputPromptModal.cancel') }}</button>
              <button type="submit" class="prompt-btn prompt-btn-primary">{{ confirmText || t('components.inputPromptModal.continue') }}</button>
            </footer>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { nextTick, ref, watch } from 'vue';
import { PhPencilSimple } from '@phosphor-icons/vue';
import DialogCloseButton from './DialogCloseButton.vue';

const t = i18n.global.t;

const props = withDefaults(defineProps<{
  visible: boolean;
  title: string;
  label?: string;
  description?: string;
  placeholder?: string;
  modelValue?: string;
  confirmText?: string;
  cancelText?: string;
}>(), {
  label: undefined,
  description: '',
  placeholder: '',
  modelValue: '',
  confirmText: undefined,
  cancelText: undefined,
});

const emit = defineEmits<{
  confirm: [value: string];
  cancel: [];
}>();

const value = ref(props.modelValue);
const inputRef = ref<HTMLInputElement>();
const titleId = `prompt-title-${Math.random().toString(36).slice(2)}`;
const inputId = `prompt-input-${Math.random().toString(36).slice(2)}`;

watch(() => props.visible, async (visible) => {
  if (!visible) return;
  value.value = props.modelValue;
  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.select();
});

watch(() => props.modelValue, (next) => {
  if (!props.visible) value.value = next;
});

function onSubmit(): void {
  emit('confirm', value.value);
}

function onCancel(): void {
  emit('cancel');
}
</script>

<style scoped>
.prompt-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(6px);
}

.prompt-dialog {
  width: min(480px, calc(100vw - 2rem));
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 22%), var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.prompt-header {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 0.875rem;
  padding: 1.25rem 1.25rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.prompt-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  color: var(--accent);
  background: var(--accent-muted);
  border: 1px solid rgba(108, 140, 255, 0.22);
  border-radius: var(--radius-lg);
}

.prompt-heading {
  flex: 1;
  min-width: 0;
}

.prompt-heading h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.05rem;
}

.prompt-heading p {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.45;
}

.prompt-form {
  min-height: 0;
  padding: 1.25rem;
  overflow-y: auto;
}

.prompt-label {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
}

.prompt-input {
  width: 100%;
  padding: 0.8rem 0.9rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.prompt-btn {
  min-width: 112px;
  padding: 0.72rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.92rem;
  font-weight: 600;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.prompt-btn:focus-visible,
.prompt-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.prompt-btn-secondary {
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
}

.prompt-btn-secondary:hover {
  background: var(--bg-elevated);
}

.prompt-btn-primary {
  color: white;
  background: var(--accent);
  border: 1px solid transparent;
}

.prompt-btn-primary:hover {
  background: var(--accent-hover);
}

.modal-enter-active {
  transition: opacity 200ms var(--ease-out),
              transform 200ms var(--ease-out);
}

.modal-leave-active {
  transition: opacity 150ms var(--ease-out),
              transform 150ms var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .prompt-dialog {
  transform: scale(0.96) translateY(12px);
}

.modal-leave-to .prompt-dialog {
  transform: scale(0.98);
}

@media (max-width: 520px) {
  .prompt-actions {
    flex-direction: column-reverse;
  }

  .prompt-btn {
    width: 100%;
  }
}
</style>
