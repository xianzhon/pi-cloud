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
          @click="toggleTool('pen')"
        ><PhPencilSimple :size="19" /></button>
        <button
          type="button"
          class="tooltip"
          :class="{ active: tool === 'highlighter' }"
          :aria-pressed="tool === 'highlighter'"
          :aria-label="t('components.editorPanel.pdfHighlighter')"
          :data-tooltip="t('components.editorPanel.pdfHighlighter')"
          @click="toggleTool('highlighter')"
        ><PhHighlighter :size="19" /></button>
        <button
          v-for="shapeTool in shapeTools"
          :key="shapeTool.name"
          type="button"
          class="tooltip"
          :class="{ active: tool === shapeTool.name }"
          :aria-pressed="tool === shapeTool.name"
          :aria-label="t(shapeTool.label)"
          :data-tooltip="t(shapeTool.label)"
          @click="toggleTool(shapeTool.name)"
        ><component
          :is="shapeTool.icon"
          :size="19"
          :class="{ 'pdf-line-icon': shapeTool.name === 'line' }"
        /></button>
        <button
          type="button"
          class="tooltip"
          :class="{ active: tool === 'move' }"
          :aria-pressed="tool === 'move'"
          :aria-label="t('components.editorPanel.pdfMoveAnnotation')"
          :data-tooltip="t('components.editorPanel.pdfMoveAnnotation')"
          @click="toggleTool('move')"
        ><PhArrowsOutCardinal :size="19" /></button>
        <button
          type="button"
          class="tooltip"
          :class="{ active: tool === 'eraser' }"
          :aria-pressed="tool === 'eraser'"
          :aria-label="t('components.editorPanel.pdfEraser')"
          :data-tooltip="t('components.editorPanel.pdfEraser')"
          @click="toggleTool('eraser')"
        ><PhEraser :size="19" /></button>
        <label class="pdf-control-label tooltip" :data-tooltip="t('components.editorPanel.pdfPenColor')">
          <input v-model="penColor" type="color" :aria-label="t('components.editorPanel.pdfPenColor')">
        </label>
        <label
          class="pdf-width-control tooltip"
          :data-tooltip="`${t('components.editorPanel.pdfPenWidth')}: ${penWidth}`"
        >
          <input
            v-model.number="penWidth"
            type="range"
            min="1"
            max="12"
            :style="{ '--pdf-pen-width-progress': `${((penWidth - 1) / 11) * 100}%` }"
            :aria-label="t('components.editorPanel.pdfPenWidth')"
          >
          <output class="pdf-width-value" aria-live="polite">{{ penWidth }}</output>
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
          @click="goToPage(pageNumber - 1)"
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
          @click="goToPage(pageNumber + 1)"
        ><PhCaretRight :size="18" weight="bold" /></button>
        <button
          type="button"
          class="tooltip"
          :class="{ active: viewMode === 'continuous' }"
          :aria-pressed="viewMode === 'continuous'"
          :aria-label="viewMode === 'continuous' ? t('components.editorPanel.pdfSinglePage') : t('components.editorPanel.pdfContinuous')"
          :data-tooltip="viewMode === 'continuous' ? t('components.editorPanel.pdfSinglePage') : t('components.editorPanel.pdfContinuous')"
          @click="toggleViewMode"
        ><PhRows :size="18" /></button>
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
    <div
      ref="viewportEl"
      class="pdf-viewport"
      :class="{ pannable: tool === 'pan', panning: isPanning }"
      @pointerdown="startPan"
      @pointermove="continuePan"
      @pointerup="finishPan"
      @pointercancel="finishPan"
      @scroll="handleViewportScroll"
    >
      <div v-if="loading" class="pdf-message" role="status">{{ t('components.editorPanel.loadingPdf') }}</div>
      <div v-else-if="error" class="pdf-message pdf-error" role="alert">{{ error }}</div>
      <div v-show="!loading && !error" class="pdf-pages" :class="{ continuous: viewMode === 'continuous' }">
        <div
          v-for="page in pagesToDisplay"
          :key="page"
          :ref="element => setPageElement(page, element)"
          class="pdf-page"
          :data-page="page"
        >
          <canvas :ref="element => setCanvasElement(page, element, false)" />
          <canvas
            :ref="element => setCanvasElement(page, element, true)"
            class="pdf-annotation-canvas"
            :class="{ enabled: tool !== 'pan', erasing: tool === 'eraser', moving: tool === 'move' }"
            @pointerdown="startAnnotation($event, page)"
            @pointermove="continueAnnotation"
            @pointerup="finishAnnotation"
            @pointercancel="finishAnnotation($event, true)"
          />
          <textarea
            v-if="textEditor?.page === String(page)"
            :ref="setTextEditorElement"
            v-model="textEditor.text"
            class="pdf-text-editor"
            :aria-label="t('components.editorPanel.pdfTextPrompt')"
            :placeholder="t('components.editorPanel.pdfTextPrompt')"
            :style="textEditorStyle"
            @pointerdown.stop
            @keydown="handleTextEditorKeydown"
            @blur="commitTextAnnotation"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import {
  PhArrowClockwise,
  PhArrowCounterClockwise,
  PhArrowUpRight,
  PhArrowsOutCardinal,
  PhCaretLeft,
  PhCaretRight,
  PhCircle,
  PhEraser,
  PhHighlighter,
  PhMinus,
  PhPencilSimple,
  PhPlus,
  PhRectangle,
  PhRows,
  PhTextT,
  PhTrash,
} from '@phosphor-icons/vue';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { i18n } from '../i18n';

