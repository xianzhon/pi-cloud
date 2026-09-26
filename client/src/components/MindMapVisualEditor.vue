<template>
  <div class="mindmap-editor" @keydown.ctrl.s.prevent="emit('save')" @keydown.meta.s.prevent="emit('save')" @keydown.ctrl.z.prevent="handleUndoKey" @keydown.meta.z.prevent="handleUndoKey">
    <div class="mindmap-toolbar">
      <button type="button" :disabled="!selected" @click="startEdit('child')">{{ t('child') }}</button>
      <button type="button" :disabled="!selected || selected.id === root.id" @click="startEdit('sibling')">{{ t('sibling') }}</button>
      <button type="button" :disabled="!selected" @click="startEdit('rename')">{{ t('rename') }}</button>
      <button type="button" :disabled="!selected || selected.id === root.id" @click="confirmDelete = true">{{ t('delete') }}</button>
      <button type="button" :disabled="!past.length" @click="undo">{{ t('undo') }}</button>
      <button type="button" :disabled="!future.length" @click="redo">{{ t('redo') }}</button>
      <span class="mindmap-toolbar-spacer" />
      <button type="button" @click="zoom(-0.1)" :aria-label="t('zoomOut')">−</button>
      <span>{{ Math.round(scale * 100) }}%</span>
      <button type="button" @click="zoom(0.1)" :aria-label="t('zoomIn')">+</button>
      <button type="button" @click="fit">{{ t('fit') }}</button>
    </div>
    <form v-if="editing" class="mindmap-edit-form" @submit.prevent="submitEdit">
      <label for="mindmap-label">{{ t('label') }}</label>
      <input id="mindmap-label" ref="labelInput" v-model="draft" :aria-invalid="!!labelError" />
      <button type="submit">{{ t('apply') }}</button>
      <button type="button" @click="editing = null">{{ t('cancel') }}</button>
      <span v-if="labelError" role="alert">{{ t('invalidLabel') }}</span>
    </form>
    <div ref="viewport" class="mindmap-viewport" tabindex="0" @pointerdown="startPan" @pointermove="pan" @pointerup="endPan" @pointercancel="endPan" @wheel.prevent="onWheel">
      <div ref="canvas" class="mindmap-canvas" :style="{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }">
        <div v-for="entry in visibleNodes" :key="entry.node.id" class="mindmap-row" :style="{ paddingLeft: `${entry.depth * 42 + 18}px` }">
          <button v-if="entry.node.children.length" type="button" class="mindmap-fold" :aria-label="folded.has(entry.node.id) ? t('expand') : t('collapse')" @click="toggleFold(entry.node.id)">{{ folded.has(entry.node.id) ? '+' : '−' }}</button>
          <span v-else class="mindmap-fold-placeholder" />
          <div class="mindmap-node" role="button" tabindex="0" :aria-pressed="selectedId === entry.node.id" :class="{ selected: selectedId === entry.node.id }" draggable="true" @click="selectedId = entry.node.id" @keydown.enter="selectedId = entry.node.id" @dragstart="draggedId = entry.node.id" @dragend="draggedId = null" @dragover.prevent @drop.prevent="drop(entry.node.id, 'child')">
            <div class="mindmap-drop-edge" @dragover.prevent @drop.stop.prevent="drop(entry.node.id, 'before')" />
            {{ entry.node.label }}
            <div class="mindmap-drop-edge" @dragover.prevent @drop.stop.prevent="drop(entry.node.id, 'after')" />
          </div>
        </div>
      </div>
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
import { computed, nextTick, ref, watch } from 'vue';
import { i18n } from '../i18n';
import ConfirmModal from './ConfirmModal.vue';
import { editMindMap, parseMindMap, serializeMindMap, validMindMapLabel, type MindMapNode } from '../utils/mindMap';

