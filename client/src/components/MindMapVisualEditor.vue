<template>
  <div class="mindmap-editor" @keydown="onKeydown">
    <div class="mindmap-toolbar">
      <button type="button" :disabled="!selected" @click="startEdit('child')">{{ t('child') }}</button>
      <button type="button" :disabled="!selected || selected.id === root.id" @click="startEdit('sibling')">{{ t('sibling') }}</button>
      <button type="button" :disabled="!selected" @click="startEdit('rename')">{{ t('rename') }}</button>
      <button type="button" :disabled="!selected || selected.id === root.id" @click="confirmDelete = true">{{ t('delete') }}</button>
      <button type="button" :disabled="!past.length" @click="undo">{{ t('undo') }}</button>
      <button type="button" :disabled="!future.length" @click="redo">{{ t('redo') }}</button>
      <label class="mindmap-levels">{{ t('levels') }}
        <select :aria-label="t('levels')" @change="changeLevel">
          <option value="" selected disabled>{{ t('chooseLevel') }}</option>
          <option v-for="level in 3" :key="level" :value="level">{{ t('throughLevel', { level }) }}</option>
          <option value="0">{{ t('expandAll') }}</option>
        </select>
      </label>
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
          <path v-for="(path, index) in diagram.connectors" :key="index" :d="path" :transform="`translate(${originX} ${originY})`" />
        </svg>
        <div v-for="entry in positionedNodes" :key="entry.node.id" class="mindmap-item" :style="{ left: `${entry.position.x + originX}px`, top: `${entry.position.y + originY}px`, width: `${entry.position.width}px` }">
          <div :ref="el => observeNode(el, entry.node.id)" class="mindmap-node" role="button" tabindex="0" :aria-label="entry.node.label" :aria-pressed="selectedId === entry.node.id" :class="{ selected: selectedId === entry.node.id, root: !entry.position.depth, branch: entry.position.depth === 1, 'drop-child': dropTarget?.id === entry.node.id && dropTarget.placement === 'child', 'drop-before': dropTarget?.id === entry.node.id && dropTarget.placement === 'before', 'drop-after': dropTarget?.id === entry.node.id && dropTarget.placement === 'after' }" :draggable="!editing && entry.node.id !== root.id" @click="selectNode(entry.node.id)" @dblclick="startEdit('rename', entry.node.id)" @dragstart="draggedId = entry.node.id" @dragend="clearDrag" @dragover.prevent="showDrop(entry.node.id, 'child')" @drop.prevent="drop(entry.node.id, 'child')">
            <div v-if="entry.node.id !== root.id" class="mindmap-drop-edge" @dragover.stop.prevent="showDrop(entry.node.id, 'before')" @drop.stop.prevent="drop(entry.node.id, 'before')" />
            <form v-if="editing && editNodeId === entry.node.id" class="mindmap-inline-edit" @submit.stop.prevent="submitEdit" @click.stop @dblclick.stop>
              <input id="mindmap-label" v-model="draft" :aria-label="t('label')" :aria-invalid="labelError" @keydown.esc.stop.prevent="editing = null" />
              <span v-if="labelError" role="alert">{{ t('invalidLabel') }}</span>
              <div class="mindmap-edit-actions"><button type="submit">{{ t('apply') }}</button><button type="button" @click="editing = null">{{ t('cancel') }}</button></div>
            </form>
            <span v-else>{{ entry.node.label }}</span>
            <div v-if="entry.node.id !== root.id" class="mindmap-drop-edge" @dragover.stop.prevent="showDrop(entry.node.id, 'after')" @drop.stop.prevent="drop(entry.node.id, 'after')" />
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
const t = (key: string, params?: Record<string, number>) => i18n.global.t(`components.editorPanel.mindMap.${key}`, params || {});
const root = ref<MindMapNode>(parseMindMap(props.source));
const past = ref<MindMapNode[]>([]);
const future = ref<MindMapNode[]>([]);
const selectedId = ref<number | null>(root.value.id);
const folded = ref(new Set<number>());
const draggedId = ref<number | null>(null);
const dropTarget = ref<{ id: number; placement: 'child' | 'before' | 'after' } | null>(null);
const editing = ref<'child' | 'sibling' | 'rename' | null>(null);
const draft = ref('');
const labelError = ref(false);
const confirmDelete = ref(false);
const viewport = ref<HTMLElement>();
const sizes = ref(new Map<number, NodeSize>());
const sides = ref(new Map<number, -1 | 1>());
const previewId = computed(() => {
  let max = 0;
  const visit = (node: MindMapNode) => { max = Math.max(max, node.id); node.children.forEach(visit); };
  visit(root.value);
  return max + 1;
});
const previewRoot = computed(() => editing.value === 'child' || editing.value === 'sibling'
  ? editMindMap(root.value, { type: 'add', target: selectedId.value!, placement: editing.value, label: selected.value!.label })
  : root.value);