interface AnnotationPoint { x: number; y: number }
type DrawingTool = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text';
interface AnnotationStroke {
  type?: DrawingTool;
  color: string;
  width: number;
  points: AnnotationPoint[];
  text?: string;
}
interface AnnotationDocument { version: 1; pages: Record<string, AnnotationStroke[]> }
interface TextEditorState { page: string; point: AnnotationPoint; index?: number; text: string; color: string }
type AnnotationTool = 'pan' | DrawingTool | 'move' | 'eraser';

const props = defineProps<{ src: string; filePath: string }>();
const t = i18n.global.t;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const shapeTools: Array<{ name: DrawingTool; label: string; icon: object }> = [
  { name: 'line', label: 'components.editorPanel.pdfLine', icon: PhMinus },
  { name: 'arrow', label: 'components.editorPanel.pdfArrow', icon: PhArrowUpRight },
  { name: 'rectangle', label: 'components.editorPanel.pdfRectangle', icon: PhRectangle },
  { name: 'ellipse', label: 'components.editorPanel.pdfEllipse', icon: PhCircle },
  { name: 'text', label: 'components.editorPanel.pdfText', icon: PhTextT },
];

const viewportEl = ref<HTMLDivElement>();
const pageElements = new Map<number, HTMLElement>();
const canvasElements = new Map<number, HTMLCanvasElement>();
const annotationCanvasElements = new Map<number, HTMLCanvasElement>();
const textEditorEl = ref<HTMLTextAreaElement>();
const pageNumber = ref(1);
const pageCount = ref(0);
const scale = ref(1);
const viewMode = ref<'single' | 'continuous'>('single');
const loading = ref(true);
const error = ref('');
const tool = ref<AnnotationTool>('pan');
const penColor = ref('#ef4444');
const penWidth = ref(1);
const annotations = ref<AnnotationDocument>({ version: 1, pages: {} });
const undoStack = ref<AnnotationDocument[]>([]);
const redoStack = ref<AnnotationDocument[]>([]);
const saveState = ref<'saving' | 'saved' | 'error' | ''>('');
const isPanning = ref(false);
const textEditor = ref<TextEditorState>();
const textEditorStyle = computed(() => {
  const editor = textEditor.value;
  if (!editor) return undefined;
  const lines = editor.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  return {
    left: `${editor.point.x * 100}%`,
    top: `${editor.point.y * 100}%`,
    width: `${Math.max(12, longestLine + 2)}ch`,
    maxWidth: `${(1 - editor.point.x) * 100}%`,
    height: `${lines.length * 1.25 + 0.25}em`,
    color: editor.color,
    fontSize: `${16 * scale.value}px`,
  };
});
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
const pagesToDisplay = computed(() => viewMode.value === 'continuous'
  ? Array.from({ length: pageCount.value }, (_, index) => index + 1)
  : [pageNumber.value]);
