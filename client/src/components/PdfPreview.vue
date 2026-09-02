<template>
  <div ref="previewEl" class="pdf-preview">
    <div
      ref="toolbarEl"
      class="pdf-toolbar"
      :class="{ vertical: toolbarVertical }"
      :style="toolbarStyle"
      role="toolbar"
      :aria-label="t('components.editorPanel.pdfAnnotationControls')"
      @mouseover="showTooltip"
      @mouseout="clearTooltip"
      @focusin="showTooltip"
      @focusout="clearTooltip"
      @click="clearTooltip"
      @scroll.capture="clearTooltip"
    >
      <div
        class="pdf-toolbar-drag-handle"
        role="button"
        tabindex="0"
        :aria-label="t('components.editorPanel.movePdfToolbar')"
        :data-tooltip="t('components.editorPanel.movePdfToolbar')"
        @pointerdown="startToolbarDrag"
        @keydown="moveToolbarWithKeyboard"
      ><PhDotsSixVertical :size="19" weight="bold" /></div>
      <div class="pdf-toolbar-group" role="group" :aria-label="t('components.editorPanel.pdfAnnotationControls')">
        <button
          type="button"
          :class="{ active: tool === 'pen' }"
          :aria-pressed="tool === 'pen'"
          :aria-label="t('components.editorPanel.pdfPen')"
          aria-keyshortcuts="1"
          :data-tooltip="t('components.editorPanel.pdfPen')"
          @click="toggleTool('pen')"
        ><PhPencilSimple :size="19" /><span class="pdf-tool-shortcut">1</span></button>
        <button
          type="button"
          :class="{ active: tool === 'highlighter' }"
          :aria-pressed="tool === 'highlighter'"
          :aria-label="t('components.editorPanel.pdfHighlighter')"
          aria-keyshortcuts="2"
          :data-tooltip="t('components.editorPanel.pdfHighlighter')"
          @click="toggleTool('highlighter')"
        ><PhHighlighter :size="19" /><span class="pdf-tool-shortcut">2</span></button>
        <button
          v-for="shapeTool in shapeTools"
          :key="shapeTool.name"
          type="button"
          :class="{ active: tool === shapeTool.name }"
          :aria-pressed="tool === shapeTool.name"
          :aria-label="t(shapeTool.label)"
          :aria-keyshortcuts="shapeTool.shortcut"
          :data-tooltip="t(shapeTool.label)"
          @click="toggleTool(shapeTool.name)"
        ><component
          :is="shapeTool.icon"
          :size="19"
          :class="{ 'pdf-line-icon': shapeTool.name === 'line' }"
        /><span class="pdf-tool-shortcut">{{ shapeTool.shortcut }}</span></button>
        <button
          type="button"
          :class="{ active: tool === 'move' }"
          :aria-pressed="tool === 'move'"
          :aria-label="t('components.editorPanel.pdfMoveAnnotation')"
          aria-keyshortcuts="8"
          :data-tooltip="t('components.editorPanel.pdfMoveAnnotation')"
          @click="toggleTool('move')"
        ><PhArrowsOutCardinal :size="19" /><span class="pdf-tool-shortcut">8</span></button>
        <button
          type="button"
          :class="{ active: tool === 'whiteout' }"
          :aria-pressed="tool === 'whiteout'"
          :aria-label="t('components.editorPanel.pdfWhiteout')"
          aria-keyshortcuts="9"
          :data-tooltip="t('components.editorPanel.pdfWhiteout')"
          @click="toggleTool('whiteout')"
        ><PhRectangle :size="19" weight="fill" /><span class="pdf-tool-shortcut">9</span></button>
        <button
          type="button"
          :class="{ active: tool === 'eraser' }"
          :aria-pressed="tool === 'eraser'"
          :aria-label="t('components.editorPanel.pdfEraser')"
          aria-keyshortcuts="0"
          :data-tooltip="t('components.editorPanel.pdfEraser')"
          @click="toggleTool('eraser')"
        ><PhEraser :size="19" /><span class="pdf-tool-shortcut">0</span></button>
        <label class="pdf-control-label" :data-tooltip="t('components.editorPanel.pdfPenColor')">
          <input v-model="penColor" type="color" :aria-label="t('components.editorPanel.pdfPenColor')">
        </label>
        <label
          class="pdf-width-control"
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
          :disabled="!canUndo"
          :aria-label="t('components.editorPanel.undoPdfAnnotation')"
          :data-tooltip="t('components.editorPanel.undoPdfAnnotation')"
          @click="undo"
        ><PhArrowCounterClockwise :size="19" /></button>
        <button
          type="button"
          :disabled="!canRedo"
          :aria-label="t('components.editorPanel.redoPdfAnnotation')"
          :data-tooltip="t('components.editorPanel.redoPdfAnnotation')"
          @click="redo"
        ><PhArrowClockwise :size="19" /></button>
        <button
          type="button"
          :disabled="!currentPageStrokes.length"
          :aria-label="t('components.editorPanel.clearPdfPageAnnotations')"
          :data-tooltip="t('components.editorPanel.clearPdfPageAnnotations')"
          @click="clearPage"
        ><PhTrash :size="19" /></button>
        <button
          type="button"
          :aria-label="t(toolbarVertical
            ? 'components.editorPanel.showPdfToolbarHorizontally'
            : 'components.editorPanel.showPdfToolbarVertically')"
          :data-tooltip="t(toolbarVertical
            ? 'components.editorPanel.showPdfToolbarHorizontally'
            : 'components.editorPanel.showPdfToolbarVertically')"
          @click="toggleToolbarOrientation"
        ><component :is="toolbarVertical ? PhRows : PhColumns" :size="19" /></button>
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
    </div>
    <div
      v-if="activeTooltip"
      class="pdf-annotation-tooltip"
      role="tooltip"
      :style="{ left: `${activeTooltip.left}px`, top: `${activeTooltip.top}px` }"
    >{{ activeTooltip.text }}</div>
    <div class="pdf-navigation-toolbar" role="toolbar" :aria-label="t('components.editorPanel.pdfControls')">
      <button
        type="button"
        :disabled="loading || pageNumber <= 1"
        :aria-label="t('components.editorPanel.previousPage')"
        @click="goToPage(pageNumber - 1)"
      ><PhCaretLeft :size="18" weight="bold" /></button>
      <span class="pdf-page-status">
        {{ t('components.editorPanel.pdfPageStatus', { page: pageNumber, pages: pageCount || 1 }) }}
      </span>
      <button
        type="button"
        :disabled="loading || pageNumber >= pageCount"
        :aria-label="t('components.editorPanel.nextPage')"
        @click="goToPage(pageNumber + 1)"
      ><PhCaretRight :size="18" weight="bold" /></button>
      <button
        v-if="outline.length"
        type="button"
        :class="{ active: showOutline }"
        :aria-pressed="showOutline"
        :aria-label="t(showOutline
          ? 'components.editorPanel.hidePdfOutline'
          : 'components.editorPanel.showPdfOutline')"
        @click="showOutline = !showOutline"
      ><PhList :size="18" /></button>
      <button
        type="button"
        :disabled="loading || scale <= MIN_SCALE"
        :aria-label="t('components.editorPanel.zoomOut')"
        @click="setScale(scale - SCALE_STEP)"
      ><PhMinus :size="18" /></button>
      <button
        type="button"
        class="pdf-zoom-level"
        :disabled="loading"
        :aria-label="t('components.editorPanel.resetPdfZoom')"
        @click="setScale(1)"
      >
        {{ Math.round(scale * 100) }}%
      </button>
      <button
        type="button"
        :disabled="loading || scale >= MAX_SCALE"
        :aria-label="t('components.editorPanel.zoomIn')"
        @click="setScale(scale + SCALE_STEP)"
      ><PhPlus :size="18" /></button>
      <label class="pdf-tone-control">
        <span class="pdf-tone-swatch" :class="`tone-${pageTone}`" aria-hidden="true" />
        <select
          v-model="pageTone"
          :disabled="loading"
          :aria-label="t('components.editorPanel.pdfPageTone')"
          @change="savePageTone"
        >
          <option v-for="option in pageToneOptions" :key="option.value" :value="option.value">
            {{ t(option.label) }}
          </option>
        </select>
      </label>
      <button
        type="button"
        :disabled="loading"
        :aria-label="t(nextFitMode === 'width'
          ? 'components.editorPanel.fitPdfToWidth'
          : 'components.editorPanel.fitPdfToHeight')"
        @click="fitPdfToViewport"
      ><component
        :is="nextFitMode === 'width' ? PhArrowsOutLineHorizontal : PhArrowsOutLineVertical"
        :size="18"
      /></button>
      <button
        type="button"
        :disabled="loading || exporting"
        :aria-label="t(exporting
          ? 'components.editorPanel.exportingAnnotatedPdf'
          : 'components.editorPanel.exportAnnotatedPdf')"
        @click="exportAnnotatedPdf"
      ><PhDownloadSimple :size="18" /></button>
      <span v-if="exportError" class="pdf-export-error" role="alert">{{ exportError }}</span>
    </div>
    <div
      ref="viewportEl"
      class="pdf-viewport"
      :class="{ pannable: tool === 'pan', panning: isPanning, 'has-outline': showOutline && outline.length }"
      @pointerdown="startPan"
      @pointermove="continuePan"
      @pointerup="finishPan"
      @pointercancel="finishPan"
      @scroll="handleViewportScroll"
      @wheel="handleZoomWheel"
    >
      <div v-if="loading" class="pdf-message" role="status">{{ t('components.editorPanel.loadingPdf') }}</div>
      <div v-else-if="error" class="pdf-message pdf-error" role="alert">{{ error }}</div>
      <div v-show="!loading && !error" class="pdf-pages continuous" :class="`tone-${pageTone}`">
        <div
          v-for="page in pagesToDisplay"
          :key="page"
          :ref="element => setPageElement(page, element)"
          class="pdf-page"
          :data-page="page"
          :style="pageStyle(page)"
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
    <nav
      v-if="showOutline && outline.length"
      class="pdf-outline"
      :aria-label="t('components.editorPanel.pdfOutline')"
    >
      <div class="pdf-outline-header">
        <div class="pdf-outline-title">{{ t('components.editorPanel.outline') }}</div>
        <button
          type="button"
          class="pdf-outline-close"
          :title="t('components.editorPanel.hidePdfOutline')"
          :aria-label="t('components.editorPanel.hidePdfOutline')"
          @click="showOutline = false"
        ><PhX :size="14" /></button>
      </div>
      <div class="pdf-outline-items">
        <button
          v-for="(item, index) in outline"
          :key="`${index}-${item.title}`"
          type="button"
          :disabled="!item.dest"
          :style="{ paddingLeft: `${0.75 + item.level * 0.75}rem` }"
          :title="item.title"
          @click="openOutlineItem(item)"
        >{{ item.title }}</button>
      </div>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  PhArrowClockwise,
  PhArrowCounterClockwise,
  PhArrowUpRight,
  PhArrowsOutCardinal,
  PhArrowsOutLineHorizontal,
  PhArrowsOutLineVertical,
  PhCaretLeft,
  PhCaretRight,
  PhCircle,
  PhColumns,
  PhDotsSixVertical,
  PhDownloadSimple,
  PhEraser,
  PhHighlighter,
  PhList,
  PhMinus,
  PhPencilSimple,
  PhPlus,
  PhRectangle,
  PhRows,
  PhTextT,
  PhTrash,
  PhX,
} from '@phosphor-icons/vue';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { i18n } from '../i18n';

