<template>
  <div ref="root" class="custom-select">
    <div v-if="searchable" class="custom-select-search-wrapper">
      <input
        :id="id"
        ref="inputRef"
        :value="open ? query : selectedLabel"
        class="custom-select-trigger custom-select-input"
        :class="{ placeholder: !selectedOption && !open }"
        :aria-label="ariaLabel"
        :aria-expanded="open"
        aria-haspopup="listbox"
        :disabled="disabled"
        :placeholder="open ? searchPlaceholderLabel : placeholderLabel"
        @focus="openList"
        @click="openList"
        @input="handleSearchInput"
        @keydown="handleInputKeydown"
      />
      <span class="custom-select-chevron custom-select-search-chevron" aria-hidden="true">⌄</span>
    </div>
    <button
      v-else
      :id="id"
      ref="buttonRef"
      type="button"
      class="custom-select-trigger"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :disabled="disabled"
      @click="toggle"
      @keydown="handleTriggerKeydown"
    >
      <span class="custom-select-value" :class="{ placeholder: !selectedOption }">
        <span class="custom-select-option-content">
          <span>{{ selectedLabel }}</span>
          <small v-if="selectedOption?.description">{{ selectedOption.description }}</small>
        </span>
        <span
          v-if="selectedOption?.status"
          class="custom-select-status"
          :class="`custom-select-status-${selectedOption.statusTone || 'muted'}`"
        >
          {{ selectedOption.status }}
        </span>
      </span>
      <span class="custom-select-chevron" aria-hidden="true">⌄</span>
    </button>

    <div
      v-if="open"
      ref="listRef"
      class="custom-select-list bounded"
      :class="{ 'open-up': dropdownPlacement === 'top' }"
      :style="{ maxHeight: listMaxHeight }"
      role="listbox"
      :aria-labelledby="id"
    >
      <template v-for="(option, index) in filteredOptions" :key="option.value || `empty-${index}`">
        <div
          v-if="option.group && option.group !== filteredOptions[index - 1]?.group"
          class="custom-select-group"
        >
          {{ option.group }}
        </div>
        <button
          type="button"
          class="custom-select-option"
          :class="{ active: option.value === modelValue, highlighted: index === highlightedIndex }"
          role="option"
          :aria-selected="option.value === modelValue"
          @click="selectOption(option.value)"
          @mouseenter="highlightedIndex = index"
        >
          <span class="custom-select-option-content">
            <span>{{ option.label }}</span>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
          <span
            v-if="option.status"
            class="custom-select-status"
            :class="`custom-select-status-${option.statusTone || 'muted'}`"
          >
            {{ option.status }}
          </span>
        </button>
      </template>
      <div v-if="filteredOptions.length === 0" class="custom-select-empty">{{ t('components.customSelect.noMatchingOptions') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const t = i18n.global.t;

export type CustomSelectOption = {
  value: string;
  label: string;
  description?: string;
  status?: string;
  statusTone?: 'success' | 'muted';
  group?: string;
};

const props = withDefaults(defineProps<{
  modelValue: string;
  options: CustomSelectOption[];
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}>(), {
  id: undefined,
  ariaLabel: undefined,
  placeholder: undefined,
  disabled: false,
  searchable: false,
  searchPlaceholder: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const root = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const open = ref(false);
const highlightedIndex = ref(-1);
const dropdownPlacement = ref<'top' | 'bottom'>('bottom');
const listMaxHeight = ref('12rem');
const query = ref('');

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const placeholderLabel = computed(() => props.placeholder || t('components.customSelect.selectAnOption'));
const searchPlaceholderLabel = computed(() => props.searchPlaceholder || t('components.customSelect.searchOptions'));
const selectedLabel = computed(() => selectedOption.value?.label || placeholderLabel.value);
const filteredOptions = computed(() => {
  const search = query.value.trim().toLowerCase();
  if (!props.searchable || !search) return props.options;
  return props.options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(search));
});

function openList(): void {
  if (props.disabled || open.value) return;
  open.value = true;
  highlightedIndex.value = highlightedIndexForCurrentValue();
  nextTick(updateListPosition);
}

function closeList(): void {
  open.value = false;
  query.value = '';
  highlightedIndex.value = -1;
}

function toggle(): void {
  if (open.value) closeList();
  else openList();
}

function selectOption(value: string): void {
  emit('update:modelValue', value);
  closeList();
  // Keep keyboard focus on the trigger for regular selects. Search inputs reopen
  // on focus, so focusing one after closing would immediately reopen the list.
  if (!props.searchable) buttonRef.value?.focus();
}

function highlightedIndexForCurrentValue(): number {
  const selectedIndex = filteredOptions.value.findIndex((option) => option.value === props.modelValue);
  return selectedIndex >= 0 ? selectedIndex : (filteredOptions.value.length ? 0 : -1);
}

function moveHighlight(delta: number): void {
  if (!open.value) openList();
  if (!filteredOptions.value.length) return;
  const nextIndex = highlightedIndex.value < 0 ? 0 : highlightedIndex.value + delta;
  highlightedIndex.value = clampIndex(nextIndex, filteredOptions.value.length);
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length - 1);
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveHighlight(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveHighlight(-1);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (open.value && highlightedIndex.value >= 0) {
      selectOption(filteredOptions.value[highlightedIndex.value].value);
    } else {
      openList();
    }
    return;
  }
  if (event.key === 'Escape') {
    closeList();
  }
}

function handleInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveHighlight(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveHighlight(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (open.value && highlightedIndex.value >= 0) selectOption(filteredOptions.value[highlightedIndex.value].value);
    return;
  }
  if (event.key === 'Escape') {
    closeList();
  }
}

function handleSearchInput(event: Event): void {
  if (!open.value) openList();
  query.value = (event.target as HTMLInputElement).value;
  highlightedIndex.value = filteredOptions.value.length ? 0 : -1;
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) closeList();
}

function updateListPosition(): void {
  const rect = (props.searchable ? inputRef.value : buttonRef.value)?.getBoundingClientRect();
  if (!rect) return;

  const gap = 8;
  const minUsefulHeight = 160;
  const availableBelow = window.innerHeight - rect.bottom - gap;
  const availableAbove = rect.top - gap;
  const openUp = availableBelow < minUsefulHeight && availableAbove > availableBelow;
  const available = Math.max(openUp ? availableAbove : availableBelow, 120);

  dropdownPlacement.value = openUp ? 'top' : 'bottom';
  listMaxHeight.value = `${Math.min(360, available)}px`;
}

function handleWindowResize(): void {
  if (open.value) updateListPosition();
}

async function scrollHighlightedOptionIntoView(): Promise<void> {
  await nextTick();
  listRef.value?.querySelector<HTMLElement>('.custom-select-option.highlighted')?.scrollIntoView?.({ block: 'nearest' });
}

watch(highlightedIndex, scrollHighlightedOptionIntoView);
watch(filteredOptions, () => {
  const optionCount = filteredOptions.value.length;
  if (!optionCount) {
    highlightedIndex.value = -1;
    return;
  }
  highlightedIndex.value = clampIndex(highlightedIndex.value, optionCount);
});

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  window.addEventListener('resize', handleWindowResize);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  window.removeEventListener('resize', handleWindowResize);
});
</script>

