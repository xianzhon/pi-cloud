<template>
  <div class="pdf-preview">
    <div class="pdf-toolbar" role="toolbar" :aria-label="t('components.editorPanel.pdfControls')">
      <div class="pdf-toolbar-group" role="group" :aria-label="t('components.editorPanel.pdfAnnotationControls')">
        <button
          type="button"
          class="tooltip"
          :class="{ active: tool === 'pen' }"
          :aria-pressed="tool === 'pen'"
          :aria-label="t('components.editorPanel.pdfPen')"
          :data-tooltip="t('components.editorPanel.pdfPen')"
          @click="tool = tool === 'pen' ? 'pan' : 'pen'"
        ><PhPencilSimple :size="19" /></button>
        <button
          type="button"
          class="tooltip"
          :class="{ active: tool === 'eraser' }"
          :aria-pressed="tool === 'eraser'"
          :aria-label="t('components.editorPanel.pdfEraser')"
          :data-tooltip="t('components.editorPanel.pdfEraser')"
          @click="tool = tool === 'eraser' ? 'pan' : 'eraser'"
        ><PhEraser :size="19" /></button>
        <label class="pdf-control-label tooltip" :data-tooltip="t('components.editorPanel.pdfPenColor')">
          <input v-model="penColor" type="color" :aria-label="t('components.editorPanel.pdfPenColor')">
        </label>
        <label class="pdf-width-control tooltip" :data-tooltip="t('components.editorPanel.pdfPenWidth')">
          <input
            v-model.number="penWidth"
            type="range"
            min="1"
            max="12"
            :aria-label="t('components.editorPanel.pdfPenWidth')"
          >
        </label>
        <button
          type="button"
          class="tooltip"
          :disabled="!canUndo"
          :aria-label="t('components.editorPanel.undoPdfAnnotation')"
          :data-tooltip="t('components.editorPanel.undoPdfAnnotation')"
          @click="undo"
        ><PhArrowCounterClockwise :size="19" /></button>
        <button
          type="button"
          class="tooltip"
          :disabled="!canRedo"
          :aria-label="t('components.editorPanel.redoPdfAnnotation')"
          :data-tooltip="t('components.editorPanel.redoPdfAnnotation')"
          @click="redo"
        ><PhArrowClockwise :size="19" /></button>
        <button
          type="button"
          class="tooltip"
          :disabled="!currentPageStrokes.length"
          :aria-label="t('components.editorPanel.clearPdfPageAnnotations')"
          :data-tooltip="t('components.editorPanel.clearPdfPageAnnotations')"
          @click="clearPage"
        ><PhTrash :size="19" /></button>
        <span
          class="pdf-annotation-status"
          :class="`is-${saveState || 'idle'}`"
          role="status"
          :aria-label="saveStateLabel"
        >
          <span v-if="saveState === 'saving'" class="pdf-save-spinner" aria-hidden="true" />
          <span v-else-if="saveState === 'saved'" aria-hidden="true">✓</span>
          <span v-else-if="saveState === 'error'" aria-hidden="true">!</span>
        </span>
      </div>
      <div class="pdf-toolbar-group" role="group">
        <button
          type="button"
          class="tooltip"
          :disabled="loading || pageNumber <= 1"
          :aria-label="t('components.editorPanel.previousPage')"
          :data-tooltip="t('components.editorPanel.previousPage')"
          @click="pageNumber--"
        ><PhCaretLeft :size="18" weight="bold" /></button>
        <span class="pdf-page-status">
          {{ t('components.editorPanel.pdfPageStatus', { page: pageNumber, pages: pageCount || 1 }) }}
        </span>
        <button
          type="button"
          class="tooltip"
          :disabled="loading || pageNumber >= pageCount"
          :aria-label="t('components.editorPanel.nextPage')"
          :data-tooltip="t('components.editorPanel.nextPage')"
          @click="pageNumber++"
        ><PhCaretRight :size="18" weight="bold" /></button>
        <button
          type="button"
          class="tooltip"
          :disabled="loading || scale <= MIN_SCALE"
          :aria-label="t('components.editorPanel.zoomOut')"
          :data-tooltip="t('components.editorPanel.zoomOut')"
          @click="setScale(scale - SCALE_STEP)"
        ><PhMinus :size="18" /></button>
        <button
          type="button"
          class="pdf-zoom-level tooltip"
          :disabled="loading"
          :aria-label="t('components.editorPanel.resetPdfZoom')"
          :data-tooltip="t('components.editorPanel.resetPdfZoom')"
          @click="setScale(1)"
        >
          {{ Math.round(scale * 100) }}%
        </button>
        <button
          type="button"
          class="tooltip"
          :disabled="loading || scale >= MAX_SCALE"
          :aria-label="t('components.editorPanel.zoomIn')"
          :data-tooltip="t('components.editorPanel.zoomIn')"
          @click="setScale(scale + SCALE_STEP)"
        ><PhPlus :size="18" /></button>
      </div>
    </div>
    <div class="pdf-viewport">
      <div v-if="loading" class="pdf-message" role="status">{{ t('components.editorPanel.loadingPdf') }}</div>
      <div v-else-if="error" class="pdf-message pdf-error" role="alert">{{ error }}</div>
      <div v-show="!loading && !error" class="pdf-page">
        <canvas ref="canvasEl" />
        <canvas
          ref="annotationCanvasEl"
          class="pdf-annotation-canvas"
          :class="{ enabled: tool !== 'pan' }"
          @pointerdown="startAnnotation"
          @pointermove="continueAnnotation"
          @pointerup="finishAnnotation"
          @pointercancel="finishAnnotation"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import {
  PhArrowClockwise,
  PhArrowCounterClockwise,
  PhCaretLeft,
  PhCaretRight,
  PhEraser,
  PhMinus,
  PhPencilSimple,
  PhPlus,
  PhTrash,
} from '@phosphor-icons/vue';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { i18n } from '../i18n';

