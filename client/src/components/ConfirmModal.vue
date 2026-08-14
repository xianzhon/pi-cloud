<!-- client/src/components/ConfirmModal.vue -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-backdrop" @click.self="onBackdropClick">
        <section
          class="confirm-modal"
          :class="{ 'confirm-modal--no-icon': hideIcon }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          @keydown="handleKeydown"
        >
          <header class="modal-header">
            <div v-if="!hideIcon" class="modal-icon" :class="variant">
              <slot name="icon"><PhWarning :size="22" weight="duotone" /></slot>
            </div>
            <div class="modal-heading">
              <h2 :id="titleId" class="modal-title">
                <slot name="title">{{ t('components.confirmModal.confirmAction') }}</slot>
              </h2>
              <div class="modal-message">
                <slot name="message">{{ t('components.confirmModal.areYouSure') }}</slot>
              </div>
            </div>
            <DialogCloseButton class="modal-close" :label="t('components.confirmModal.closeDialog')" @click="onCancel" />
          </header>
          
          <footer class="modal-actions">
            <button class="btn dialog-action btn-cancel" @click="onCancel">
              {{ cancelText || t('components.confirmModal.cancel') }}
            </button>
            <button 
              class="btn dialog-action btn-confirm"
              :class="variant"
              @click="onConfirm"
              ref="confirmBtn"
            >
              {{ confirmText || t('components.confirmModal.confirm') }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { ref, watch, nextTick } from 'vue';
import { PhWarning } from '@phosphor-icons/vue';
import DialogCloseButton from './DialogCloseButton.vue';

const t = i18n.global.t;

const props = withDefaults(defineProps<{
  visible: boolean;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  initialFocus?: 'confirm' | 'none';
  closeOnBackdrop?: boolean;
  hideIcon?: boolean;
}>(), {
  confirmText: undefined,
  cancelText: undefined,
  variant: 'primary',
  initialFocus: 'confirm',
  closeOnBackdrop: false,
  hideIcon: false,
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const confirmBtn = ref<HTMLButtonElement>();
const titleId = `confirm-title-${Math.random().toString(36).slice(2)}`;

watch(() => props.visible, async (visible) => {
  if (visible && props.initialFocus === 'confirm') {
    await nextTick();
    confirmBtn.value?.focus();
  }
});

function onConfirm(): void {
  emit('confirm');
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;

  event.preventDefault();
  onConfirm();
}

function onCancel(): void {
  emit('cancel');
}

function onBackdropClick(): void {
  if (props.closeOnBackdrop) onCancel();
}
</script>

<style scoped>
.modal-backdrop {
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

.confirm-modal {
  width: min(540px, calc(100vw - 2rem));
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
  min-height: 0;
  padding: 1.5rem 1.5rem 1.25rem;
  overflow-y: auto;
}

/* Without the icon, let the form use the full dialog width and align the close control with the title. */
.confirm-modal--no-icon .modal-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.5rem 0.875rem;
}

.confirm-modal--no-icon .modal-heading {
  display: contents;
}

.confirm-modal--no-icon .modal-title {
  grid-column: 1;
  grid-row: 1;
}

.confirm-modal--no-icon .modal-message {
  grid-column: 1 / -1;
  grid-row: 2;
}

.confirm-modal--no-icon .modal-close {
  grid-column: 2;
  grid-row: 1;
}


.modal-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  flex: 0 0 auto;
  color: var(--accent);
  background: var(--accent-muted);
  border: 1px solid rgba(108, 140, 255, 0.22);
  border-radius: var(--radius-lg);
}

.modal-icon.warning {
  color: var(--warning);
  background: var(--warning-muted);
  border-color: rgba(251, 191, 36, 0.22);
}

.modal-icon.danger {
  color: var(--error);
  background: var(--error-muted);
  border-color: rgba(248, 113, 113, 0.22);
}

.modal-icon :deep(.ph) {
  color: inherit;
}

.modal-heading {
  flex: 1;
  min-width: 0;
}

.modal-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
  color: var(--text-primary);
}

.modal-message {
  margin-top: 0.45rem;
  color: var(--text-secondary);
  font-size: 0.925rem;
  line-height: 1.55;
}

.modal-actions {
  display: flex;
  flex: none;
  gap: 0.75rem;
  justify-content: flex-end;
  padding: 1.125rem 1.5rem 1.5rem;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
}


.btn {
  min-width: 96px;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.btn:active {
  transform: scale(0.98);
}

.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn-cancel {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.btn-cancel:hover {
  background: var(--bg-elevated);
}

.btn-confirm {
  color: white;
  border: 1px solid transparent;
}

.btn-confirm.primary {
  background: var(--accent);
}

.btn-confirm.primary:hover {
  background: var(--accent-hover);
}

.btn-confirm.warning {
  background: var(--warning);
  color: var(--bg-primary);
}

.btn-confirm.danger {
  background: var(--error);
}

/* Transition */
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

.modal-enter-from .confirm-modal {
  transform: scale(0.96) translateY(12px);
}

.modal-leave-to .confirm-modal {
  transform: scale(0.98);
}

@media (max-width: 520px) {
  .modal-actions {
    flex-direction: column-reverse;
  }

  .btn {
    width: 100%;
  }
}
</style>