interface AnnotationPoint { x: number; y: number }
type DrawingTool = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'whiteout';
interface AnnotationStroke {
  type?: DrawingTool;
  color: string;
  width: number;
  points: AnnotationPoint[];
  text?: string;
}
interface TextEditorState { page: string; point: AnnotationPoint; index?: number; text: string; color: string }
interface TooltipState { text: string; left: number; top: number }
interface ToolbarPosition { left: number; top: number }
type AnnotationTool = 'pan' | DrawingTool | 'move' | 'eraser';
type PdfFitMode = 'width' | 'height';
type PdfPageTone = 'original' | 'warm' | 'gray' | 'dark';
interface PdfViewState {
  scale?: number;
  page?: number;
  tool?: AnnotationTool;
  penColor?: string;
  penWidth?: number;
  pageTone?: PdfPageTone;
  toolbarVertical?: boolean;
  toolbarPosition?: ToolbarPosition;
}
interface AnnotationDocument { version: 1; pages: Record<string, AnnotationStroke[]>; view?: PdfViewState }
interface PdfOutlineSource {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineSource[];
}
interface PdfOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  level: number;
}

const props = defineProps<{ src: string; filePath: string; initialScale?: number }>();
const emit = defineEmits<{ 'scale-change': [scale: number] }>();
const t = i18n.global.t;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.1;
const TOOLBAR_INSET = 12;
const VIEW_SAVE_DELAY = 300;
const ZOOM_RENDER_DELAY = 120;
const MAX_CANVAS_PIXELS = 16_000_000;
const PAGE_RENDER_MARGIN = '100% 0px';
const TOOLBAR_KEYBOARD_MOVEMENT: Record<string, ToolbarPosition> = {
  ArrowLeft: { left: -10, top: 0 },
  ArrowRight: { left: 10, top: 0 },
  ArrowUp: { left: 0, top: -10 },
  ArrowDown: { left: 0, top: 10 },
};
const ANNOTATION_TOOLS = new Set<AnnotationTool>([
  'pan', 'pen', 'highlighter', 'line', 'arrow', 'rectangle', 'ellipse', 'text', 'whiteout', 'move', 'eraser',
]);
const PDF_PAGE_TONES = new Set<PdfPageTone>(['original', 'warm', 'gray', 'dark']);
const pageToneOptions: Array<{ value: PdfPageTone; label: string }> = [
  { value: 'original', label: 'components.editorPanel.pdfPageToneOriginal' },
  { value: 'warm', label: 'components.editorPanel.pdfPageToneWarm' },
  { value: 'gray', label: 'components.editorPanel.pdfPageToneGray' },
  { value: 'dark', label: 'components.editorPanel.pdfPageToneDark' },
];
const shapeTools: Array<{ name: DrawingTool; label: string; icon: object; shortcut: string }> = [
  { name: 'line', label: 'components.editorPanel.pdfLine', icon: PhMinus, shortcut: '3' },
  { name: 'arrow', label: 'components.editorPanel.pdfArrow', icon: PhArrowUpRight, shortcut: '4' },
  { name: 'rectangle', label: 'components.editorPanel.pdfRectangle', icon: PhRectangle, shortcut: '5' },
  { name: 'ellipse', label: 'components.editorPanel.pdfEllipse', icon: PhCircle, shortcut: '6' },
  { name: 'text', label: 'components.editorPanel.pdfText', icon: PhTextT, shortcut: '7' },
];
const toolShortcuts: Record<string, AnnotationTool> = {
  '0': 'eraser',
  '1': 'pen',
  '2': 'highlighter',
  '3': 'line',
  '4': 'arrow',
  '5': 'rectangle',
  '6': 'ellipse',
  '7': 'text',
  '8': 'move',
  '9': 'whiteout',
};