interface AnnotationPoint { x: number; y: number }
interface AnnotationStroke { color: string; width: number; points: AnnotationPoint[] }
interface AnnotationDocument { version: 1; pages: Record<string, AnnotationStroke[]> }
type AnnotationTool = 'pan' | 'pen' | 'eraser';

const props = defineProps<{ src: string; filePath: string }>();
const t = i18n.global.t;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

const canvasEl = ref<HTMLCanvasElement>();
const annotationCanvasEl = ref<HTMLCanvasElement>();
const pageNumber = ref(1);
const pageCount = ref(0);
const scale = ref(1);
const loading = ref(true);
const error = ref('');
const tool = ref<AnnotationTool>('pan');
const penColor = ref('#ef4444');
const penWidth = ref(3);
const annotations = ref<AnnotationDocument>({ version: 1, pages: {} });
const undoStack = ref<AnnotationDocument[]>([]);
const redoStack = ref<AnnotationDocument[]>([]);
const saveState = ref<'saving' | 'saved' | 'error' | ''>('');
const saveStateLabel = computed(() => {
  switch (saveState.value) {
    case 'saving': return t('components.editorPanel.savingPdfAnnotations');
    case 'saved': return t('components.editorPanel.pdfAnnotationsSaved');
    case 'error': return t('components.editorPanel.pdfAnnotationsSaveFailed');
    default: return '';
  }
});
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
const currentPageStrokes = computed(() => annotations.value.pages[String(pageNumber.value)] || []);
let document: PDFDocumentProxy | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
let renderTask: RenderTask | undefined;
let activePointer: number | undefined;
let annotationChanged = false;
let loadVersion = 0;
let saveVersion = 0;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function cloneAnnotations(value = annotations.value): AnnotationDocument {
  return JSON.parse(JSON.stringify(value)) as AnnotationDocument;
}

function annotationFilePath(): string {
  const separatorIndex = Math.max(props.filePath.lastIndexOf('/'), props.filePath.lastIndexOf('\\'));
  const directory = props.filePath.slice(0, separatorIndex + 1);
  const filename = props.filePath.slice(separatorIndex + 1);
  return `${directory}.${filename}.annotations.json`;
}

function legacyAnnotationFilePath(): string {
  return `${props.filePath}.annotations.json`;
}

function setScale(value: number): void {
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function drawAnnotations(): void {
  const canvas = annotationCanvasEl.value;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of currentPageStrokes.value) {
    if (!stroke.points.length) continue;
    context.beginPath();
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width * scale.value * (window.devicePixelRatio || 1);
    context.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * canvas.width, point.y * canvas.height);
    context.stroke();
  }
}