<style scoped>
.custom-select {
  position: relative;
  width: 100%;
}

.custom-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
  padding: 0.65rem 0.8rem;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.custom-select-trigger:hover,
.custom-select-trigger[aria-expanded="true"] {
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}

.custom-select-search-wrapper {
  position: relative;
}

.custom-select-input {
  padding-right: 2rem;
}

.custom-select-input.placeholder {
  color: var(--text-secondary);
}

.custom-select-search-chevron {
  position: absolute;
  top: 50%;
  right: 0.8rem;
  transform: translateY(-50%);
  pointer-events: none;
}

.custom-select-trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.custom-select-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.custom-select-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.custom-select-value.placeholder,
.custom-select-chevron {
  color: var(--text-secondary);
}

.custom-select-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--bg-surface);
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow-x: hidden;
}

.custom-select-list.open-up {
  top: auto;
  bottom: calc(100% + 4px);
}

.custom-select-list.bounded {
  max-height: 12rem;
  overflow-y: auto;
}

.custom-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.7rem;
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.custom-select-option-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.custom-select-option-content > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select-option-content small {
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 400;
}

.custom-select-group {
  padding: 0.6rem 0.7rem 0.25rem;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.custom-select-group:not(:first-child) {
  border-top: 1px solid var(--border);
  margin-top: 0.25rem;
}

.custom-select-status {
  flex: none;
  max-width: 45%;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select-status-success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, var(--bg-surface));
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
}

.custom-select-status-muted {
  color: var(--text-secondary);
  background: var(--bg-elevated);
}

.custom-select-option:hover,
.custom-select-option.highlighted {
  background: var(--accent-muted);
  color: var(--text-primary);
}

.custom-select-option.active {
  color: var(--accent);
  font-weight: 600;
}

.custom-select-empty {
  padding: 0.55rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}
</style>
