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
      <div class="mindmap-view-controls">
        <button type="button" @click="zoom(-0.1)" :aria-label="t('zoomOut')">−</button>
        <span>{{ Math.round(scale * 100) }}%</span>
        <button type="button" @click="zoom(0.1)" :aria-label="t('zoomIn')">+</button>
        <button type="button" @click="fit">{{ t('fit') }}</button>
      </div>
    </div>
    <form v-if="editing" class="mindmap-edit-form" @submit.prevent="submitEdit">
      <label for="mindmap-label">{{ t('label') }}</label>
      <input id="mindmap-label" ref="labelInput" v-model="draft" :aria-invalid="!!labelError" />
      <button type="submit">{{ t('apply') }}</button>
      <button type="button" @click="editing = null">{{ t('cancel') }}</button>
      <span v-if="labelError" role="alert">{{ t('invalidLabel') }}</span>
    </form>
    <div ref="viewport" class="mindmap-viewport" tabindex="0" @pointerdown="startPan" @pointermove="pan" @pointerup="endPan" @pointercancel="endPan" @wheel.prevent="onWheel">
      <div class="mindmap-canvas" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px`, transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }">
        <svg class="mindmap-connections" :width="canvasWidth" :height="canvasHeight" aria-hidden="true">
          <path v-for="(path, index) in diagram.connectors" :key="index" :d="path" :transform="`translate(${originX} ${originY})`" />
        </svg>
        <div v-for="entry in positionedNodes" :key="entry.node.id" class="mindmap-item" :style="{ left: `${entry.position.x + originX}px`, top: `${entry.position.y + originY}px`, width: `${entry.position.width}px` }">
          <div :ref="el => observeNode(el, entry.node.id)" class="mindmap-node" role="button" tabindex="0" :aria-label="entry.node.label" :aria-pressed="selectedId === entry.node.id" :class="{ selected: selectedId === entry.node.id, root: !entry.position.depth, branch: entry.position.depth === 1 }" :draggable="entry.node.id !== root.id" @click="selectedId = entry.node.id" @keydown.enter="selectedId = entry.node.id" @dragstart="draggedId = entry.node.id" @dragend="draggedId = null" @dragover.prevent @drop.prevent="drop(entry.node.id, 'child')">
            <div v-if="entry.node.id !== root.id" class="mindmap-drop-edge" @dragover.prevent @drop.stop.prevent="drop(entry.node.id, 'before')" />
            {{ entry.node.label }}
            <div v-if="entry.node.id !== root.id" class="mindmap-drop-edge" @dragover.prevent @drop.stop.prevent="drop(entry.node.id, 'after')" />
          </div>
          <button v-if="entry.node.children.length" type="button" class="mindmap-fold" :class="{ left: entry.position.side < 0 }" :aria-label="folded.has(entry.node.id) ? t('expand') : t('collapse')" @click="toggleFold(entry.node.id)">{{ folded.has(entry.node.id) ? '+' : '−' }}</button>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { i18n } from '../i18n';
import ConfirmModal from './ConfirmModal.vue';
import { editMindMap, parseMindMap, serializeMindMap, validMindMapLabel, type MindMapNode } from '../utils/mindMap';
import { layoutMindMap, type NodeSize } from '../utils/mindMapLayout';

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
const sizes = ref(new Map<number, NodeSize>());
const sides = ref(new Map<number, -1 | 1>());
const diagram = computed(() => layoutMindMap(root.value, folded.value, sizes.value, sides.value));
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
  sides.value = new Map([...sides.value, ...diagram.value.sides]);
  const next = new Set(folded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  folded.value = next;
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
  if (viewport.value) observer?.observe(viewport.value);
  void nextTick(() => { if (!observer) fit(); });
});
onBeforeUnmount(() => observer?.disconnect());
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
.mindmap-view-controls { display: flex; align-items: center; gap: 8px; padding-left: 12px; border-left: 1px solid var(--border-color); }
.mindmap-edit-form input, .mindmap-mobile-controls select { max-width: 180px; padding: 5px; background: var(--bg-secondary); color: inherit; border: 1px solid var(--border-color); }
.mindmap-edit-form [role="alert"] { color: #d14d4d; }
.mindmap-viewport { flex: 1; min-height: 0; overflow: hidden; touch-action: none; cursor: grab; background: var(--bg-primary); background-image: radial-gradient(circle, var(--border-color) .7px, transparent 1px); background-size: 28px 28px; }
.mindmap-canvas { position: relative; transform-origin: 0 0; }
.mindmap-connections { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.mindmap-connections path { fill: none; stroke: #58a6a0; stroke-width: 2; opacity: .65; }
.mindmap-item { position: absolute; transform: translate(-50%, -50%); }
.mindmap-fold { position: absolute; top: 50%; right: -12px; transform: translateY(-50%); width: 24px; height: 24px; border: 1px solid #58a6a0; border-radius: 50%; background: var(--bg-secondary); color: inherit; cursor: pointer; }
.mindmap-fold.left { right: auto; left: -12px; }
.mindmap-node { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center; justify-content: center; text-align: center; overflow-wrap: anywhere; border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 22px; background: var(--bg-secondary); box-shadow: 0 3px 12px #0002; cursor: grab; user-select: none; line-height: 1.4; font-size: 14px; }
.mindmap-node.branch { border: 2px solid #58a6a0; font-size: 16px; font-weight: 600; }
.mindmap-node.root { border: 2px solid #358e88; border-radius: 22px; background: var(--bg-secondary); font-size: 18px; font-weight: 700; cursor: default; }
.mindmap-node.selected { outline: 3px solid #58a6a0; outline-offset: 3px; }
.mindmap-drop-edge { position: absolute; left: 12px; right: 12px; height: 12px; z-index: 1; border-radius: 4px; }
.mindmap-drop-edge:first-child { top: -6px; }
.mindmap-drop-edge:last-child { bottom: -6px; }
.mindmap-drop-edge:hover, .mindmap-drop-edge:focus { background: #58a6a0; box-shadow: 0 0 0 2px var(--bg-secondary); }
.mindmap-node:hover { border-color: #58a6a0; }
@media (min-width: 769px) { .mindmap-mobile-controls { display: none; } }
</style>
