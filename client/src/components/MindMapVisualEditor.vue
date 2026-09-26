<template>
  <div class="mindmap-editor" :class="[structure, { dragging: draggedId !== null }]" :style="palette" @keydown="onKeydown">
    <div class="mindmap-toolbar">
      <button type="button" class="mindmap-history-button" :disabled="!past.length" :aria-label="t('undo')" :title="t('undo')" @click="undo"><PhArrowCounterClockwise aria-hidden="true" /></button>
      <button type="button" class="mindmap-history-button" :disabled="!future.length" :aria-label="t('redo')" :title="t('redo')" @click="redo"><PhArrowClockwise aria-hidden="true" /></button>
      <div class="mindmap-levels mindmap-level-depth"><span>{{ t('levels') }}</span>
        <CustomSelect model-value="" :options="levelOptions" :aria-label="t('levels')" :placeholder="t('chooseLevel')" @update:model-value="setLevel(Number($event))" />
      </div>
      <div class="mindmap-levels"><span>{{ t('layout') }}</span>
        <CustomSelect :model-value="direction" :options="layoutOptions" :aria-label="t('layout')" @update:model-value="setDirection" />
      </div>
      <div class="mindmap-levels"><span>{{ t('theme') }}</span>
        <CustomSelect :model-value="theme" :options="themeOptions" :aria-label="t('theme')" @update:model-value="setTheme" />
      </div>
      <div class="mindmap-levels"><span>{{ t('structure') }}</span>
        <CustomSelect :model-value="structure" :options="structureOptions" :aria-label="t('structure')" @update:model-value="setStructure" />
      </div>
      <div ref="iconPicker" class="mindmap-levels mindmap-icon-picker"><span>{{ t('icon') }}</span>
        <button ref="iconTrigger" type="button" class="mindmap-icon-trigger" :aria-label="t('icon')" :aria-expanded="iconPickerOpen" aria-haspopup="dialog" :disabled="!selected || !!editing" @click="toggleIconPicker" @keydown.esc.stop="closeIconPicker">
          <span v-if="selected?.icon && mindMapFlagColors[selected.icon]" class="mindmap-colored-flag" :style="{ color: mindMapFlagColors[selected.icon] }">⚑</span><span v-else>{{ selected?.icon || t('noIcon') }}</span><span aria-hidden="true">⌄</span>
        </button>
        <div v-if="iconPickerOpen" ref="iconPanel" class="mindmap-icon-panel" role="dialog" :aria-label="t('icon')" :style="iconPanelStyle" @keydown.esc.stop="closeIconPicker">
          <button type="button" class="mindmap-icon-clear" :class="{ active: !selected?.icon }" :aria-pressed="!selected?.icon" @click="chooseIcon('')">{{ t('noIcon') }}</button>
          <div class="mindmap-icon-grid">
            <button v-for="icon in mindMapIcons" :key="icon" type="button" :aria-label="icon" :aria-pressed="selected?.icon === icon" :class="{ active: selected?.icon === icon }" @click="chooseIcon(icon)"><span v-if="mindMapFlagColors[icon]" class="mindmap-colored-flag" :style="{ color: mindMapFlagColors[icon] }">⚑</span><template v-else>{{ icon }}</template></button>
          </div>
        </div>
      </div>
      <span class="mindmap-toolbar-spacer" />
      <div class="mindmap-view-controls">
        <button type="button" @click="zoom(-0.1)" :aria-label="t('zoomOut')">−</button>
        <span>{{ Math.round(scale * 100) }}%</span>
        <button type="button" @click="zoom(0.1)" :aria-label="t('zoomIn')">+</button>
        <button type="button" @click="fit">{{ t('fit') }}</button>
      </div>
    </div>
    <div class="mindmap-shortcuts">{{ t('shortcuts') }}</div>
    <div ref="viewport" class="mindmap-viewport" tabindex="0" @pointerdown="startPan" @pointermove="pan" @pointerup="endPan" @pointercancel="endPan" @wheel.prevent="onWheel">
      <div class="mindmap-canvas" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px`, transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }">
        <svg class="mindmap-connections" :width="canvasWidth" :height="canvasHeight" aria-hidden="true">
          <path v-for="(path, index) in diagram.connectors" :key="index" :d="path" :style="branchStyle(diagram.nodes[index + 1]?.id)" :transform="`translate(${originX} ${originY})`" />
        </svg>
        <div v-for="entry in positionedNodes" :key="entry.node.id" class="mindmap-item" :style="{ left: `${entry.position.x + originX}px`, top: `${entry.position.y + originY}px`, ...branchStyle(entry.node.id) }">
          <div :ref="el => observeNode(el, entry.node.id)" class="mindmap-node" role="button" tabindex="0" :aria-label="entry.node.label" :aria-pressed="selectedId === entry.node.id" :class="{ selected: selectedId === entry.node.id, root: !entry.position.depth, branch: entry.position.depth === 1, 'drop-child': dropTarget?.id === entry.node.id && dropTarget.placement === 'child', 'drop-before': dropTarget?.id === entry.node.id && dropTarget.placement === 'before', 'drop-after': dropTarget?.id === entry.node.id && dropTarget.placement === 'after' }" :draggable="!editing && entry.node.id !== root.id" @click="selectNode(entry.node.id)" @dblclick="startEdit('rename', entry.node.id)" @contextmenu.prevent="openMenu($event, entry.node.id)" @dragstart="draggedId = entry.node.id" @dragend="clearDrag" @dragover.prevent="showDrop(entry.node.id, 'child')" @drop.prevent="drop(entry.node.id, 'child')">
            <div v-if="entry.node.id !== root.id" class="mindmap-drop-edge" @dragover.stop.prevent="showDrop(entry.node.id, 'before')" @drop.stop.prevent="drop(entry.node.id, 'before')" />
            <form v-if="editing && editNodeId === entry.node.id" class="mindmap-inline-edit" @submit.stop.prevent="submitEdit" @click.stop @dblclick.stop>
              <input id="mindmap-label" v-model="draft" :aria-label="t('label')" :aria-invalid="labelError" @keydown.esc.stop.prevent="cancelEdit" @blur="submitEdit" />
              <span v-if="labelError" role="alert">{{ t('invalidLabel') }}</span>
            </form>
            <span v-else><span v-if="entry.node.icon" class="mindmap-icon"><span v-if="mindMapFlagColors[entry.node.icon]" class="mindmap-colored-flag" :style="{ color: mindMapFlagColors[entry.node.icon] }">⚑</span><template v-else>{{ entry.node.icon }}</template></span>{{ entry.node.label }}</span>
            <div v-if="entry.node.id !== root.id" class="mindmap-drop-edge" @dragover.stop.prevent="showDrop(entry.node.id, 'after')" @drop.stop.prevent="drop(entry.node.id, 'after')" />
          </div>
          <button v-if="entry.node.children.length" type="button" class="mindmap-fold" :class="{ left: entry.position.side < 0 }" :aria-label="folded.has(entry.node.id) ? t('expand') : t('collapse')" @click="toggleFold(entry.node.id)">{{ folded.has(entry.node.id) ? '+' : '−' }}</button>
        </div>
      </div>
    </div>
    <div v-if="menu" class="mindmap-context-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" role="menu" @contextmenu.prevent>
      <button type="button" role="menuitem" @click="menuEdit('rename')"><PhPencilSimple aria-hidden="true" />{{ t('rename') }}</button>
      <button type="button" role="menuitem" @click="menuEdit('child')"><PhTreeStructure aria-hidden="true" />{{ t('child') }}</button>
      <button v-if="menu.id !== root.id" type="button" role="menuitem" @click="menuEdit('sibling')"><PhRowsPlusBottom aria-hidden="true" />{{ t('sibling') }}</button>
      <button v-if="menu.id !== root.id" type="button" role="menuitem" @click="menuDelete"><PhTrash aria-hidden="true" />{{ t('delete') }}</button>
    </div>
    <div v-if="selected && selected.id !== root.id" class="mindmap-mobile-controls">
      <label>{{ t('parent') }}
        <select :value="''" @change="changeParent">
          <option value="" disabled>{{ t('chooseParent') }}</option>
          <option v-for="node in parentOptions" :key="node.id" :value="node.id">{{ node.label }}</option>
        </select>
      </label>
      <button type="button" @click="move('up')">{{ t('up') }}</button>
      <button type="button" @click="move('down')">{{ t('down') }}</button>
      <button type="button" @click="move('promote')">{{ t('promote') }}</button>
    </div>
    <ConfirmModal :visible="confirmDelete" variant="danger" :confirm-text="t('delete')" :cancel-text="t('cancel')" @confirm="deleteSelected" @cancel="confirmDelete = false">
      <template #title>{{ t('delete') }}</template>
      <template #message>{{ t('deleteBranch') }}</template>
    </ConfirmModal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { PhArrowClockwise, PhArrowCounterClockwise, PhPencilSimple, PhRowsPlusBottom, PhTrash, PhTreeStructure } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import ConfirmModal from './ConfirmModal.vue';
import CustomSelect from './CustomSelect.vue';
import { editMindMap, mindMapFlagColors, mindMapIcons, parseMindMap, serializeMindMap, validMindMapLabel, type MindMapNode } from '../utils/mindMap';
import { layoutMindMap, type NodeSize } from '../utils/mindMapLayout';
import { usePreferences, type MindMapLayout, type MindMapStructure, type MindMapTheme } from '../composables/usePreferences';

const props = defineProps<{ source: string }>();
const emit = defineEmits<{ change: [source: string]; save: [] }>();
const t = (key: string, params?: Record<string, number>) => i18n.global.t(`components.editorPanel.mindMap.${key}`, params || {});
const root = ref<MindMapNode>(parseMindMap(props.source));
const past = ref<MindMapNode[]>([]);
const future = ref<MindMapNode[]>([]);
const selectedId = ref<number | null>(root.value.id);
const folded = ref(new Set<number>());
const draggedId = ref<number | null>(null);
const dropTarget = ref<{ id: number; placement: 'child' | 'before' | 'after' } | null>(null);
const editing = ref<'child' | 'sibling' | 'before' | 'rename' | null>(null);
const draft = ref('');
const labelError = ref(false);
const confirmDelete = ref(false);
const menu = ref<{ id: number; x: number; y: number } | null>(null);
const {
  mindMapLayout: direction,
  mindMapTheme: theme,
  mindMapStructure: structure,
  setMindMapLayout,
  setMindMapTheme,
  setMindMapStructure,
} = usePreferences();
const levelOptions = computed(() => [
  ...[1, 2, 3].map(level => ({ value: String(level), label: t('level', { level }) })),
  { value: '0', label: t('expandAll') },
]);
const layoutOptions = computed(() => [
  { value: 'both', label: t('bothSides') },
  { value: 'right', label: t('rightSide') },
]);
const themeOptions = computed(() => [
  { value: 'ocean', label: t('ocean') },
  { value: 'forest', label: t('forest') },
  { value: 'sunset', label: t('sunset') },
  { value: 'lavender', label: t('lavender') },
  { value: 'rose', label: t('rose') },
  { value: 'gold', label: t('gold') },
  { value: 'slate', label: t('slate') },
  { value: 'rainbow', label: t('rainbow') },
]);
const structureOptions = computed(() => [
  { value: 'cards', label: t('cards') },
  { value: 'pills', label: t('pills') },
  { value: 'branches', label: t('branches') },
]);
const iconPicker = ref<HTMLElement>();
const iconTrigger = ref<HTMLButtonElement>();
const iconPanel = ref<HTMLElement>();
const iconPickerOpen = ref(false);
const iconPanelStyle = ref<Record<string, string>>({});
function closeIconPicker() { iconPickerOpen.value = false; iconTrigger.value?.focus(); }
function toggleIconPicker() {
  if (iconPickerOpen.value) { closeIconPicker(); return; }
  const rect = iconTrigger.value!.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 16);
  iconPanelStyle.value = {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${rect.bottom + 4}px`,
  };
  iconPickerOpen.value = true;
  void nextTick(() => {
    const height = iconPanel.value?.offsetHeight || 0;
    if (rect.bottom + height + 4 > window.innerHeight) {
      iconPanelStyle.value = { ...iconPanelStyle.value, top: `${Math.max(8, rect.top - height - 4)}px` };
    }
  });
}
function chooseIcon(icon: string) { setIcon(icon); closeIconPicker(); }
function setDirection(value: string) { void setMindMapLayout(value as MindMapLayout); }
function setTheme(value: string) { void setMindMapTheme(value as MindMapTheme); }
function setStructure(value: string) { void setMindMapStructure(value as MindMapStructure); }
function setIcon(value: string) { if (selected.value) operate({ type: 'icon', target: selected.value.id, icon: value || undefined }); }
const palettes = {
  ocean: { accent: '#58a6a0', strong: '#358e88' },
  forest: { accent: '#72a873', strong: '#438650' },
  sunset: { accent: '#d88b63', strong: '#bd694d' },
  lavender: { accent: '#a58ad8', strong: '#7855b7' },
  rose: { accent: '#d783a6', strong: '#ad507d' },
  gold: { accent: '#cba34a', strong: '#9c7520' },
  slate: { accent: '#8295ad', strong: '#536e8c' },
  rainbow: { accent: '#8b78d1', strong: '#6650b5' },
};
const rainbowColors = [
  { accent: '#e45b65', strong: '#bd3645' },
  { accent: '#e58b3f', strong: '#bd6424' },
  { accent: '#d0aa35', strong: '#9b7a13' },
  { accent: '#55a868', strong: '#347b45' },
  { accent: '#4596d2', strong: '#2871aa' },
  { accent: '#7774d8', strong: '#514db5' },
  { accent: '#bd68bd', strong: '#914391' },
];
const palette = computed(() => ({ '--mindmap-accent': palettes[theme.value].accent, '--mindmap-strong': palettes[theme.value].strong }));
const viewport = ref<HTMLElement>();
const sizes = ref(new Map<number, NodeSize>());
const sides = ref(new Map<number, -1 | 1>());
// Switching layouts should redistribute branches instead of retaining the previous side assignments.
watch(direction, () => { sides.value = new Map(); });
const previewId = computed(() => {
  let max = 0;
  const visit = (node: MindMapNode) => { max = Math.max(max, node.id); node.children.forEach(visit); };
  visit(root.value);
  return max + 1;
});
const previewRoot = computed(() => editing.value === 'child' || editing.value === 'sibling' || editing.value === 'before'
  ? editMindMap(root.value, { type: 'add', target: selectedId.value!, placement: editing.value, label: selected.value!.label })
  : root.value);