const previewFolded = computed(() => editing.value === 'child' && selectedId.value !== null
  ? new Set([...folded.value].filter(id => id !== selectedId.value)) : folded.value);
const editNodeId = computed(() => editing.value === 'rename' ? selectedId.value : previewId.value);
const diagram = computed(() => layoutMindMap(previewRoot.value, previewFolded.value, sizes.value, sides.value));
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
function startEdit(type: 'child' | 'sibling' | 'rename', id = selectedId.value) {
  if (id === null || (type === 'sibling' && id === root.value.id)) return;
  selectedId.value = id;
  editing.value = type;
  draft.value = type === 'rename' ? selected.value?.label || '' : '';
  labelError.value = false;
  void nextTick(() => observed.get(editNodeId.value!)?.querySelector('input')?.focus());
}
function submitEdit() {
  if (!selected.value) return;
  if (!validMindMapLabel(draft.value)) { labelError.value = true; return; }
  if (editing.value === 'rename') operate({ type: 'rename', target: selected.value.id, label: draft.value });
  else if (editing.value) {
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
function changeLevel(event: Event) {
  const select = event.target as HTMLSelectElement;
  setLevel(Number(select.value));
  select.value = '';
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
  selectedId.value = id;
  observed.get(id)?.focus();
}
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); emit('save'); return; }
  if (target.closest('input, select, textarea, button')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); handleUndoKey(event); return; }
  if (editing.value || !selected.value || !target.closest('.mindmap-viewport')) return;
  const id = selected.value.id;
  // Navigate tree order rather than screen coordinates, which change across left/right branches.
  const visible = visibleNodes.value.map(entry => entry.node.id);
  const index = visible.indexOf(id);
  let next: number | undefined;
  if (event.key === 'ArrowUp') next = visible[index - 1];
  else if (event.key === 'ArrowDown') next = visible[index + 1];
  else if (event.key === 'ArrowLeft') {
    if (selected.value.children.length && !folded.value.has(id)) toggleFold(id);
    else next = parentOptions.value.find(node => node.children.some(child => child.id === id))?.id;
  } else if (event.key === 'ArrowRight') {
    if (folded.value.has(id)) toggleFold(id);
    else next = selected.value.children[0]?.id;
  } else if (event.key === 'Tab') {
    if (event.shiftKey) move('promote'); else startEdit('child');
  } else if (event.key === 'Enter') startEdit(id === root.value.id ? 'child' : 'sibling');
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
.mindmap-toolbar, .mindmap-mobile-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-color); }
.mindmap-toolbar button, .mindmap-mobile-controls button, .mindmap-inline-edit button { border: 1px solid var(--border-color); border-radius: 6px; padding: 5px 9px; background: var(--bg-secondary); color: inherit; cursor: pointer; }
.mindmap-toolbar button:disabled { opacity: .4; cursor: default; }
.mindmap-toolbar-spacer { flex: 1; }
.mindmap-view-controls { display: flex; align-items: center; gap: 8px; padding-left: 12px; border-left: 1px solid var(--border-color); }
.mindmap-inline-edit input, .mindmap-mobile-controls select, .mindmap-levels select { max-width: 180px; padding: 5px; background: var(--bg-secondary); color: inherit; border: 1px solid var(--border-color); }
.mindmap-inline-edit { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 4px; width: 100%; }
.mindmap-inline-edit input { width: 100%; min-width: 0; box-sizing: border-box; }
.mindmap-edit-actions { display: flex; justify-content: center; gap: 4px; }
.mindmap-inline-edit [role="alert"] { color: #d14d4d; font-size: 12px; }
.mindmap-levels { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.mindmap-shortcuts { padding: 4px 8px; color: var(--text-tertiary); font-size: 11px; }
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
.mindmap-node.drop-child { background: color-mix(in srgb, #58a6a0 30%, var(--bg-secondary)); border-color: #58a6a0; box-shadow: 0 0 0 4px #58a6a088; }
.mindmap-node.drop-before::before, .mindmap-node.drop-after::after { content: ''; position: absolute; left: -12px; right: -12px; height: 5px; border-radius: 3px; background: #58a6a0; box-shadow: 0 0 0 2px var(--bg-secondary); }
.mindmap-node.drop-before::before { top: -9px; }
.mindmap-node.drop-after::after { bottom: -9px; }
.mindmap-drop-edge { position: absolute; left: 12px; right: 12px; height: 12px; z-index: 1; border-radius: 4px; }
.mindmap-drop-edge:first-child { top: -6px; }
.mindmap-drop-edge:last-child { bottom: -6px; }
.mindmap-drop-edge:hover, .mindmap-drop-edge:focus { background: #58a6a0; box-shadow: 0 0 0 2px var(--bg-secondary); }
.mindmap-node:hover { border-color: #58a6a0; }
@media (min-width: 769px) { .mindmap-mobile-controls { display: none; } }
</style>