async function renderPage(): Promise<void> {
  const pdf = document;
  const canvas = canvasEl.value;
  const annotationCanvas = annotationCanvasEl.value;
  if (!pdf || !canvas || !annotationCanvas) return;

  renderTask?.cancel();
  const page = await pdf.getPage(pageNumber.value);
  const viewport = page.getViewport({ scale: scale.value });
  const pixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('components.editorPanel.pdfRenderFailed'));

  canvas.width = annotationCanvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = annotationCanvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = annotationCanvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = annotationCanvas.style.height = `${Math.floor(viewport.height)}px`;

  renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  });
  try {
    await renderTask.promise;
    drawAnnotations();
  } catch (renderError) {
    if ((renderError as Error).name !== 'RenderingCancelledException') throw renderError;
  }
}

async function loadAnnotations(version: number): Promise<void> {
  annotations.value = { version: 1, pages: {} };
  undoStack.value = [];
  redoStack.value = [];
  try {
    for (const filePath of [annotationFilePath(), legacyAnnotationFilePath()]) {
      const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (version !== loadVersion) return;
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content?: string };
      const parsed = JSON.parse(data.content || '') as AnnotationDocument;
      if (parsed.version === 1 && parsed.pages && typeof parsed.pages === 'object') annotations.value = parsed;
      return;
    }
  } catch (loadError) {
    if (version === loadVersion) console.error('Failed to load PDF annotations:', loadError);
  }
}

async function loadPdf(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  renderTask?.cancel();
  const previousLoadingTask = loadingTask;
  loadingTask = undefined;
  await previousLoadingTask?.destroy();
  document = undefined;

  try {
    const annotationPromise = loadAnnotations(version);
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({ url: props.src });
    loadingTask = task;
    const loadedDocument = await task.promise;
    await annotationPromise;
    if (version !== loadVersion) {
      await task.destroy();
      return;
    }

    document = loadedDocument;
    pageCount.value = loadedDocument.numPages;
    pageNumber.value = 1;
    scale.value = 1;
    loading.value = false;
    await nextTick();
    await renderPage();
  } catch (loadError) {
    if (version !== loadVersion) return;
    console.error('Failed to load PDF:', loadError);
    loading.value = false;
    error.value = t('components.editorPanel.pdfLoadFailed');
  }
}

function pointFromEvent(event: PointerEvent): AnnotationPoint | undefined {
  const canvas = annotationCanvasEl.value;
  if (!canvas) return undefined;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function checkpoint(): void {
  undoStack.value.push(cloneAnnotations());
  redoStack.value = [];
}

function eraseAt(point: AnnotationPoint): void {
  const canvas = annotationCanvasEl.value;
  if (!canvas) return;
  const threshold = 12 * (window.devicePixelRatio || 1);
  const strokes = currentPageStrokes.value;
  const remaining = strokes.filter(stroke => !stroke.points.some(strokePoint => (
    Math.hypot((strokePoint.x - point.x) * canvas.width, (strokePoint.y - point.y) * canvas.height) <= threshold
  )));
  if (remaining.length !== strokes.length) {
    annotations.value.pages[String(pageNumber.value)] = remaining;
    annotationChanged = true;
    drawAnnotations();
  }
}

function startAnnotation(event: PointerEvent): void {
  if (tool.value === 'pan' || activePointer !== undefined) return;
  const point = pointFromEvent(event);
  if (!point) return;
  activePointer = event.pointerId;
  annotationChanged = false;
  annotationCanvasEl.value?.setPointerCapture(event.pointerId);
  checkpoint();
  if (tool.value === 'pen') {
    const page = String(pageNumber.value);
    annotations.value.pages[page] ||= [];
    annotations.value.pages[page].push({ color: penColor.value, width: penWidth.value, points: [point] });
    annotationChanged = true;
    drawAnnotations();
  } else {
    eraseAt(point);
  }
}

function continueAnnotation(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  const point = pointFromEvent(event);
  if (!point) return;
  if (tool.value === 'pen') {
    currentPageStrokes.value.at(-1)?.points.push(point);
    annotationChanged = true;
    drawAnnotations();
  } else if (tool.value === 'eraser') {
    eraseAt(point);
  }
}

function finishAnnotation(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  activePointer = undefined;
  if (!annotationChanged) undoStack.value.pop();
  else void saveAnnotations();
}

async function saveAnnotations(): Promise<void> {
  const version = ++saveVersion;
  saveState.value = 'saving';
  try {
    const response = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: annotationFilePath(),
        content: JSON.stringify(annotations.value, null, 2),
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (version === saveVersion) saveState.value = 'saved';
  } catch (saveError) {
    console.error('Failed to save PDF annotations:', saveError);
    if (version === saveVersion) saveState.value = 'error';
  }
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { saveState.value = ''; }, 2000);
}

