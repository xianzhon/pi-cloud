<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="app-toast"
        :class="toast.type"
        :role="toast.type === 'error' ? 'alert' : 'status'"
      >
        <span class="toast-icon" aria-hidden="true">
          <PhCheckCircle v-if="toast.type === 'success'" :size="17" weight="fill" />
          <PhWarningCircle v-else-if="toast.type === 'error'" :size="17" weight="fill" />
          <PhInfo v-else :size="17" weight="fill" />
        </span>
        <span class="toast-message">{{ toast.message }}</span>
        <button type="button" :aria-label="t('components.toastHost.dismiss')" @click="dismissToast(toast.id)">
          <PhX :size="13" weight="bold" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { PhCheckCircle, PhInfo, PhWarningCircle, PhX } from '@phosphor-icons/vue';
import { useToasts } from '../composables/useToasts';
import { i18n } from '../i18n';

const t = i18n.global.t;
const { toasts, dismissToast } = useToasts();
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(16px + var(--safe-top));
  right: max(16px, var(--safe-right));
  z-index: 3000;
  display: flex;
  width: min(360px, calc(100vw - 32px - var(--safe-left) - var(--safe-right)));
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}

@media (min-width: 769px) {
  .toast-host {
    top: 16px;
    right: auto;
    left: 50%;
    align-items: center;
    transform: translateX(-50%);
  }
}

.app-toast {
  --toast-color: var(--accent);
  --toast-tint: var(--accent-muted);

  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  gap: 9px;
  min-height: 42px;
  padding: 7px 8px 7px 10px;
  border: 1px solid color-mix(in srgb, var(--toast-color) 24%, var(--border));
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
  pointer-events: auto;
}

.app-toast.success {
  --toast-color: var(--success);
  --toast-tint: var(--success-muted);
}

.app-toast.error {
  --toast-color: var(--error);
  --toast-tint: var(--error-muted);
}

.toast-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--toast-color);
  background: var(--toast-tint);
}

.toast-message {
  flex: 1;
  font-size: 0.8125rem;
  font-weight: 550;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.app-toast button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  color: var(--text-tertiary);
  background: transparent;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.app-toast button:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.app-toast button:focus-visible {
  outline: 2px solid var(--toast-color);
  outline-offset: 1px;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