let document: PDFDocumentProxy | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
const renderTasks = new Map<number, RenderTask>();
let activePointer: number | undefined;
let panStart: { pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | undefined;
let moveStart: { index: number; point: AnnotationPoint; points: AnnotationPoint[] } | undefined;
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

function setPageElement(page: number, element: unknown): void {
  if (element instanceof HTMLElement) pageElements.set(page, element);
  else pageElements.delete(page);
}

function setCanvasElement(page: number, element: unknown, annotation: boolean): void {
  const elements = annotation ? annotationCanvasElements : canvasElements;
  if (element instanceof HTMLCanvasElement) elements.set(page, element);
  else elements.delete(page);
}

function setTextEditorElement(element: unknown): void {
  textEditorEl.value = element instanceof HTMLTextAreaElement ? element : undefined;
}

function setScale(value: number): void {
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

async function goToPage(page: number): Promise<void> {
  pageNumber.value = Math.min(pageCount.value, Math.max(1, page));
  if (viewMode.value === 'continuous') {
    await nextTick();
    pageElements.get(pageNumber.value)?.scrollIntoView({ block: 'start' });
  }
}

function toggleViewMode(): void {
  viewMode.value = viewMode.value === 'single' ? 'continuous' : 'single';
}

function handleViewportScroll(): void {
  if (viewMode.value !== 'continuous' || isPanning.value) return;
  const viewportTop = viewportEl.value?.getBoundingClientRect().top || 0;
  let closestPage = pageNumber.value;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const [page, element] of pageElements) {
    const distance = Math.abs(element.getBoundingClientRect().top - viewportTop - 64);
    if (distance < closestDistance) {
      closestPage = page;
      closestDistance = distance;
    }
  }
  pageNumber.value = closestPage;
}

function toggleTool(nextTool: AnnotationTool): void {
  tool.value = tool.value === nextTool ? 'pan' : nextTool;
}

function drawAnnotations(pageNumberToDraw = pageNumber.value): void {
  const canvas = annotationCanvasElements.get(pageNumberToDraw);
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const strokes = annotations.value.pages[String(pageNumberToDraw)] || [];
  strokes.forEach((stroke, index) => {
    if (textEditor.value?.page === String(pageNumberToDraw) && textEditor.value.index === index) return;
    drawAnnotation(context, canvas, stroke);
  });
}

function drawVisibleAnnotations(): void {
  pagesToDisplay.value.forEach(page => drawAnnotations(page));
}

function drawAnnotation(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, stroke: AnnotationStroke): void {
  if (!stroke.points.length) return;
  const type = stroke.type || 'pen';
  const ratio = window.devicePixelRatio || 1;
  const start = stroke.points[0];
  const end = stroke.points.at(-1) || start;
  const startX = start.x * canvas.width;
  const startY = start.y * canvas.height;
  const endX = end.x * canvas.width;
  const endY = end.y * canvas.height;

  context.save();
  context.beginPath();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width * scale.value * ratio;
  if (type === 'highlighter') {
    context.globalAlpha = 0.35;
    context.lineWidth = Math.max(12, stroke.width * 4) * scale.value * ratio;
  }

  if (type === 'pen' || type === 'highlighter') {
    context.moveTo(startX, startY);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * canvas.width, point.y * canvas.height);
  } else if (type === 'line' || type === 'arrow') {
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    if (type === 'arrow') drawArrowHead(context, startX, startY, endX, endY);
  } else if (type === 'rectangle') {
    context.rect(startX, startY, endX - startX, endY - startY);
  } else if (type === 'ellipse') {
    const radiusX = Math.abs(endX - startX) / 2;
    const radiusY = Math.abs(endY - startY) / 2;
    if (!radiusX || !radiusY) {
      context.restore();
      return;
    }
    context.ellipse((startX + endX) / 2, (startY + endY) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
  } else if (type === 'text') {
    const fontSize = 16 * scale.value * ratio;
    context.font = `${fontSize}px sans-serif`;
    context.textBaseline = 'top';
    for (const [index, line] of (stroke.text || '').split('\n').entries()) {
      context.fillText(line, startX, startY + index * fontSize * 1.25);
    }
    context.restore();
    return;
  }
  context.stroke();
  context.restore();
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  const angle = Math.atan2(endY - startY, endX - startX);
  const size = Math.max(10, context.lineWidth * 4);
  context.moveTo(endX, endY);
  context.lineTo(endX - size * Math.cos(angle - Math.PI / 6), endY - size * Math.sin(angle - Math.PI / 6));
  context.moveTo(endX, endY);
  context.lineTo(endX - size * Math.cos(angle + Math.PI / 6), endY - size * Math.sin(angle + Math.PI / 6));
}

async function renderPage(pageNumberToRender: number): Promise<void> {
  const pdf = document;
  const canvas = canvasElements.get(pageNumberToRender);
  const annotationCanvas = annotationCanvasElements.get(pageNumberToRender);
  if (!pdf || !canvas || !annotationCanvas) return;

  renderTasks.get(pageNumberToRender)?.cancel();
  const page = await pdf.getPage(pageNumberToRender);
  const viewport = page.getViewport({ scale: scale.value });
  const pixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('components.editorPanel.pdfRenderFailed'));

  canvas.width = annotationCanvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = annotationCanvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = annotationCanvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = annotationCanvas.style.height = `${Math.floor(viewport.height)}px`;

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  });
  renderTasks.set(pageNumberToRender, renderTask);
  try {
    await renderTask.promise;
    drawAnnotations(pageNumberToRender);
  } catch (renderError) {
    if ((renderError as Error).name !== 'RenderingCancelledException') throw renderError;
  } finally {
    if (renderTasks.get(pageNumberToRender) === renderTask) renderTasks.delete(pageNumberToRender);
  }
}