const previewEl = ref<HTMLDivElement>();
const toolbarEl = ref<HTMLDivElement>();
const viewportEl = ref<HTMLDivElement>();
const pageElements = new Map<number, HTMLElement>();
const canvasElements = new Map<number, HTMLCanvasElement>();
const annotationCanvasElements = new Map<number, HTMLCanvasElement>();
const textEditorEl = ref<HTMLTextAreaElement>();
const pageNumber = ref(1);
const pageCount = ref(0);
const scale = ref(1);
const nextFitMode = ref<PdfFitMode>('width');
const loading = ref(true);
const error = ref('');
const outline = ref<PdfOutlineItem[]>([]);
const showOutline = ref(true);
const tool = ref<AnnotationTool>('pan');
const penColor = ref('#ef4444');
const penWidth = ref(1);
const pageTone = ref<PdfPageTone>('original');
const annotations = ref<AnnotationDocument>({ version: 1, pages: {} });
const undoStack = ref<AnnotationDocument[]>([]);
const redoStack = ref<AnnotationDocument[]>([]);
const saveState = ref<'saving' | 'saved' | 'error' | ''>('');
const exporting = ref(false);
const exportError = ref('');
const isPanning = ref(false);
const activeTooltip = ref<TooltipState>();
const toolbarVertical = ref(false);
const toolbarPosition = ref<ToolbarPosition>();
const toolbarStyle = computed(() => toolbarPosition.value && ({
  left: `${toolbarPosition.value.left}px`,
  top: `${toolbarPosition.value.top}px`,
  transform: 'none',
}));
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
const pagesToDisplay = computed(() => Array.from({ length: pageCount.value }, (_, index) => index + 1));
const defaultPageSize = ref({ width: 612, height: 792 });
const pageSizes = ref<Record<number, { width: number; height: number }>>({});
let document: PDFDocumentProxy | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
let pageObserver: IntersectionObserver | undefined;
const visiblePages = new Set<number>();
const renderTasks = new Map<number, RenderTask>();
const renderRequests = new Map<number, number>();
let activePointer: number | undefined;
let panStart: { pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | undefined;
let moveStart: { index: number; point: AnnotationPoint; points: AnnotationPoint[]; resizeIndex?: number } | undefined;
const selectedAnnotation = ref<{ page: number; index: number }>();
let annotationChanged = false;
let loadVersion = 0;
let saveVersion = 0;
let annotationSidecarExists = false;
let loadedFilePath: string | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let viewSaveTimer: ReturnType<typeof setTimeout> | undefined;
let zoomRenderTimer: ReturnType<typeof setTimeout> | undefined;
let renderGeneration = 0;
let tooltipAnchor: HTMLElement | undefined;
let toolbarDrag: { pointerId: number; offsetX: number; offsetY: number } | undefined;

function clampToolbarPosition(left: number, top: number): ToolbarPosition {
  const previewRect = previewEl.value?.getBoundingClientRect();
  const toolbarRect = toolbarEl.value?.getBoundingClientRect();
  if (!previewRect || !toolbarRect) return { left, top };
  return {
    left: Math.max(0, Math.min(previewRect.width - toolbarRect.width, left)),
    top: Math.max(0, Math.min(previewRect.height - toolbarRect.height, top)),
  };
}

function startToolbarDrag(event: PointerEvent): void {
  if (event.button !== 0 || !previewEl.value || !toolbarEl.value) return;
  event.preventDefault();
  clearTooltip();
  const previewRect = previewEl.value.getBoundingClientRect();
  const toolbarRect = toolbarEl.value.getBoundingClientRect();
  toolbarDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - toolbarRect.left,
    offsetY: event.clientY - toolbarRect.top,
  };
  toolbarPosition.value = {
    left: toolbarRect.left - previewRect.left,
    top: toolbarRect.top - previewRect.top,
  };
  window.addEventListener('pointermove', continueToolbarDrag);
  window.addEventListener('pointerup', finishToolbarDrag);
  window.addEventListener('pointercancel', finishToolbarDrag);
}

