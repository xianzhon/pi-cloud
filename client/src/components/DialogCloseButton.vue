<template>
  <button type="button" class="dialog-close-button" :aria-label="label">
    <PhX :size="18" weight="bold" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue';

defineProps<{
  label: string;
}>();
</script>

<style scoped>
.dialog-close-button {
  display: inline-grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 2.25rem;
  place-items: center;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  line-height: 1;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.dialog-close-button:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
  border-color: var(--border);
}

.dialog-close-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.dialog-close-button:active {
  transform: scale(0.92);
}

@media (hover: none), (pointer: coarse) {
  .dialog-close-button {
    width: 2.5rem;
    height: 2.5rem;
    flex-basis: 2.5rem;
  }
}
</style>