const props = defineProps<{ source: string }>();
const emit = defineEmits<{ change: [source: string]; save: [] }>();
const t = (key: string) => i18n.global.t(`components.editorPanel.mindMap.${key}`);
const root = ref<MindMapNode>(parseMindMap(props.source));
const past = ref<MindMapNode[]>([]);
const future = ref<MindMapNode[]>([]);
const selectedId = ref<number | null>(root.value.id);
const folded = ref(new Set<number>());
const draggedId = ref<number | null>(null);
const editing = ref<'child' | 'sibling' | 'rename' | null>(null);
const draft = ref('');
const labelError = ref(false);
const labelInput = ref<HTMLInputElement>();
const confirmDelete = ref(false);
const viewport = ref<HTMLElement>();
const canvas = ref<HTMLElement>();
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
  folded.value = new Set();
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
  visit(root.value, 0);
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
function startEdit(type: 'child' | 'sibling' | 'rename') {
  editing.value = type;
  draft.value = type === 'rename' ? selected.value?.label || '' : '';
  labelError.value = false;
  void nextTick(() => labelInput.value?.focus());
}
function submitEdit() {
  if (!selected.value) return;
  if (!validMindMapLabel(draft.value)) { labelError.value = true; return; }
  if (editing.value === 'rename') operate({ type: 'rename', target: selected.value.id, label: draft.value });
  else if (editing.value) operate({ type: 'add', target: selected.value.id, placement: editing.value, label: draft.value });
  editing.value = null;
}
function deleteSelected() {
  confirmDelete.value = false;
  if (!selected.value) return;
  operate({ type: 'delete', target: selected.value.id });
  selectedId.value = root.value.id;
}
function drop(destination: number, placement: 'child' | 'before' | 'after') {
  if (draggedId.value !== null) operate({ type: 'move', target: draggedId.value, destination, placement });
  draggedId.value = null;
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
  const next = new Set(folded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  folded.value = next;
}
function zoom(delta: number) { scale.value = Math.max(0.4, Math.min(2, Math.round((scale.value + delta) * 10) / 10)); }
function fit() {
  if (!viewport.value || !canvas.value) return;
  scale.value = Math.max(0.4, Math.min(2, Math.min(viewport.value.clientWidth / canvas.value.offsetWidth, viewport.value.clientHeight / canvas.value.offsetHeight)));
  offsetX.value = 0;
  offsetY.value = 0;
}
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
.mindmap-toolbar, .mindmap-mobile-controls, .mindmap-edit-form { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-color); }
.mindmap-toolbar button, .mindmap-mobile-controls button, .mindmap-edit-form button { border: 1px solid var(--border-color); border-radius: 6px; padding: 5px 9px; background: var(--bg-secondary); color: inherit; cursor: pointer; }
.mindmap-toolbar button:disabled { opacity: .4; cursor: default; }
.mindmap-toolbar-spacer { flex: 1; }
.mindmap-edit-form input, .mindmap-mobile-controls select { max-width: 180px; padding: 5px; background: var(--bg-secondary); color: inherit; border: 1px solid var(--border-color); }
.mindmap-edit-form [role="alert"] { color: #d14d4d; }
.mindmap-viewport { flex: 1; min-height: 0; overflow: hidden; touch-action: none; cursor: grab; background-image: radial-gradient(circle, var(--border-color) 1px, transparent 1px); background-size: 22px 22px; }
.mindmap-canvas { transform-origin: 0 0; width: max-content; min-width: 100%; padding: 24px 32px 80px 0; }
.mindmap-row { display: flex; align-items: center; gap: 8px; min-height: 58px; }
.mindmap-fold, .mindmap-fold-placeholder { width: 22px; flex: none; text-align: center; }
.mindmap-fold { border: 1px solid var(--border-color); border-radius: 50%; background: var(--bg-secondary); color: inherit; cursor: pointer; }
.mindmap-node { position: relative; min-width: 90px; border: 1px solid var(--border-color); border-left: 3px solid #58a6a0; border-radius: 7px; padding: 8px 14px; background: var(--bg-secondary); box-shadow: 0 3px 12px #0002; cursor: grab; user-select: none; }
.mindmap-node.selected { outline: 2px solid #58a6a0; outline-offset: 2px; }
.mindmap-drop-edge { position: absolute; left: 0; right: 0; height: 10px; }
.mindmap-drop-edge:first-child { top: -7px; }
.mindmap-drop-edge:last-child { bottom: -7px; }
@media (min-width: 769px) { .mindmap-mobile-controls { display: none; } }
</style>