function continueToolbarDrag(event: PointerEvent): void {
  if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId || !previewEl.value) return;
  const previewRect = previewEl.value.getBoundingClientRect();
  toolbarPosition.value = clampToolbarPosition(
    event.clientX - previewRect.left - toolbarDrag.offsetX,
    event.clientY - previewRect.top - toolbarDrag.offsetY,
  );
}

function moveToolbarWithKeyboard(event: KeyboardEvent): void {
  const delta = TOOLBAR_KEYBOARD_MOVEMENT[event.key];
  if (!delta || !previewEl.value || !toolbarEl.value) return;
  event.preventDefault();
  const previewRect = previewEl.value.getBoundingClientRect();
  const toolbarRect = toolbarEl.value.getBoundingClientRect();
  const current = toolbarPosition.value || {
    left: toolbarRect.left - previewRect.left,
    top: toolbarRect.top - previewRect.top,
  };
  toolbarPosition.value = clampToolbarPosition(current.left + delta.left, current.top + delta.top);
}

function finishToolbarDrag(event?: PointerEvent): void {
  if (event && toolbarDrag && event.pointerId !== toolbarDrag.pointerId) return;
  toolbarDrag = undefined;
  window.removeEventListener('pointermove', continueToolbarDrag);
  window.removeEventListener('pointerup', finishToolbarDrag);
  window.removeEventListener('pointercancel', finishToolbarDrag);
}

function keepToolbarInBounds(): void {
  if (toolbarPosition.value) {
    toolbarPosition.value = clampToolbarPosition(toolbarPosition.value.left, toolbarPosition.value.top);
  }
}

function toggleToolbarOrientation(): void {
  toolbarVertical.value = !toolbarVertical.value;
  clearTooltip();

  if (!toolbarVertical.value) {
    // Removing the custom position restores the default top-center placement.
    toolbarPosition.value = undefined;
    return;
  }

  void nextTick(() => {
    const previewRect = previewEl.value?.getBoundingClientRect();
    const toolbarRect = toolbarEl.value?.getBoundingClientRect();
    if (!previewRect || !toolbarRect) return;
    toolbarPosition.value = clampToolbarPosition(
      TOOLBAR_INSET,
      (previewRect.height - toolbarRect.height) / 2,
    );
  });
}

function showTooltip(event: Event): void {
  const eventTarget = event.target instanceof Element ? event.target : undefined;
  const toolbar = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  const anchor = eventTarget?.closest<HTMLElement>('[data-tooltip]');
  const preview = toolbar?.parentElement;
  if (!anchor || !toolbar?.contains(anchor) || !preview) return;

  const anchorRect = anchor.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  tooltipAnchor = anchor;
  activeTooltip.value = {
    text: anchor.dataset.tooltip || '',
    left: anchorRect.left + anchorRect.width / 2 - previewRect.left,
    top: anchorRect.bottom - previewRect.top + 6,
  };
}

function clearTooltip(event?: Event): void {
  if ((event?.type === 'mouseout' || event?.type === 'focusout') && tooltipAnchor) {
    const relatedTarget = (event as MouseEvent | FocusEvent).relatedTarget;
    const nextAnchor = relatedTarget instanceof Element
      ? relatedTarget.closest<HTMLElement>('[data-tooltip]')
      : undefined;
    if (nextAnchor === tooltipAnchor) return;
  }
  tooltipAnchor = undefined;
  activeTooltip.value = undefined;
}

function cloneAnnotations(value = annotations.value): AnnotationDocument {
  return JSON.parse(JSON.stringify(value)) as AnnotationDocument;
}

function annotationFilePath(filePath = props.filePath): string {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const directory = filePath.slice(0, separatorIndex + 1);
  const filename = filePath.slice(separatorIndex + 1);
  return `${directory}.${filename}.annotations.json`;
}

function legacyAnnotationFilePath(): string {
  return `${props.filePath}.annotations.json`;
}

function setPageElement(page: number, element: unknown): void {
  const previous = pageElements.get(page);
  if (previous) pageObserver?.unobserve(previous);
  if (element instanceof HTMLElement) {
    pageElements.set(page, element);
    pageObserver?.observe(element);
  } else {
    pageElements.delete(page);
    visiblePages.delete(page);
  }
}

function pageStyle(page: number): Record<string, string> {
  const size = pageSizes.value[page] || defaultPageSize.value;
  return {
    width: `${Math.floor(size.width * scale.value)}px`,
    height: `${Math.floor(size.height * scale.value)}px`,
  };
}

