<template>
  <div ref="menuRef" class="slash-command-menu" role="listbox" :aria-label="t('components.slashCommandMenu.slashCommands')">
    <button
      v-for="(command, index) in commands"
      :key="command.id"
      type="button"
      class="slash-command-item"
      :class="{ active: index === activeIndex }"
      role="option"
      :aria-selected="index === activeIndex"
      @mousedown.prevent
      @click="$emit('select', command)"
    >
      <span class="command-main">
        <span class="command-line">
          <span class="command-label">{{ command.label }}</span>
          <span class="command-category">{{ command.category }}</span>
        </span>
        <span class="command-description">{{ command.description }}</span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { nextTick, ref, watch } from 'vue';
import type { SlashCommandItem } from '../types/slashCommands';

const t = i18n.global.t;

const props = defineProps<{
  commands: SlashCommandItem[];
  activeIndex: number;
}>();

defineEmits<{
  select: [command: SlashCommandItem];
}>();

const menuRef = ref<HTMLElement | null>(null);

async function scrollActiveItemIntoView() {
  await nextTick();
  const activeItem = menuRef.value?.querySelector<HTMLElement>('.slash-command-item.active');
  activeItem?.scrollIntoView({ block: 'nearest' });
}

watch(() => props.activeIndex, () => {
  scrollActiveItemIntoView();
});

watch(() => props.commands, (commands) => {
  if (commands.length > 0) {
    scrollActiveItemIntoView();
  }
}, { deep: true, immediate: true });
</script>

<style scoped>
.slash-command-menu {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: calc(100% - 0.75rem);
  z-index: 20;
  max-height: 280px;
  overflow-y: auto;
  padding: 0.375rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
}

.slash-command-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  color: var(--text-primary);
  background: transparent;
  border: 0;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
}

.slash-command-item:hover,
.slash-command-item.active {
  background: var(--bg-surface);
}

.command-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.command-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.command-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 700;
  color: var(--accent);
}

.command-description {
  color: var(--text-secondary);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-category {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0.2rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.7rem;
  text-transform: uppercase;
}
</style>