// Rainbow branches keep one color through their descendants, as in conventional mind-map themes.
const branchColors = computed(() => {
  const colors = new Map<number, (typeof rainbowColors)[number]>();
  previewRoot.value.children.forEach((branch, index) => {
    const color = rainbowColors[index % rainbowColors.length];
    const visit = (node: MindMapNode) => { colors.set(node.id, color); node.children.forEach(visit); };
    visit(branch);
  });
  return colors;
});
function branchStyle(id?: number) {
  const color = theme.value === 'rainbow' && id !== undefined ? branchColors.value.get(id) : undefined;
  return color ? { '--mindmap-accent': color.accent, '--mindmap-strong': color.strong } : {};
}
const previewFolded = computed(() => editing.value === 'child' && selectedId.value !== null
  ? new Set([...folded.value].filter(id => id !== selectedId.value)) : folded.value);
const editNodeId = computed(() => editing.value === 'rename' ? selectedId.value : previewId.value);
const diagram = computed(() => layoutMindMap(previewRoot.value, previewFolded.value, sizes.value, sides.value, direction.value));
const positions = computed(() => new Map(diagram.value.nodes.map(position => [position.id, position])));
const positionedNodes = computed(() => visibleNodes.value.map(entry => ({ ...entry, position: positions.value.get(entry.node.id)! })));
const margin = 96;
const originX = computed(() => margin - diagram.value.bounds.left);
const originY = computed(() => margin - diagram.value.bounds.top);
const canvasWidth = computed(() => diagram.value.bounds.right - diagram.value.bounds.left + margin * 2);
const canvasHeight = computed(() => diagram.value.bounds.bottom - diagram.value.bounds.top + margin * 2);
const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
let emittedSource = props.source;