async function renderVisiblePages(): Promise<void> {
  await nextTick();
  await Promise.all(pagesToDisplay.value.map(page => renderPage(page)));
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
  renderTasks.forEach(task => task.cancel());
  renderTasks.clear();
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
    await renderVisiblePages();
  } catch (loadError) {
    if (version !== loadVersion) return;
    console.error('Failed to load PDF:', loadError);
    loading.value = false;
    error.value = t('components.editorPanel.pdfLoadFailed');
  }
}

function startPan(event: PointerEvent): void {
  const viewport = viewportEl.value;
  if (tool.value !== 'pan' || event.button !== 0 || !viewport) return;
  panStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
  };
  isPanning.value = true;
  viewport.setPointerCapture?.(event.pointerId);
}

function continuePan(event: PointerEvent): void {
  const viewport = viewportEl.value;
  if (!viewport || panStart?.pointerId !== event.pointerId) return;
  viewport.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.x);
  viewport.scrollTop = panStart.scrollTop - (event.clientY - panStart.y);
}

function finishPan(event: PointerEvent): void {
  const viewport = viewportEl.value;
  if (panStart?.pointerId !== event.pointerId) return;
  viewport?.releasePointerCapture?.(event.pointerId);
  panStart = undefined;
  isPanning.value = false;
}

function pointFromEvent(event: PointerEvent): AnnotationPoint | undefined {
  const canvas = event.currentTarget instanceof HTMLCanvasElement
    ? event.currentTarget
    : annotationCanvasElements.get(pageNumber.value);
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
  const canvas = annotationCanvasElements.get(pageNumber.value);
  if (!canvas) return;
  const strokes = currentPageStrokes.value;
  const remaining = strokes.filter(stroke => !annotationContainsPoint(stroke, point, canvas));
  if (remaining.length !== strokes.length) {
    annotations.value.pages[String(pageNumber.value)] = remaining;
    annotationChanged = true;
    drawAnnotations();
  }
}

function annotationContainsPoint(stroke: AnnotationStroke, point: AnnotationPoint, canvas: HTMLCanvasElement): boolean {
  if (!stroke.points.length) return false;
  const threshold = 12 * (window.devicePixelRatio || 1);
  const target = { x: point.x * canvas.width, y: point.y * canvas.height };
  const points = stroke.points.map(item => ({ x: item.x * canvas.width, y: item.y * canvas.height }));
  const type = stroke.type || 'pen';

  if (type === 'rectangle' || type === 'ellipse' || type === 'text') {
    const start = points[0];
    const end = points.at(-1) || start;
    const textScale = scale.value * (window.devicePixelRatio || 1);
    const textLines = (stroke.text || '').split('\n');
    const longestLine = Math.max(...textLines.map(line => line.length), 1);
    const textWidth = type === 'text' ? longestLine * 10 * textScale : 0;
    const textHeight = type === 'text' ? textLines.length * 20 * textScale : 0;
    return target.x >= Math.min(start.x, end.x) - threshold
      && target.x <= Math.max(start.x, end.x + textWidth) + threshold
      && target.y >= Math.min(start.y, end.y) - threshold
      && target.y <= Math.max(start.y, end.y + textHeight) + threshold;
  }

  if (points.length === 1) return Math.hypot(target.x - points[0].x, target.y - points[0].y) <= threshold;
  return points.slice(1).some((end, index) => distanceToSegment(target, points[index], end) <= threshold);
}