function undo(): void {
  const previous = undoStack.value.pop();
  if (!previous) return;
  redoStack.value.push(cloneAnnotations());
  annotations.value = previous;
  drawAnnotations();
  void saveAnnotations();
}

function redo(): void {
  const next = redoStack.value.pop();
  if (!next) return;
  undoStack.value.push(cloneAnnotations());
  annotations.value = next;
  drawAnnotations();
  void saveAnnotations();
}

function clearPage(): void {
  if (!currentPageStrokes.value.length) return;
  checkpoint();
  annotations.value.pages[String(pageNumber.value)] = [];
  drawAnnotations();
  void saveAnnotations();
}

watch([() => props.src, () => props.filePath], () => void loadPdf(), { immediate: true });
watch([pageNumber, scale], () => {
  if (!loading.value && !error.value) void renderPage().catch((renderError) => {
    console.error('Failed to render PDF:', renderError);
    error.value = t('components.editorPanel.pdfRenderFailed');
  });
});

onUnmounted(() => {
  loadVersion++;
  clearTimeout(statusTimer);
  renderTask?.cancel();
  void loadingTask?.destroy();
});
</script>

<style scoped>
.pdf-preview {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: var(--bg-primary);
}

.pdf-toolbar {
  position: absolute;
  z-index: 2;
  top: 0.75rem;
  left: 50%;
  display: flex;
  max-width: calc(100% - 1.5rem);
  align-items: center;
  transform: translateX(-50%);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
}

.pdf-toolbar-group {
  display: flex;
  min-width: 0;
  align-items: center;
}

.pdf-toolbar-group + .pdf-toolbar-group { border-left: 1px solid var(--border-color); }

.pdf-toolbar button {
  display: inline-flex;
  height: 34px;
  min-width: 36px;
  padding: 0 0.55rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
}

.pdf-toolbar button:hover:not(:disabled),
.pdf-toolbar button.active { background: var(--bg-hover); }

.pdf-toolbar button:disabled { opacity: 0.45; }

.pdf-page-status {
  min-width: 6rem;
  padding: 0 0.65rem;
  text-align: center;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.pdf-zoom-level { min-width: 58px !important; }

.pdf-control-label,
.pdf-width-control {
  display: inline-flex;
  height: 34px;
  align-items: center;
}

.pdf-control-label input[type='color'] {
  width: 36px;
  height: 34px;
  padding: 5px;
  border: 0;
  background: transparent;
}

.pdf-width-control input[type='range'] { width: 72px; margin: 0 0.5rem; }

.tooltip { position: relative; }

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  z-index: 100;
  padding: 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-elevated, var(--bg-secondary));
  box-shadow: 0 4px 12px rgb(0 0 0 / 30%);
  color: var(--text-primary);
  font-size: 0.75rem;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition: opacity 0.15s ease-out;
  white-space: nowrap;
}

.tooltip:hover::after,
.tooltip:focus-visible::after,
.tooltip:focus-within::after { opacity: 1; }

.pdf-annotation-status {
  display: inline-flex;
  width: 28px;
  height: 30px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.pdf-annotation-status.is-idle { visibility: hidden; }
.pdf-annotation-status.is-saved { opacity: 0.55; }
.pdf-annotation-status.is-error { color: var(--error-color, #ef4444); font-weight: 700; }

.pdf-save-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: pdf-save-spin 0.8s linear infinite;
}

@keyframes pdf-save-spin { to { transform: rotate(360deg); } }

.pdf-viewport {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 4rem 1rem 1rem;
  text-align: center;
}

.pdf-page {
  position: relative;
  display: inline-block;
  line-height: 0;
  background: white;
  box-shadow: 0 2px 12px rgb(0 0 0 / 25%);
}

.pdf-page canvas { display: block; }

.pdf-annotation-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pdf-annotation-canvas.enabled {
  cursor: crosshair;
  pointer-events: auto;
  touch-action: none;
}

.pdf-message { margin-top: 2rem; color: var(--text-secondary); }
.pdf-error { color: var(--error-color, #ef4444); }
</style>
