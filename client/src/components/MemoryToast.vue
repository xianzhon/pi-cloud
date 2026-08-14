<template>
  <Transition name="memory-toast">
    <aside
      v-if="toast"
      ref="toastRef"
      class="memory-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      @focusin="pauseDismiss"
      @focusout="resumeDismiss"
    >
      <header class="memory-toast-header">
        <span class="memory-toast-title">
          <span class="memory-toast-icon" aria-hidden="true">
            <PhBrain :size="16" weight="fill" />
          </span>
          {{ t('components.memoryToast.memoryUpdated') }}
        </span>
        <button
          class="memory-toast-close"
          type="button"
          :aria-label="t('components.memoryToast.dismissMemoryNotification')"
          @click="dismiss"
        >
          <PhX :size="15" weight="bold" />
        </button>
      </header>

      <div class="memory-toast-counts">
        <p><strong>{{ toast.activeProjectCount }}</strong> {{ projectCountLabel }}</p>
        <p><strong>{{ toast.pendingGlobalCount }}</strong> {{ globalCountLabel }}</p>
      </div>

      <div class="memory-toast-actions">
        <button
          v-if="toast.pendingGlobalCount > 0"
          class="memory-toast-action memory-toast-review"
          type="button"
          @click="emit('review', toast.extractionRunId)"
        >
          <PhListChecks :size="15" weight="bold" />
          {{ t('components.memoryToast.review') }}
        </button>
        <button class="memory-toast-action memory-toast-undo" type="button" @click="emit('undo', toast.extractionRunId)">
          <PhArrowCounterClockwise :size="15" weight="bold" />
          {{ t('components.memoryToast.undo') }}
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { PhArrowCounterClockwise, PhBrain, PhListChecks, PhX } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import type { MemoryToastState } from '../types/memory';

const t = i18n.global.t;


const props = defineProps<{ toast: MemoryToastState | null }>();
const emit = defineEmits<{
  review: [runId: string];
  undo: [runId: string];
  dismiss: [];
}>();

const toastRef = ref<HTMLElement | null>(null);
const focusWithin = ref(false);
let dismissTimer: number | undefined;

const projectCountLabel = computed(() => t(
  props.toast?.activeProjectCount === 1 ? 'components.memoryToast.projectMemorySaved' : 'components.memoryToast.projectMemoriesSaved',
));
const globalCountLabel = computed(() => t(
  props.toast?.pendingGlobalCount === 1 ? 'components.memoryToast.globalMemoryNeedsReview' : 'components.memoryToast.globalMemoriesNeedReview',
));

function clearDismissTimer(): void {
  if (dismissTimer === undefined) return;
  window.clearTimeout(dismissTimer);
  dismissTimer = undefined;
}

function scheduleDismiss(): void {
  clearDismissTimer();
  if (!props.toast || focusWithin.value) return;
  dismissTimer = window.setTimeout(() => {
    dismissTimer = undefined;
    if (!props.toast) return;
    if (focusWithin.value || toastRef.value?.contains(document.activeElement)) {
      focusWithin.value = true;
      return;
    }
    emit('dismiss');
  }, 8_000);
}

function pauseDismiss(): void {
  focusWithin.value = true;
  clearDismissTimer();
}

function resumeDismiss(event: FocusEvent): void {
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && toastRef.value?.contains(nextTarget)) return;
  focusWithin.value = false;
  scheduleDismiss();
}

function dismiss(): void {
  clearDismissTimer();
  emit('dismiss');
}

watch(() => props.toast?.extractionRunId, () => {
  scheduleDismiss();
}, { immediate: true });

onUnmounted(clearDismissTimer);
</script>

<style scoped>
.memory-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 4200;
  width: min(380px, calc(100vw - 32px));
  padding: 14px;
  color: var(--text-primary);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 42%),
    var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
}

.memory-toast-header,
.memory-toast-title,
.memory-toast-actions,
.memory-toast-action {
  display: flex;
  align-items: center;
}

.memory-toast-header {
  justify-content: space-between;
  gap: 12px;
}

.memory-toast-title {
  gap: 8px;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.memory-toast-icon {
  display: inline-flex;
  padding: 5px;
  color: var(--accent);
  background: var(--accent-muted);
  border-radius: 7px;
}

.memory-toast-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-tertiary);
  border-radius: 7px;
}

.memory-toast-close:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.memory-toast-counts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 12px 0;
}

.memory-toast-counts p {
  margin: 0;
  padding: 9px 10px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.75rem;
  line-height: 1.35;
}

.memory-toast-counts strong {
  display: block;
  margin-bottom: 2px;
  color: var(--text-primary);
  font-size: 1rem;
}

.memory-toast-actions {
  justify-content: flex-end;
  gap: 7px;
}

.memory-toast-action {
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 650;
}

.memory-toast-action:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.memory-toast-review {
  color: var(--accent);
  background: var(--accent-muted);
  border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
}

.memory-toast button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.memory-toast-enter-active,
.memory-toast-leave-active {
  transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
}

.memory-toast-enter-from,
.memory-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 520px) {
  .memory-toast {
    right: 16px;
    bottom: 16px;
  }

  .memory-toast-counts {
    grid-template-columns: 1fr;
  }
}
</style>