function distanceToSegment(point: AnnotationPoint, start: AnnotationPoint, end: AnnotationPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const dotProduct = (point.x - start.x) * dx + (point.y - start.y) * dy;
  const position = Math.max(0, Math.min(1, dotProduct / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + position * dx), point.y - (start.y + position * dy));
}

function startAnnotation(event: PointerEvent, page: number): void {
  if (tool.value === 'pan' || activePointer !== undefined || event.button !== 0) return;
  pageNumber.value = page;
  const point = pointFromEvent(event);
  if (!point) return;

  // Wait for pointerup before inserting the text field so the browser can
  // complete the canvas pointer sequence before focus moves to the editor.
  if (tool.value === 'text') return;

  if (tool.value === 'move') {
    const canvas = annotationCanvasElements.get(pageNumber.value);
    if (!canvas) return;
    const strokes = currentPageStrokes.value;
    let index = -1;
    for (let candidate = strokes.length - 1; candidate >= 0; candidate--) {
      if (annotationContainsPoint(strokes[candidate], point, canvas)) {
        index = candidate;
        break;
      }
    }
    if (index < 0) return;
    moveStart = {
      index,
      point,
      points: strokes[index].points.map(item => ({ ...item })),
    };
  }

  activePointer = event.pointerId;
  annotationChanged = false;
  annotationCanvasElements.get(pageNumber.value)?.setPointerCapture(event.pointerId);
  checkpoint();
  if (tool.value === 'move') return;
  if (tool.value === 'eraser') {
    eraseAt(point);
    return;
  }

  addAnnotation({ type: tool.value, color: penColor.value, width: penWidth.value, points: [point] });
  if (tool.value === 'pen' || tool.value === 'highlighter') annotationChanged = true;
  drawAnnotations();
}

function startTextAnnotation(point: AnnotationPoint): void {
  commitTextAnnotation();
  const page = String(pageNumber.value);
  const strokes = currentPageStrokes.value;
  const canvas = annotationCanvasElements.get(pageNumber.value);
  let index = -1;
  if (canvas) {
    for (let candidate = strokes.length - 1; candidate >= 0; candidate--) {
      const stroke = strokes[candidate];
      if (stroke.type === 'text' && annotationContainsPoint(stroke, point, canvas)) {
        index = candidate;
        break;
      }
    }
  }
  const existing = index >= 0 ? strokes[index] : undefined;
  textEditor.value = {
    page,
    point: existing?.points[0] || point,
    index: existing ? index : undefined,
    text: existing?.text || '',
    color: existing?.color || penColor.value,
  };
  drawAnnotations();
  void nextTick(() => {
    textEditorEl.value?.focus();
    textEditorEl.value?.select();
  });
}

function commitTextAnnotation(): void {
  const editor = textEditor.value;
  if (!editor) return;
  const text = editor.text.trim();
  const strokes = annotations.value.pages[editor.page] || [];
  textEditor.value = undefined;

  if (editor.index === undefined) {
    if (!text) return;
    checkpoint();
    annotations.value.pages[editor.page] ||= [];
    annotations.value.pages[editor.page].push({
      type: 'text', color: editor.color, width: penWidth.value, points: [editor.point], text,
    });
  } else {
    const annotation = strokes[editor.index];
    if (!annotation || annotation.text === text) {
      drawAnnotations(Number(editor.page));
      return;
    }
    checkpoint();
    if (text) annotation.text = text;
    else strokes.splice(editor.index, 1);
  }
  drawAnnotations(Number(editor.page));
  void saveAnnotations();
}

function cancelTextAnnotation(): void {
  const editor = textEditor.value;
  if (!editor) return;
  textEditor.value = undefined;
  drawAnnotations(Number(editor.page));
}

function handleTextEditorKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    commitTextAnnotation();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelTextAnnotation();
  }
}

function addAnnotation(annotation: AnnotationStroke): void {
  const page = String(pageNumber.value);
  annotations.value.pages[page] ||= [];
  annotations.value.pages[page].push(annotation);
}