function setCanvasElement(page: number, element: unknown, annotation: boolean): void {
  const elements = annotation ? annotationCanvasElements : canvasElements;
  if (element instanceof HTMLCanvasElement) elements.set(page, element);
  else elements.delete(page);
}

function setTextEditorElement(element: unknown): void {
  textEditorEl.value = element instanceof HTMLTextAreaElement ? element : undefined;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function setScale(value: number): void {
  const nextScale = clampScale(value);
  if (nextScale === scale.value) return;
  scale.value = nextScale;
  emit('scale-change', nextScale);
}

function flattenOutline(items: PdfOutlineSource[], level = 0): PdfOutlineItem[] {
  return items.flatMap(item => [
    { title: item.title, dest: item.dest, level },
    ...flattenOutline(item.items || [], level + 1),
  ]);
}

async function openOutlineItem(item: PdfOutlineItem): Promise<void> {
  const pdf = document;
  if (!pdf || !item.dest) return;
  const destination = typeof item.dest === 'string'
    ? await pdf.getDestination(item.dest)
    : item.dest;
  if (!destination?.length) return;
  const pageIndex = typeof destination[0] === 'number'
    ? destination[0]
    : await pdf.getPageIndex(destination[0]);
  await goToPage(pageIndex + 1);
}

function fitPdfToViewport(): void {
  const viewport = viewportEl.value;
  if (!viewport) return;
  const style = window.getComputedStyle(viewport);
  const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const pageSize = pageSizes.value[pageNumber.value] || defaultPageSize.value;
  const fitMode = nextFitMode.value;
  const fittedScale = fitMode === 'width'
    ? availableWidth / pageSize.width
    : availableHeight / pageSize.height;
  setScale(fittedScale);
  nextFitMode.value = fitMode === 'width' ? 'height' : 'width';
}

function currentViewState(): PdfViewState {
  return {
    scale: scale.value,
    page: pageNumber.value,
    tool: tool.value,
    penColor: penColor.value,
    penWidth: penWidth.value,
    pageTone: pageTone.value,
    toolbarVertical: toolbarVertical.value,
    toolbarPosition: toolbarPosition.value ? { ...toolbarPosition.value } : undefined,
  };
}

function restoreViewState(view?: PdfViewState): void {
  const savedPage = typeof view?.page === 'number' && Number.isFinite(view.page) ? Math.round(view.page) : 1;
  const savedScale = typeof view?.scale === 'number' && Number.isFinite(view.scale) ? view.scale : 1;
  pageNumber.value = Math.min(pageCount.value, Math.max(1, savedPage));
  scale.value = clampScale(props.initialScale ?? savedScale);
  tool.value = view?.tool && ANNOTATION_TOOLS.has(view.tool) ? view.tool : 'pan';
  penColor.value = typeof view?.penColor === 'string' ? view.penColor : '#ef4444';
  penWidth.value = typeof view?.penWidth === 'number' && Number.isFinite(view.penWidth)
    ? Math.min(12, Math.max(1, Math.round(view.penWidth)))
    : 1;
  pageTone.value = view?.pageTone && PDF_PAGE_TONES.has(view.pageTone) ? view.pageTone : 'original';
  toolbarVertical.value = view?.toolbarVertical === true;
  const position = view?.toolbarPosition;
  toolbarPosition.value = position && Number.isFinite(position.left) && Number.isFinite(position.top)
    ? { left: position.left, top: position.top }
    : undefined;
}

function scheduleViewSave(): void {
  clearTimeout(viewSaveTimer);
  if (loading.value || !annotationSidecarExists) return;
  viewSaveTimer = setTimeout(() => void saveAnnotations(), VIEW_SAVE_DELAY);
}

function savePageTone(): void {
  void saveAnnotations();
}

function handleZoomWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;

  // Keep modifier-wheel zoom scoped to the PDF instead of letting the browser
  // zoom the entire application. Regular wheel scrolling remains unchanged.
  event.preventDefault();
  if (loading.value || event.deltaY === 0) return;
  setScale(scale.value + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
}

async function goToPage(page: number): Promise<void> {
  pageNumber.value = Math.min(pageCount.value, Math.max(1, page));
  await nextTick();
  pageElements.get(pageNumber.value)?.scrollIntoView({ block: 'start' });
  void renderPage(pageNumber.value);
}

function handleViewportScroll(): void {
  if (isPanning.value) return;
  const viewportTop = viewportEl.value?.getBoundingClientRect().top || 0;
  let closestPage = pageNumber.value;
  let closestDistance = Number.POSITIVE_INFINITY;
  const candidates = visiblePages.size
    ? [...visiblePages].map(page => [page, pageElements.get(page)] as const)
    : [pageNumber.value - 1, pageNumber.value, pageNumber.value + 1]
      .map(page => [page, pageElements.get(page)] as const);
  for (const [page, element] of candidates) {
    if (!element) continue;
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

function handleToolShortcut(event: KeyboardEvent): void {
  const target = event.target;
  const isEditable = target instanceof HTMLElement
    && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')));
  const nextTool = toolShortcuts[event.key];
  if (!nextTool || isEditable || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  toggleTool(nextTool);
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
  if (tool.value === 'move' && selectedAnnotation.value?.page === pageNumberToDraw) {
    const selected = strokes[selectedAnnotation.value.index];
    if (selected) drawResizeHandles(context, canvas, selected);
  }
}

function drawVisibleAnnotations(): void {
  pagesToDisplay.value.forEach(page => drawAnnotations(page));
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  stroke: AnnotationStroke,
  drawingScale = scale.value * (window.devicePixelRatio || 1),
): void {
  if (!stroke.points.length) return;
  const type = stroke.type || 'pen';
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
  context.lineWidth = stroke.width * drawingScale;
  if (type === 'highlighter') {
    context.globalAlpha = 0.35;
    context.lineWidth = Math.max(12, stroke.width * 4) * drawingScale;
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
  } else if (type === 'whiteout') {
    context.fillRect(startX, startY, endX - startX, endY - startY);
    context.restore();
    return;
  } else if (type === 'ellipse') {
    const radiusX = Math.abs(endX - startX) / 2;
    const radiusY = Math.abs(endY - startY) / 2;
    if (!radiusX || !radiusY) {
      context.restore();
      return;
    }
    context.ellipse((startX + endX) / 2, (startY + endY) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
  } else if (type === 'text') {
    const fontSize = 16 * drawingScale;
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

async function exportAnnotatedPdf(): Promise<void> {
  if (exporting.value) return;
  commitTextAnnotation();
  exporting.value = true;
  exportError.value = '';

  try {
    const response = await fetch(props.src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    const pages = pdf.getPages();
    const exportScale = 2;

    for (const [index, page] of pages.entries()) {
      const strokes = annotations.value.pages[String(index + 1)] || [];
      if (!strokes.length) continue;

      const { width, height } = page.getSize();
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(width * exportScale);
      canvas.height = Math.ceil(height * exportScale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      for (const stroke of strokes) drawAnnotation(context, canvas, stroke, exportScale);

      const overlay = await pdf.embedPng(canvas.toDataURL('image/png'));
      page.drawImage(overlay, { x: 0, y: 0, width, height });
    }

    const pdfBytes = await pdf.save();
    const blob = new Blob([pdfBytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    const filename = props.filePath.split(/[\\/]/).pop() || 'document.pdf';
    link.href = url;
    link.download = `${filename.replace(/\.pdf$/i, '')}-annotated.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    exportError.value = t('components.editorPanel.exportAnnotatedPdfFailed');
  } finally {
    exporting.value = false;
  }
}

function drawResizeHandles(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  stroke: AnnotationStroke,
): void {
  if (!isResizableAnnotation(stroke)) return;
  const ratio = window.devicePixelRatio || 1;
  const handleSize = 8 * ratio;
  context.save();
  context.strokeStyle = '#2563eb';
  context.lineWidth = 2 * ratio;
  for (const point of [stroke.points[0], stroke.points.at(-1)!]) {
    context.beginPath();
    context.rect(
      point.x * canvas.width - handleSize / 2,
      point.y * canvas.height - handleSize / 2,
      handleSize,
      handleSize,
    );
    context.stroke();
  }
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

  const generation = renderGeneration;
  const request = (renderRequests.get(pageNumberToRender) || 0) + 1;
  renderRequests.set(pageNumberToRender, request);
  renderTasks.get(pageNumberToRender)?.cancel();
  const page = await pdf.getPage(pageNumberToRender);
  if (generation !== renderGeneration || renderRequests.get(pageNumberToRender) !== request) return;

  const unscaledViewport = page.getViewport({ scale: 1 });
  const previousSize = pageSizes.value[pageNumberToRender];
  if (!previousSize || previousSize.width !== unscaledViewport.width || previousSize.height !== unscaledViewport.height) {
    pageSizes.value = {
      ...pageSizes.value,
      [pageNumberToRender]: { width: unscaledViewport.width, height: unscaledViewport.height },
    };
    await nextTick();
    if (generation !== renderGeneration || renderRequests.get(pageNumberToRender) !== request) return;
  }

  const viewport = page.getViewport({ scale: scale.value });
  const devicePixelRatio = window.devicePixelRatio || 1;
  // Avoid multi-hundred-megabyte canvas allocations for large pages at high zoom.
  const pixelRatio = Math.min(
    devicePixelRatio,
    Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)),
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('components.editorPanel.pdfRenderFailed'));

  canvas.width = annotationCanvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
  canvas.height = annotationCanvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  });
  renderTasks.set(pageNumberToRender, renderTask);
  try {
    await renderTask.promise;
    if (generation === renderGeneration && renderRequests.get(pageNumberToRender) === request) {
      drawAnnotations(pageNumberToRender);
    }
  } catch (renderError) {
    if ((renderError as Error).name !== 'RenderingCancelledException') throw renderError;
  } finally {
    if (renderTasks.get(pageNumberToRender) === renderTask) renderTasks.delete(pageNumberToRender);
  }
}

function pagesNearCurrent(): number[] {
  return [pageNumber.value - 1, pageNumber.value, pageNumber.value + 1]
    .filter(page => page >= 1 && page <= pageCount.value);
}

async function renderVisiblePages(): Promise<void> {
  await nextTick();
  const targets = new Set([...visiblePages, ...pagesNearCurrent()]);
  await Promise.all([...targets].map(page => renderPage(page)));
}

function handlePageIntersection(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    const page = Number((entry.target as HTMLElement).dataset.page);
    if (!page) continue;
    if (entry.isIntersecting) {
      visiblePages.add(page);
      void renderPage(page);
    } else {
      visiblePages.delete(page);
    }
  }
}

async function loadAnnotations(version: number): Promise<void> {
  annotations.value = { version: 1, pages: {} };
  annotationSidecarExists = false;
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
      if (parsed.version === 1 && parsed.pages && typeof parsed.pages === 'object') {
        annotations.value = parsed;
        annotationSidecarExists = true;
      }
      return;
    }
  } catch (loadError) {
    if (version === loadVersion) console.error('Failed to load PDF annotations:', loadError);
  }
}

async function loadPdf(): Promise<void> {
  const version = ++loadVersion;
  if (viewSaveTimer && annotationSidecarExists && loadedFilePath) void saveAnnotations(loadedFilePath);
  saveVersion++;
  clearTimeout(viewSaveTimer);
  viewSaveTimer = undefined;
  loadedFilePath = undefined;
  loading.value = true;
  error.value = '';
  renderGeneration++;
  renderTasks.forEach(task => task.cancel());
  renderTasks.clear();
  visiblePages.clear();
  pageSizes.value = {};
  outline.value = [];
  const previousLoadingTask = loadingTask;
  loadingTask = undefined;
  await previousLoadingTask?.destroy();
  document = undefined;

  try {
    const annotationPromise = loadAnnotations(version);
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({
      url: props.src,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
    });
    loadingTask = task;
    const loadedDocument = await task.promise;
    await annotationPromise;
    if (version !== loadVersion) {
      await task.destroy();
      return;
    }

    document = loadedDocument;
    pageCount.value = loadedDocument.numPages;
    const [firstPage, loadedOutline] = await Promise.all([
      loadedDocument.getPage(1),
      loadedDocument.getOutline(),
    ]);
    if (version !== loadVersion) return;
    outline.value = flattenOutline(loadedOutline as PdfOutlineSource[]);
    const firstPageViewport = firstPage.getViewport({ scale: 1 });
    defaultPageSize.value = { width: firstPageViewport.width, height: firstPageViewport.height };
    restoreViewState(annotations.value.view);
    await nextTick();
    if (version !== loadVersion) return;
    keepToolbarInBounds();
    loadedFilePath = props.filePath;
    loading.value = false;
    await renderVisiblePages();
    if (pageNumber.value > 1) pageElements.get(pageNumber.value)?.scrollIntoView({ block: 'start' });
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

  if (type === 'rectangle' || type === 'ellipse' || type === 'text' || type === 'whiteout') {
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

function isResizableAnnotation(stroke: AnnotationStroke): boolean {
  return ['line', 'arrow', 'rectangle', 'ellipse', 'whiteout'].includes(stroke.type || '') && stroke.points.length >= 2;
}

function resizePointIndex(
  stroke: AnnotationStroke,
  point: AnnotationPoint,
  canvas: HTMLCanvasElement,
): number | undefined {
  if (!isResizableAnnotation(stroke)) return undefined;
  const target = { x: point.x * canvas.width, y: point.y * canvas.height };
  const indexes = [0, stroke.points.length - 1];
  const distances = indexes.map(index => {
    const candidate = stroke.points[index];
    return Math.hypot(target.x - candidate.x * canvas.width, target.y - candidate.y * canvas.height);
  });
  const closest = distances[0] <= distances[1] ? 0 : 1;
  return distances[closest] <= 12 * (window.devicePixelRatio || 1) ? indexes[closest] : undefined;
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
    if (index < 0) {
      selectedAnnotation.value = undefined;
      drawAnnotations();
      return;
    }
    selectedAnnotation.value = { page, index };
    moveStart = {
      index,
      point,
      points: strokes[index].points.map(item => ({ ...item })),
      resizeIndex: resizePointIndex(strokes[index], point, canvas),
    };
  }

  activePointer = event.pointerId;
  annotationChanged = false;
  annotationCanvasElements.get(pageNumber.value)?.setPointerCapture(event.pointerId);
  checkpoint();
  if (tool.value === 'move') {
    drawAnnotations();
    return;
  }
  if (tool.value === 'eraser') {
    eraseAt(point);
    return;
  }

  addAnnotation({
    type: tool.value,
    color: tool.value === 'whiteout' ? '#ffffff' : penColor.value,
    width: penWidth.value,
    points: [point],
  });
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
    if (moveStart.resizeIndex !== undefined) {
      stroke.points[moveStart.resizeIndex] = point;
      const original = moveStart.points[moveStart.resizeIndex];
      annotationChanged = point.x !== original.x || point.y !== original.y;
    } else {
      const minX = Math.min(...moveStart.points.map(item => item.x));
      const maxX = Math.max(...moveStart.points.map(item => item.x));
      const minY = Math.min(...moveStart.points.map(item => item.y));
      const maxY = Math.max(...moveStart.points.map(item => item.y));
      const deltaX = Math.max(-minX, Math.min(1 - maxX, point.x - moveStart.point.x));
      const deltaY = Math.max(-minY, Math.min(1 - maxY, point.y - moveStart.point.y));
      stroke.points = moveStart.points.map(item => ({ x: item.x + deltaX, y: item.y + deltaY }));
      annotationChanged = deltaX !== 0 || deltaY !== 0;
    }
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

async function saveAnnotations(filePath = props.filePath): Promise<void> {
  clearTimeout(viewSaveTimer);
  viewSaveTimer = undefined;
  annotations.value.view = currentViewState();
  const version = ++saveVersion;
  saveState.value = 'saving';
  try {
    const response = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: annotationFilePath(filePath),
        content: JSON.stringify(annotations.value, null, 2),
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (version === saveVersion) {
      annotationSidecarExists = true;
      saveState.value = 'saved';
    }
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
  selectedAnnotation.value = undefined;
  annotations.value = previous;
  drawVisibleAnnotations();
  void saveAnnotations();
}

function redo(): void {
  const next = redoStack.value.pop();
  if (!next) return;
  undoStack.value.push(cloneAnnotations());
  selectedAnnotation.value = undefined;
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
  renderGeneration++;
  renderTasks.forEach(task => task.cancel());
  clearTimeout(zoomRenderTimer);
  if (loading.value || error.value) return;
  // CSS resizes existing canvases immediately; defer expensive rasterization until zoom settles.
  zoomRenderTimer = setTimeout(() => void renderVisiblePages().catch((renderError) => {
    console.error('Failed to render PDF:', renderError);
    error.value = t('components.editorPanel.pdfRenderFailed');
  }), ZOOM_RENDER_DELAY);
}

watch(scale, rerenderVisiblePages);
watch(tool, () => {
  selectedAnnotation.value = undefined;
  drawVisibleAnnotations();
});
watch([scale, pageNumber, tool, penColor, penWidth, toolbarVertical, toolbarPosition], scheduleViewSave);

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && viewportEl.value) {
    pageObserver = new IntersectionObserver(handlePageIntersection, {
      root: viewportEl.value,
      rootMargin: PAGE_RENDER_MARGIN,
    });
    pageElements.forEach(element => pageObserver?.observe(element));
  }
  window.addEventListener('resize', keepToolbarInBounds);
  window.addEventListener('keydown', handleToolShortcut);
});

onUnmounted(() => {
  loadVersion++;
  finishToolbarDrag();
  window.removeEventListener('resize', keepToolbarInBounds);
  window.removeEventListener('keydown', handleToolShortcut);
  clearTooltip();
  clearTimeout(statusTimer);
  clearTimeout(viewSaveTimer);
  clearTimeout(zoomRenderTimer);
  pageObserver?.disconnect();
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

.pdf-toolbar,
.pdf-navigation-toolbar {
  position: absolute;
  z-index: 2;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
}

.pdf-toolbar {
  top: 0.75rem;
  left: 50%;
  max-width: calc(100% - 1.5rem);
  transform: translateX(-50%);
  overflow: hidden;
}

.pdf-toolbar.vertical {
  max-width: none;
  max-height: calc(100% - 1.5rem);
  flex-direction: column;
}

.pdf-toolbar-drag-handle {
  display: inline-flex;
  width: 24px;
  height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  cursor: grab;
  touch-action: none;
}

.pdf-toolbar-drag-handle:active { cursor: grabbing; }
.pdf-toolbar-drag-handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.pdf-navigation-toolbar {
  bottom: 0.75rem;
  left: 0.75rem;
}

.pdf-export-error {
  max-width: 14rem;
  padding: 0 0.5rem;
  color: var(--error-color, #ef4444);
  font-size: 0.75rem;
}

.pdf-toolbar-group {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
}

.pdf-toolbar-group::-webkit-scrollbar { display: none; }

.pdf-toolbar.vertical .pdf-toolbar-group {
  min-height: 0;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
}

.pdf-toolbar button,
.pdf-navigation-toolbar button {
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
.pdf-toolbar button.active,
.pdf-navigation-toolbar button:hover:not(:disabled),
.pdf-navigation-toolbar button.active { background: var(--bg-hover); }

.pdf-toolbar button:has(.pdf-tool-shortcut) { position: relative; }

.pdf-tool-shortcut {
  position: absolute;
  right: 3px;
  bottom: 1px;
  color: var(--text-secondary);
  font-size: 0.55rem;
  line-height: 1;
  pointer-events: none;
}

.pdf-toolbar button:disabled,
.pdf-navigation-toolbar button:disabled { opacity: 0.45; }

.pdf-line-icon { transform: rotate(-45deg); }

.pdf-page-status {
  min-width: 3.5rem;
  padding: 0 0.65rem;
  text-align: center;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.pdf-zoom-level { min-width: 58px !important; }

.pdf-tone-control {
  display: inline-flex;
  height: 34px;
  align-items: center;
  border-left: 1px solid var(--border-color);
}

.pdf-tone-control select {
  width: 78px;
  height: 34px;
  padding: 0 1.25rem 0 0.25rem;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.pdf-tone-control select:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.pdf-tone-control select:disabled { cursor: default; opacity: 0.45; }
.pdf-tone-control option { background: var(--bg-secondary); color: var(--text-primary); }

.pdf-tone-swatch {
  width: 12px;
  height: 12px;
  margin-left: 0.45rem;
  flex: 0 0 auto;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: #fff;
}

.pdf-tone-swatch.tone-warm { background: #eadfbe; }
.pdf-tone-swatch.tone-gray { background: #a9aaad; }
.pdf-tone-swatch.tone-dark { background: #202329; }

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

.pdf-toolbar.vertical .pdf-width-control {
  width: 36px;
  height: 100px;
  flex-direction: column;
  padding: 0.4rem 0;
}

.pdf-toolbar.vertical .pdf-width-control input[type='range'] {
  width: 4px;
  height: 64px;
  writing-mode: vertical-lr;
  direction: rtl;
  background: linear-gradient(
    to top,
    var(--accent) 0 var(--pdf-pen-width-progress),
    var(--border-color) var(--pdf-pen-width-progress) 100%
  );
}

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

.pdf-annotation-tooltip {
  position: absolute;
  z-index: 3;
  padding: 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-elevated, var(--bg-secondary));
  box-shadow: 0 4px 12px rgb(0 0 0 / 30%);
  color: var(--text-primary);
  font-size: 0.75rem;
  pointer-events: none;
  transform: translateX(-50%);
  white-space: nowrap;
}

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
  padding: 4rem 1rem;
  text-align: center;
}

.pdf-viewport.has-outline { right: 220px; }

.pdf-outline {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 1;
  display: flex;
  width: 220px;
  flex-direction: column;
  overflow: hidden;
  padding: 1rem 0;
  border-left: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.pdf-outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem 0.6rem 0.75rem;
}

.pdf-outline-title {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pdf-outline-close {
  display: flex;
  width: 24px;
  height: 24px;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.pdf-outline-close:hover { color: var(--text-primary); background: var(--bg-hover); }
.pdf-outline-items { overflow: auto; }

.pdf-outline-items button {
  display: block;
  width: 100%;
  overflow: hidden;
  padding-top: 0.35rem;
  padding-right: 0.75rem;
  padding-bottom: 0.35rem;
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.pdf-outline-items button:hover:not(:disabled),
.pdf-outline-items button:focus-visible { color: var(--text-primary); background: var(--bg-hover); }
.pdf-outline-items button:disabled { cursor: default; opacity: 0.6; }

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

.pdf-page canvas {
  display: block;
  width: 100%;
  height: 100%;
  transition: filter 120ms ease;
}

.pdf-pages.tone-warm .pdf-page canvas { filter: sepia(0.18) saturate(0.9) brightness(0.94); }
.pdf-pages.tone-gray .pdf-page canvas { filter: grayscale(1) brightness(0.78) contrast(0.95); }
.pdf-pages.tone-dark .pdf-page canvas { filter: invert(0.88) hue-rotate(180deg) brightness(0.82) contrast(0.92); }
.pdf-pages.tone-warm .pdf-page { background: #eadfbe; }
.pdf-pages.tone-gray .pdf-page { background: #a9aaad; }
.pdf-pages.tone-dark .pdf-page { background: #202329; }

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