watch(() => props.source, source => {
  if (source === emittedSource) return;
  root.value = parseMindMap(source);
  emittedSource = source;
  past.value = [];
  future.value = [];
  selectedId.value = root.value.id;
  editing.value = null;
  menu.value = null;
  folded.value = new Set();
  sides.value = new Map();
  sizes.value = new Map();
  initialFit = true;
  void nextTick(fit);
});

const selected = computed(() => findNode(root.value, selectedId.value));
function findNode(node: MindMapNode, id: number | null): MindMapNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
}
const visibleNodes = computed(() => {
  const entries: { node: MindMapNode; depth: number }[] = [];
  const visit = (node: MindMapNode, depth: number) => {
    entries.push({ node, depth });
    if (!folded.value.has(node.id)) node.children.forEach(child => visit(child, depth + 1));
  };
  visit(previewRoot.value, 0);
  return entries;
});
const parentOptions = computed(() => {
  const result: MindMapNode[] = [];
  const visit = (node: MindMapNode) => {
    if (node.id === selectedId.value) return;
    result.push(node);
    node.children.forEach(visit);
  };
  visit(root.value);
  return result;
});
function apply(next: MindMapNode) {
  sides.value = new Map([...sides.value, ...diagram.value.sides]);
  past.value.push(root.value);
  future.value = [];
  root.value = next;
  emittedSource = serializeMindMap(next);
  emit('change', emittedSource);
}
function operate(operation: Parameters<typeof editMindMap>[1]) {
  try { apply(editMindMap(root.value, operation)); } catch { /* Invalid/no-op moves leave source and dirty state unchanged. */ }
}
function undo() {
  if (!past.value.length) return;
  future.value.push(root.value);
  root.value = past.value.pop()!;
  emittedSource = serializeMindMap(root.value);
  emit('change', emittedSource);
}
function handleUndoKey(event: KeyboardEvent) { if (event.shiftKey) redo(); else undo(); }
function redo() {
  if (!future.value.length) return;
  past.value.push(root.value);
  root.value = future.value.pop()!;
  emittedSource = serializeMindMap(root.value);
  emit('change', emittedSource);
}
function startEdit(type: 'child' | 'sibling' | 'before' | 'rename', id = selectedId.value) {
  if (id === null || ((type === 'sibling' || type === 'before') && id === root.value.id)) return;
  selectedId.value = id;
  editing.value = type;
  draft.value = type === 'rename' ? selected.value?.label || '' : '';
  labelError.value = false;
  void nextTick(() => observed.get(editNodeId.value!)?.querySelector('input')?.focus());
}
function cancelEdit() {
  editing.value = null;
  labelError.value = false;
}
function submitEdit() {
  if (!selected.value || !editing.value) return;
  if (!validMindMapLabel(draft.value)) {
    labelError.value = true;
    void nextTick(() => observed.get(editNodeId.value!)?.querySelector('input')?.focus());
    return;
  }
  if (editing.value === 'rename' && draft.value !== selected.value.label) operate({ type: 'rename', target: selected.value.id, label: draft.value });
  else if (editing.value === 'child' || editing.value === 'sibling' || editing.value === 'before') {
    const target = selected.value.id;
    const ids: number[] = [];
    const collect = (node: MindMapNode) => { ids.push(node.id); node.children.forEach(collect); };
    collect(root.value);
    operate({ type: 'add', target, placement: editing.value, label: draft.value });
    if (editing.value === 'child') { const next = new Set(folded.value); next.delete(target); folded.value = next; }
    selectedId.value = Math.max(...ids) + 1;
  }
  editing.value = null;
  void nextTick(() => observed.get(selectedId.value!)?.focus());
}
function openMenu(event: MouseEvent, id: number) {
  if (editing.value) return;
  selectedId.value = id;
  menu.value = { id, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 180)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 170)) };
}
function closeMenu(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest('.mindmap-context-menu')) menu.value = null;
  if (iconPickerOpen.value && !iconPicker.value?.contains(event.target as Node)) iconPickerOpen.value = false;
}
function menuEdit(type: 'rename' | 'child' | 'sibling') {
  const id = menu.value?.id;
  menu.value = null;
  if (id !== undefined) startEdit(type, id);
}
function menuDelete() {
  menu.value = null;
  confirmDelete.value = true;
}
function deleteSelected() {
  confirmDelete.value = false;
  if (!selected.value) return;
  operate({ type: 'delete', target: selected.value.id });
  selectedId.value = root.value.id;
}
function clearDrag() { draggedId.value = null; dropTarget.value = null; }
function showDrop(id: number, placement: 'child' | 'before' | 'after') {
  if (draggedId.value !== null && draggedId.value !== id) dropTarget.value = { id, placement };
  else dropTarget.value = null;
}
function drop(destination: number, placement: 'child' | 'before' | 'after') {
  if (draggedId.value !== null && draggedId.value !== destination) operate({ type: 'move', target: draggedId.value, destination, placement });
  clearDrag();
}
function move(placement: 'up' | 'down' | 'promote') {
  if (selected.value) operate({ type: 'move', target: selected.value.id, placement });
}
function changeParent(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (selected.value && select.value) operate({ type: 'move', target: selected.value.id, destination: Number(select.value), placement: 'child' });
  select.value = '';
}
function toggleFold(id: number) {
  sides.value = new Map([...sides.value, ...diagram.value.sides]);
  const next = new Set(folded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  folded.value = next;
}
function setLevel(level: number) {
  sides.value = new Map([...sides.value, ...diagram.value.sides]);
  const next = new Set<number>();
  // The root is depth 0; a level-1 view keeps its immediate children visible.
  const visit = (node: MindMapNode, depth: number) => {
    if (level && depth >= level && node.children.length) next.add(node.id);
    node.children.forEach(child => visit(child, depth + 1));
  };
  visit(root.value, 0);
  folded.value = next;
  if (selectedId.value !== null && !visibleNodes.value.some(entry => entry.node.id === selectedId.value)) selectedId.value = root.value.id;
}
function selectNode(id: number) {
  if (editing.value) return;
  iconPickerOpen.value = false;
  selectedId.value = id;
  observed.get(id)?.focus();
}
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (event.key === 'Escape' && menu.value) { menu.value = null; return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); emit('save'); return; }
  if (target.closest('input, select, textarea, button')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); handleUndoKey(event); return; }
  if (editing.value || !selected.value || !target.closest('.mindmap-viewport')) return;
  const id = selected.value.id;
  const position = positions.value.get(id)!;
  let next: number | undefined;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const level = diagram.value.nodes.filter(node => node.side === position.side && node.depth === position.depth).sort((a, b) => a.y - b.y);
    next = level[level.findIndex(node => node.id === id) + (event.key === 'ArrowUp' ? -1 : 1)]?.id;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (position.side === direction || position.side === 0) {
      if (position.side === direction && folded.value.has(id) && selected.value.children.length) toggleFold(id);
      else next = selected.value.children.find(child => positions.value.get(child.id)?.side === direction)?.id;
    } else {
      next = parentOptions.value.find(node => node.children.some(child => child.id === id))?.id;
    }
  } else if (event.key === 'Tab') {
    if (event.shiftKey) move('promote'); else startEdit('child');
  } else if (event.key === 'Enter') startEdit(event.shiftKey ? 'before' : id === root.value.id ? 'child' : 'sibling');
  else if (event.key === 'F2') startEdit('rename');
  else if (event.key === 'Delete' || event.key === 'Backspace') { if (id !== root.value.id) confirmDelete.value = true; }
  else if (event.key === ' ' && selected.value.children.length) toggleFold(id);
  else return;
  event.preventDefault();
  if (next !== undefined) selectNode(next);
}
function zoom(delta: number) { scale.value = Math.max(0.4, Math.min(2, Math.round((scale.value + delta) * 10) / 10)); }
function fit() {
  if (!viewport.value) return;
  const { clientWidth, clientHeight } = viewport.value;
  if (!clientWidth || !clientHeight) return;
  scale.value = Math.max(0.4, Math.min(2, Math.min(clientWidth / canvasWidth.value, clientHeight / canvasHeight.value)));
  offsetX.value = (clientWidth - canvasWidth.value * scale.value) / 2;
  offsetY.value = (clientHeight - canvasHeight.value * scale.value) / 2;
}
const observed = new Map<number, HTMLElement>();
const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
  const next = new Map(sizes.value);
  let changed = false;
  for (const entry of entries) {
    if (entry.target === viewport.value) continue;
    const id = Number((entry.target as HTMLElement).dataset.nodeId);
    const width = (entry.target as HTMLElement).offsetWidth;
    const height = (entry.target as HTMLElement).offsetHeight;
    if (!width || !height) continue;
    if (next.get(id)?.width !== width || next.get(id)?.height !== height) {
      next.set(id, { width, height });
      changed = true;
    }
  }
  if (changed) sizes.value = next;
  if (initialFit && viewport.value?.clientWidth && viewport.value.clientHeight && visibleNodes.value.every(entry => next.has(entry.node.id))) {
    initialFit = false;
    void nextTick(fit);
  }
});
let initialFit = true;
function observeNode(element: Element | ComponentPublicInstance | null, id: number) {
  const old = observed.get(id);
  if (old === element) return;
  if (old) { observer?.unobserve(old); observed.delete(id); }
  if (!(element instanceof HTMLElement)) return;
  element.dataset.nodeId = String(id);
  observed.set(id, element);
  observer?.observe(element);
}
onMounted(() => {
  document.addEventListener('pointerdown', closeMenu);
  if (viewport.value) observer?.observe(viewport.value);
  void nextTick(() => { if (!observer) fit(); });
});
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener('pointerdown', closeMenu); });
function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) zoom(event.deltaY < 0 ? 0.1 : -0.1);
  else { offsetX.value -= event.deltaX; offsetY.value -= event.deltaY; }
}
let pointer: { id: number; x: number; y: number } | null = null;
function startPan(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('.mindmap-node, .mindmap-fold')) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function pan(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return;
  offsetX.value += event.clientX - pointer.x;
  offsetY.value += event.clientY - pointer.y;
  pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
}
function endPan() { pointer = null; }
</script>