function continueAnnotation(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  const point = pointFromEvent(event);
  if (!point) return;
  if (tool.value === 'move' && moveStart) {
    const stroke = currentPageStrokes.value[moveStart.index];
    if (!stroke) return;
    const minX = Math.min(...moveStart.points.map(item => item.x));
    const maxX = Math.max(...moveStart.points.map(item => item.x));
    const minY = Math.min(...moveStart.points.map(item => item.y));
    const maxY = Math.max(...moveStart.points.map(item => item.y));
    const deltaX = Math.max(-minX, Math.min(1 - maxX, point.x - moveStart.point.x));
    const deltaY = Math.max(-minY, Math.min(1 - maxY, point.y - moveStart.point.y));
    stroke.points = moveStart.points.map(item => ({ x: item.x + deltaX, y: item.y + deltaY }));
    annotationChanged = deltaX !== 0 || deltaY !== 0;
  } else if (tool.value === 'pen' || tool.value === 'highlighter') {
    currentPageStrokes.value.at(-1)?.points.push(point);
    annotationChanged = true;
  } else if (tool.value === 'eraser') {
    eraseAt(point);
    return;
  } else {
    const points = currentPageStrokes.value.at(-1)?.points;
    if (points) points[1] = point;
    annotationChanged = true;
  }
  drawAnnotations();
}

function finishAnnotation(event: PointerEvent, cancelled = false): void {
  if (tool.value === 'text' && activePointer === undefined) {
    if (!cancelled) {
      const point = pointFromEvent(event);
      if (point) startTextAnnotation(point);
    }
    return;
  }
  if (event.pointerId !== activePointer) return;
  activePointer = undefined;
  moveStart = undefined;
  if (!annotationChanged) {
    undoStack.value.pop();
    if (tool.value !== 'eraser' && tool.value !== 'move') currentPageStrokes.value.pop();
    drawAnnotations();
  } else {
    void saveAnnotations();
  }
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
  drawVisibleAnnotations();
  void saveAnnotations();
}

function redo(): void {
  const next = redoStack.value.pop();
  if (!next) return;
  undoStack.value.push(cloneAnnotations());
  annotations.value = next;
  drawVisibleAnnotations();
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
function rerenderVisiblePages(): void {
  if (!loading.value && !error.value) void renderVisiblePages().catch((renderError) => {
    console.error('Failed to render PDF:', renderError);
    error.value = t('components.editorPanel.pdfRenderFailed');
  });
}

watch(pageNumber, () => {
  if (viewMode.value === 'single') rerenderVisiblePages();
});
watch([scale, viewMode], rerenderVisiblePages);

onUnmounted(() => {
  loadVersion++;
  clearTimeout(statusTimer);
  renderTasks.forEach(task => task.cancel());
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
  overflow-x: auto;
  scrollbar-width: none;
}

.pdf-toolbar::-webkit-scrollbar { display: none; }

.pdf-toolbar-group {
  display: flex;
  flex: 0 0 auto;
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

.pdf-line-icon { transform: rotate(-45deg); }

.pdf-page-status {
  min-width: 3.5rem;
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

.pdf-width-control {
  gap: 0.3rem;
  padding: 0 0.5rem;
}

.pdf-width-control input[type='range'] {
  width: 76px;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--accent) 0 var(--pdf-pen-width-progress),
    var(--border-color) var(--pdf-pen-width-progress) 100%
  );
  cursor: pointer;
}

.pdf-width-control input[type='range']::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  appearance: none;
  border: 2px solid var(--bg-secondary);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.pdf-width-control input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 2px solid var(--bg-secondary);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.pdf-width-control input[type='range']:focus-visible { outline: 2px solid var(--accent); }

.pdf-width-value {
  min-width: 20px;
  padding: 2px 3px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-primary);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

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

.pdf-viewport.pannable {
  cursor: grab;
  touch-action: none;
}

.pdf-viewport.panning {
  cursor: grabbing;
  user-select: none;
}

.pdf-pages.continuous {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.pdf-page {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
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

.pdf-annotation-canvas.erasing {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='m4 17 10-10 6 6-8 8H8z' fill='%23fff' stroke='%231f2937' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='m11 10 6 6' stroke='%231f2937' stroke-width='1.5'/%3E%3C/svg%3E") 4 20, cell;
}

.pdf-annotation-canvas.moving { cursor: move; }

.pdf-text-editor {
  position: absolute;
  z-index: 1;
  min-width: 12rem;
  padding: 0 2px;
  border: 1px solid currentColor;
  border-radius: 2px;
  outline: none;
  background: rgb(255 255 255 / 90%);
  overflow: hidden;
  resize: none;
  font-family: sans-serif;
  line-height: 1.25;
  transform: translateY(-1px);
}

.pdf-message { margin-top: 2rem; color: var(--text-secondary); }
.pdf-error { color: var(--error-color, #ef4444); }
</style>