<style scoped>
.mindmap-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--text-primary); background: var(--bg-primary); }
.mindmap-toolbar, .mindmap-mobile-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-color); }
.mindmap-toolbar button, .mindmap-mobile-controls button, .mindmap-context-menu button { border: 1px solid var(--border-color); border-radius: 6px; padding: 5px 9px; background: var(--bg-secondary); color: inherit; cursor: pointer; }
.mindmap-toolbar button:disabled { opacity: .4; cursor: default; }
.mindmap-history-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0 !important; }
.mindmap-history-button svg { width: 18px; height: 18px; }
.mindmap-toolbar-spacer { flex: 1; }
.mindmap-view-controls { display: flex; align-items: center; gap: 8px; padding-left: 12px; border-left: 1px solid var(--border-color); }
.mindmap-inline-edit input, .mindmap-mobile-controls select { max-width: 180px; padding: 5px; background: var(--bg-secondary); color: inherit; border: 1px solid var(--border-color); }
.mindmap-levels :deep(.custom-select) { min-width: 120px; max-width: 180px; }
.mindmap-level-depth :deep(.custom-select) { min-width: 165px; }
.mindmap-icon-trigger { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 90px; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.65rem 0.8rem; background: var(--bg-surface); color: var(--text-primary); cursor: pointer; }
.mindmap-icon-trigger:disabled { opacity: .65; cursor: not-allowed; }
.mindmap-icon-trigger:focus-visible, .mindmap-icon-panel button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mindmap-icon-panel { position: fixed; z-index: 50; box-sizing: border-box; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-surface); box-shadow: var(--shadow-lg); max-height: calc(100vh - 16px); overflow-y: auto; }
.mindmap-icon-clear { width: 100%; margin-bottom: 8px; padding: 6px; text-align: left; border-bottom: 1px solid var(--border) !important; }
.mindmap-icon-grid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 2px; }
.mindmap-icon-panel button { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 34px; padding: 2px; border: 0; border-radius: 5px; background: transparent; color: var(--text-primary); font-size: 18px; cursor: pointer; }
.mindmap-icon-panel button:hover, .mindmap-icon-panel button.active { background: var(--accent-muted); color: var(--accent); }
.mindmap-inline-edit { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 4px; width: 100%; }
.mindmap-inline-edit input { width: 100%; min-width: 0; box-sizing: border-box; }
.mindmap-context-menu { position: fixed; z-index: 100; display: flex; flex-direction: column; min-width: 150px; padding: 4px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); box-shadow: 0 6px 20px #0004; }
.mindmap-context-menu button { display: flex; align-items: center; gap: 8px; text-align: left; border: 0; background: transparent; }
.mindmap-context-menu button svg { flex: 0 0 auto; font-size: 16px; }
.mindmap-context-menu button:hover { background: color-mix(in srgb, var(--mindmap-accent) 20%, var(--bg-secondary)); }
.mindmap-inline-edit [role="alert"] { color: #d14d4d; font-size: 12px; }
.mindmap-levels { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.mindmap-levels > span { white-space: nowrap; }
.mindmap-icon { margin-right: 6px; }
.mindmap-colored-flag { font-family: sans-serif; font-size: 1.2em; }
.mindmap-editor.pills .mindmap-node { border-radius: 999px; background: color-mix(in srgb, var(--mindmap-accent) 14%, var(--bg-secondary)); }
.mindmap-editor.branches .mindmap-node { border: 0; border-bottom: 3px solid var(--mindmap-accent); border-radius: 0; background: transparent; box-shadow: none; }
.mindmap-editor.branches .mindmap-node.root { border: 3px solid var(--mindmap-strong); border-radius: 12px; background: linear-gradient(135deg, color-mix(in srgb, var(--mindmap-accent) 32%, var(--bg-secondary)), var(--bg-secondary)); }
.mindmap-shortcuts { padding: 4px 8px; color: var(--text-tertiary); font-size: 11px; }
.mindmap-viewport { flex: 1; min-height: 0; overflow: hidden; touch-action: none; cursor: grab; background: var(--bg-primary); background-image: radial-gradient(circle, var(--border-color) .7px, transparent 1px); background-size: 28px 28px; }
.mindmap-canvas { position: relative; transform-origin: 0 0; }
.mindmap-connections { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.mindmap-connections path { fill: none; stroke: var(--mindmap-accent); stroke-width: 2; opacity: .65; }
.mindmap-item { position: absolute; width: max-content; transform: translate(-50%, -50%); }
.mindmap-fold { position: absolute; top: 50%; right: -12px; transform: translateY(-50%); width: 24px; height: 24px; border: 1px solid var(--mindmap-accent); border-radius: 50%; background: var(--bg-secondary); color: inherit; cursor: pointer; }
.mindmap-fold.left { right: auto; left: -12px; }
.mindmap-node { position: relative; box-sizing: border-box; width: max-content; max-width: 320px; min-height: 44px; display: flex; align-items: center; justify-content: center; text-align: center; overflow-wrap: anywhere; border: 1px solid var(--border-color); border-radius: 12px; padding: 8px 16px; background: var(--bg-secondary); box-shadow: 0 3px 12px #0002; cursor: grab; user-select: none; line-height: 1.4; font-size: 18px; }
.mindmap-node.branch { border: 2px solid var(--mindmap-accent); font-size: 19px; font-weight: 600; }
.mindmap-node.root { min-height: 58px; border: 3px solid var(--mindmap-strong); border-radius: 22px; padding: 12px 24px; background: linear-gradient(135deg, color-mix(in srgb, var(--mindmap-accent) 32%, var(--bg-secondary)), var(--bg-secondary)); box-shadow: 0 6px 20px color-mix(in srgb, var(--mindmap-strong) 28%, transparent); font-size: 22px; font-weight: 750; cursor: default; }
.mindmap-node.selected { outline: 3px solid var(--mindmap-accent); outline-offset: 3px; }
.mindmap-node.drop-child { background: color-mix(in srgb, var(--mindmap-accent) 30%, var(--bg-secondary)); border-color: var(--mindmap-accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--mindmap-accent) 55%, transparent); }
.mindmap-node.drop-before::before, .mindmap-node.drop-after::after { content: ''; position: absolute; left: -12px; right: -12px; height: 5px; border-radius: 3px; background: var(--mindmap-accent); box-shadow: 0 0 0 2px var(--bg-secondary); }
.mindmap-node.drop-before::before { top: -9px; }
.mindmap-node.drop-after::after { bottom: -9px; }
.mindmap-drop-edge { position: absolute; left: 12px; right: 12px; height: 12px; z-index: 1; border-radius: 4px; }
.mindmap-drop-edge:first-child { top: -6px; }
.mindmap-drop-edge:last-child { bottom: -6px; }
.mindmap-editor.dragging .mindmap-drop-edge:hover { background: var(--mindmap-accent); box-shadow: 0 0 0 2px var(--bg-secondary); }
.mindmap-node:hover { border-color: var(--mindmap-accent); }
@media (min-width: 769px) { .mindmap-mobile-controls { display: none; } }
</style>
