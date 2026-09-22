<template>
  <div ref="previewEl" class="pdf-preview">
    <div
      ref="toolbarEl"
      class="pdf-toolbar"
      :class="{ vertical: toolbarVertical }"
      :style="toolbarStyle"
      role="toolbar"
      :aria-label="t(annotationControlsLabel)"
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
      <div class="pdf-toolbar-group" role="group" :aria-label="t(annotationControlsLabel)">
        <button
          v-for="annotationTool in annotationToolOptions"
          :key="annotationTool.name"
          type="button"
          :class="{ active: tool === annotationTool.name }"
          :aria-pressed="tool === annotationTool.name"
          :aria-label="t(annotationTool.label)"
          :aria-keyshortcuts="toolShortcutKeys[annotationTool.name]"
          :data-tooltip="t(annotationTool.label)"
          @click="toggleTool(annotationTool.name)"
        ><component
          :is="annotationTool.icon"
          :size="19"
          :weight="annotationTool.weight"
          :class="{ 'pdf-line-icon': annotationTool.name === 'line' }"
        /><span class="pdf-tool-shortcut">{{ toolShortcutKeys[annotationTool.name] }}</span></button>
        <label class="pdf-control-label" :data-tooltip="t(annotationColorLabel)">
          <input v-model="annotationColor" type="color" :aria-label="t(annotationColorLabel)">
        </label>
        <button
          ref="colorPresetsButtonEl"
          type="button"
          class="pdf-color-presets-trigger"
          :aria-label="t('components.editorPanel.annotationColorPresets')"
          :aria-expanded="showColorPresets"
          :data-tooltip="t('components.editorPanel.annotationColorPresets')"
          @click="toggleColorPresets"
        ><PhCaretDown :size="13" /></button>
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
          ref="shortcutButtonEl"
          type="button"
          :class="{ active: showShortcutEditor }"
          :aria-label="t('components.editorPanel.customizeAnnotationShortcuts')"
          :data-tooltip="t('components.editorPanel.customizeAnnotationShortcuts')"
          @click="toggleShortcutEditor"
        ><PhGear :size="19" /></button>
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
      v-if="showColorPresets"
      ref="colorPresetsEl"
      class="pdf-color-presets"
      role="group"
      :aria-label="t('components.editorPanel.annotationColorPresets')"
      :style="colorPresetsStyle"
      @keydown.esc="showColorPresets = false"
    >
      <button
        v-for="color in ANNOTATION_COLOR_PRESETS"
        :key="color"
        type="button"
        :style="{ backgroundColor: color }"
        :class="{ selected: annotationColor === color }"
        :aria-label="`${t('components.editorPanel.annotationColorPreset')} ${color}`"
        :aria-pressed="annotationColor === color"
        @click="annotationColor = color; showColorPresets = false"
      />
    </div>
    <div
      v-if="showShortcutEditor"
      ref="shortcutEditorEl"
      class="pdf-shortcut-editor"
      role="dialog"
      :style="shortcutEditorStyle"
      :aria-label="t('components.editorPanel.annotationShortcuts')"
      @keydown.esc="showShortcutEditor = false"
    >
      <div class="pdf-shortcut-editor-header">
        <strong>{{ t('components.editorPanel.annotationShortcuts') }}</strong>
        <button type="button" :aria-label="t('components.editorPanel.close')" @click="showShortcutEditor = false"><PhX :size="16" /></button>
      </div>
      <p>{{ t('components.editorPanel.annotationShortcutsDescription') }}</p>
      <label v-for="annotationTool in annotationToolOptions" :key="annotationTool.name">
        <span class="pdf-shortcut-tool"><component
          :is="annotationTool.icon"
          :size="18"
          :weight="annotationTool.weight"
          :class="{ 'pdf-line-icon': annotationTool.name === 'line' }"
        />{{ t(annotationTool.label) }}</span>
        <input
          :value="toolShortcutKeys[annotationTool.name]"
          readonly
          maxlength="1"
          :aria-label="`${t('components.editorPanel.annotationShortcutFor')} ${t(annotationTool.label)}`"
          @focus="($event.target as HTMLInputElement).select()"
          @keydown="setToolShortcut(annotationTool.name, $event)"
        >
      </label>
      <button type="button" class="pdf-shortcut-reset" @click="resetToolShortcuts">{{ t('components.editorPanel.resetAnnotationShortcuts') }}</button>
    </div>
    <div
      v-if="activeTooltip"
      class="pdf-annotation-tooltip"
      role="tooltip"
      :style="{ left: `${activeTooltip.left}px`, top: `${activeTooltip.top}px` }"
    >{{ activeTooltip.text }}</div>
    <div v-if="!isHtml" class="pdf-navigation-toolbar" role="toolbar" :aria-label="t(isImage ? 'components.editorPanel.imageControls' : 'components.editorPanel.pdfControls')">
      <button
        v-if="!isImage"
        type="button"
        :disabled="loading || pageNumber <= 1"
        :aria-label="t('components.editorPanel.previousPage')"
        @click="goToPage(pageNumber - 1)"
      ><PhCaretLeft :size="18" weight="bold" /></button>
      <span v-if="!isImage" class="pdf-page-status">
        {{ t('components.editorPanel.pdfPageStatus', { page: pageNumber, pages: pageCount || 1 }) }}
      </span>
      <button
        v-if="!isImage"
        type="button"
        :disabled="loading || pageNumber >= pageCount"
        :aria-label="t('components.editorPanel.nextPage')"
        @click="goToPage(pageNumber + 1)"
      ><PhCaretRight :size="18" weight="bold" /></button>
      <button
        v-if="!isImage && outline.length"
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
        :disabled="loading || scale <= minScale"
        :aria-label="t('components.editorPanel.zoomOut')"
        @click="setScale(scale - scaleStep)"
      ><PhMinus :size="18" /></button>
      <button
        type="button"
        class="pdf-zoom-level"
        :disabled="loading"
        :aria-label="t(isImage ? 'components.editorPanel.resetImageZoom' : 'components.editorPanel.resetPdfZoom')"
        @click="setScale(1)"
      >
        {{ Math.round(scale * 100) }}%
      </button>
      <button
        type="button"
        :disabled="loading || scale >= maxScale"
        :aria-label="t('components.editorPanel.zoomIn')"
        @click="setScale(scale + scaleStep)"
      ><PhPlus :size="18" /></button>
      <div class="pdf-tone-control">
        <span class="pdf-tone-swatch" :class="`tone-${pageTone}`" aria-hidden="true" />
        <CustomSelect
          :model-value="pageTone"
          :options="pageToneOptions"
          :disabled="loading"
          :aria-label="t(isImage ? 'components.editorPanel.imageTone' : 'components.editorPanel.pdfPageTone')"
          @update:model-value="setPageTone"
        />
      </div>
      <button
        type="button"
        :disabled="loading"
        :aria-label="t(isImage
          ? 'components.editorPanel.fitImageToWindow'
          : nextFitMode === 'width'
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
          ? isImage ? 'components.editorPanel.exportingAnnotatedImage' : 'components.editorPanel.exportingAnnotatedPdf'
          : isImage ? 'components.editorPanel.exportAnnotatedImage' : 'components.editorPanel.exportAnnotatedPdf')"
        @click="exportAnnotatedDocument"
      ><PhDownloadSimple :size="18" /></button>
      <span v-if="exportError" class="pdf-export-error" role="alert">{{ exportError }}</span>
    </div>
    <div
      ref="viewportEl"
      class="pdf-viewport"
      :class="{ pannable: tool === 'pan', panning: isPanning, 'has-outline': showOutline && outline.length }"
      :title="isImage ? t('components.editorPanel.imagePanHint') : undefined"
      @pointerdown="startPan"
      @pointermove="continuePan"
      @pointerup="finishPan"
      @pointercancel="finishPan"
      @scroll="handleViewportScroll"
      @wheel="handleZoomWheel"
      @dblclick="resetImageZoom"
    >
      <div v-if="loading" class="pdf-message" role="status">{{ t(isHtml ? 'components.editorPanel.loadingMhtml' : isImage ? 'components.editorPanel.loadingImage' : 'components.editorPanel.loadingPdf') }}</div>
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
          <canvas v-if="!isHtml" :ref="element => setCanvasElement(page, element, false)" />
          <iframe
            v-if="isHtml"
            :ref="setHtmlFrameElement"
            class="mhtml-document-frame"
            sandbox="allow-same-origin"
            :srcdoc="htmlDocument"
            :style="{
              width: `${htmlPageWidth || 1}px`,
              height: `${(pageSizes[1] || defaultPageSize).height}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }"
            :title="t('components.editorPanel.mhtmlPreview')"
            @load="handleHtmlLoad"
          />
          <canvas
            :ref="element => setCanvasElement(page, element, true)"
            class="pdf-annotation-canvas"
            :class="{
              enabled: tool !== 'pan',
              mhtml: isHtml,
              pen: tool === 'pen',
              highlighter: tool === 'highlighter',
              erasing: tool === 'eraser',
              moving: tool === 'move',
            }"
            :style="isHtml ? { height: `${htmlCanvasHeight}px` } : undefined"
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
            @input="scheduleTextEditorResize"
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
  PhCaretDown,
  PhCaretLeft,
  PhCaretRight,
  PhCircle,
  PhColumns,
  PhDotsSixVertical,
  PhDownloadSimple,
  PhEraser,
  PhGear,
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
import {
  DEFAULT_ANNOTATION_TOOL_SHORTCUTS,
  type AnnotationShortcutTool,
  usePreferences,
} from '../composables/usePreferences';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';

interface AnnotationPoint { x: number; y: number }
interface DrawingSurface { width: number; height: number }
type DrawingTool = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'whiteout';
interface AnnotationStroke {
  type?: DrawingTool;
  color: string;
  width: number;
  points: AnnotationPoint[];
  text?: string;
  fontSize?: number;
}
interface TextEditorState { page: string; point: AnnotationPoint; index?: number; text: string; color: string; fontSize: number }
interface TooltipState { text: string; left: number; top: number }
interface ToolbarPosition { left: number; top: number }
interface ImagePinch { initialDistance: number; initialScale: number }
type AnnotationTool = 'pan' | DrawingTool | 'move' | 'eraser';
type ShortcutTool = AnnotationShortcutTool;
type PdfFitMode = 'width' | 'height';
type PdfPageTone = 'original' | 'warm' | 'gray' | 'dark';
interface PdfViewState {
  scale?: number;
  htmlPageWidth?: number;
  htmlWidthCoordinates?: boolean;
  page?: number;
  tool?: AnnotationTool;
  penColor?: string;
  coverColor?: string;
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

const props = withDefaults(defineProps<{
  src: string;
  filePath: string;
  htmlDocument?: string;
  initialScale?: number;
  kind?: 'pdf' | 'image' | 'html';
}>(), { htmlDocument: '', kind: 'pdf' });
const emit = defineEmits<{ 'scale-change': [scale: number] }>();
const t = i18n.global.t;
const isImage = computed(() => props.kind === 'image');
const isHtml = computed(() => props.kind === 'html');
const annotationControlsLabel = computed(() => {
  if (isHtml.value) {
    return 'components.editorPanel.mhtmlAnnotationControls';
  }
  if (isImage.value) {
    return 'components.editorPanel.imageAnnotationControls';
  }
  return 'components.editorPanel.pdfAnnotationControls';
});
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.1;
const minScale = computed(() => isImage.value ? 0.05 : MIN_SCALE);
const maxScale = computed(() => isImage.value ? 8 : MAX_SCALE);
const scaleStep = computed(() => isImage.value ? 0.05 : SCALE_STEP);
const TOOLBAR_INSET = 12;
const ANNOTATION_COLOR_PRESETS = [
  '#3f3f46', '#9ca3af', '#c94f59', '#ef4444', '#fb923c', '#facc15', '#10b981', '#06b6d4', '#3b82f6', '#c084d4',
  '#ffffff', '#e5e7eb', '#f4b183', '#fecdd3', '#fde68a', '#fef3c7', '#a3e635', '#a5f3fc', '#7dd3fc', '#dbeafe',
];
const TEXT_BOUNDARY_INSET = 0.01;
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
const pageToneOptions = computed<CustomSelectOption[]>(() => [
  { value: 'original', label: t('components.editorPanel.pdfPageToneOriginal') },
  { value: 'warm', label: t('components.editorPanel.pdfPageToneWarm') },
  { value: 'gray', label: t('components.editorPanel.pdfPageToneGray') },
  { value: 'dark', label: t('components.editorPanel.pdfPageToneDark') },
]);
const annotationToolOptions = computed<Array<{ name: ShortcutTool; label: string; icon: object; weight?: 'fill' }>>(() => [
  { name: 'pen', label: isHtml.value ? 'components.editorPanel.mhtmlPen' : isImage.value ? 'components.editorPanel.imagePen' : 'components.editorPanel.pdfPen', icon: PhPencilSimple },
  { name: 'highlighter', label: isHtml.value ? 'components.editorPanel.mhtmlHighlighter' : isImage.value ? 'components.editorPanel.imageHighlighter' : 'components.editorPanel.pdfHighlighter', icon: PhHighlighter },
  { name: 'line', label: 'components.editorPanel.pdfLine', icon: PhMinus },
  { name: 'arrow', label: 'components.editorPanel.pdfArrow', icon: PhArrowUpRight },
  { name: 'rectangle', label: 'components.editorPanel.pdfRectangle', icon: PhRectangle },
  { name: 'ellipse', label: 'components.editorPanel.pdfEllipse', icon: PhCircle },
  { name: 'text', label: 'components.editorPanel.pdfText', icon: PhTextT },
  { name: 'move', label: 'components.editorPanel.pdfMoveAnnotation', icon: PhArrowsOutCardinal },
  { name: 'whiteout', label: isHtml.value ? 'components.editorPanel.mhtmlWhiteout' : isImage.value ? 'components.editorPanel.imageWhiteout' : 'components.editorPanel.pdfWhiteout', icon: PhRectangle, weight: 'fill' },
  { name: 'eraser', label: isHtml.value ? 'components.editorPanel.mhtmlEraser' : isImage.value ? 'components.editorPanel.imageEraser' : 'components.editorPanel.pdfEraser', icon: PhEraser },
]);
const { annotationToolShortcuts: toolShortcutKeys, setAnnotationToolShortcuts } = usePreferences();
const showShortcutEditor = ref(false);
const showColorPresets = ref(false);
const colorPresetsButtonEl = ref<HTMLButtonElement>();
const colorPresetsEl = ref<HTMLDivElement>();
const colorPresetsPosition = ref<ToolbarPosition>();
const colorPresetsStyle = computed(() => colorPresetsPosition.value && ({
  left: `${colorPresetsPosition.value.left}px`,
  top: `${colorPresetsPosition.value.top}px`,
}));
const shortcutEditorPosition = ref<ToolbarPosition>();
const shortcutEditorStyle = computed(() => shortcutEditorPosition.value && ({
  left: `${shortcutEditorPosition.value.left}px`,
  top: `${shortcutEditorPosition.value.top}px`,
}));

const previewEl = ref<HTMLDivElement>();
const toolbarEl = ref<HTMLDivElement>();
const htmlFrameEl = ref<HTMLIFrameElement>();
const shortcutButtonEl = ref<HTMLButtonElement>();
const shortcutEditorEl = ref<HTMLDivElement>();
const viewportEl = ref<HTMLDivElement>();
const htmlCanvasHeight = ref(1);
const htmlPageWidth = ref<number>();
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
const coverColor = ref('#ffffff');
const annotationColor = computed({
  get: () => tool.value === 'whiteout' ? coverColor.value : penColor.value,
  set: value => {
    if (tool.value === 'whiteout') coverColor.value = value;
    else penColor.value = value;
  },
});
const annotationColorLabel = computed(() => tool.value === 'whiteout'
  ? 'components.editorPanel.coverColor'
  : 'components.editorPanel.pdfPenColor');
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
    top: isHtml.value ? `${editor.point.y * (htmlPageWidth.value || 1) * scale.value}px` : `${editor.point.y * 100}%`,
    width: `${Math.max(24, longestLine + 2)}ch`,
    maxWidth: `${Math.max(0, 1 - editor.point.x - TEXT_BOUNDARY_INSET) * 100}%`,
    color: editor.color,
    fontSize: `${editor.fontSize * scale.value}px`,
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
let imageDocument: HTMLImageElement | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
let pageObserver: IntersectionObserver | undefined;
let htmlResizeObserver: ResizeObserver | undefined;
const visiblePages = new Set<number>();
const renderTasks = new Map<number, RenderTask>();
const renderRequests = new Map<number, number>();
let activePointer: number | undefined;
let panStart: { pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | undefined;
const imagePointers = new Map<number, AnnotationPoint>();
let imagePinch: ImagePinch | undefined;
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
let annotationDrawFrame: number | undefined;
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
  showColorPresets.value = false;
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
  void nextTick(updateShortcutEditorPosition);
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
  showColorPresets.value = false;
  void nextTick(updateShortcutEditorPosition);
}

function finishToolbarDrag(event?: PointerEvent): void {
  if (event && toolbarDrag && event.pointerId !== toolbarDrag.pointerId) return;
  toolbarDrag = undefined;
  window.removeEventListener('pointermove', continueToolbarDrag);
  window.removeEventListener('pointerup', finishToolbarDrag);
  window.removeEventListener('pointercancel', finishToolbarDrag);
}

function keepToolbarInBounds(): void {
  showColorPresets.value = false;
  if (toolbarPosition.value) {
    toolbarPosition.value = clampToolbarPosition(toolbarPosition.value.left, toolbarPosition.value.top);
  }
  void nextTick(updateShortcutEditorPosition);
}

function updateShortcutEditorPosition(): void {
  if (!showShortcutEditor.value) return;
  const previewRect = previewEl.value?.getBoundingClientRect();
  const toolbarRect = toolbarEl.value?.getBoundingClientRect();
  const buttonRect = shortcutButtonEl.value?.getBoundingClientRect();
  const editorRect = shortcutEditorEl.value?.getBoundingClientRect();
  if (!previewRect || !toolbarRect || !buttonRect || !editorRect) return;

  const gap = 8;
  const inset = 12;
  let left: number;
  let top: number;
  if (toolbarVertical.value) {
    const right = toolbarRect.right - previewRect.left + gap;
    const leftSide = toolbarRect.left - previewRect.left - editorRect.width - gap;
    left = right + editorRect.width <= previewRect.width - inset ? right : leftSide;
    top = buttonRect.top + buttonRect.height / 2 - previewRect.top - editorRect.height / 2;
  } else {
    const below = toolbarRect.bottom - previewRect.top + gap;
    const above = toolbarRect.top - previewRect.top - editorRect.height - gap;
    left = buttonRect.left + buttonRect.width / 2 - previewRect.left - editorRect.width / 2;
    top = below + editorRect.height <= previewRect.height - inset ? below : above;
  }
  shortcutEditorPosition.value = {
    left: Math.max(inset, Math.min(previewRect.width - editorRect.width - inset, left)),
    top: Math.max(inset, Math.min(previewRect.height - editorRect.height - inset, top)),
  };
}

async function toggleColorPresets(): Promise<void> {
  showColorPresets.value = !showColorPresets.value;
  clearTooltip();
  if (!showColorPresets.value) return;
  await nextTick();
  const previewRect = previewEl.value?.getBoundingClientRect();
  const buttonRect = colorPresetsButtonEl.value?.getBoundingClientRect();
  const paletteRect = colorPresetsEl.value?.getBoundingClientRect();
  if (!previewRect || !buttonRect || !paletteRect) return;
  colorPresetsPosition.value = {
    left: Math.max(0, Math.min(previewRect.width - paletteRect.width, buttonRect.left - previewRect.left)),
    top: buttonRect.bottom + paletteRect.height > previewRect.bottom
      ? buttonRect.top - previewRect.top - paletteRect.height
      : buttonRect.bottom - previewRect.top,
  };
}

function closeColorPresetsOutside(event: PointerEvent): void {
  if (!colorPresetsEl.value?.contains(event.target as Node)
    && !colorPresetsButtonEl.value?.contains(event.target as Node)) {
    showColorPresets.value = false;
  }
}

async function toggleShortcutEditor(): Promise<void> {
  showShortcutEditor.value = !showShortcutEditor.value;
  clearTooltip();
  if (showShortcutEditor.value) {
    await nextTick();
    updateShortcutEditorPosition();
  }
}

function toggleToolbarOrientation(): void {
  showColorPresets.value = false;
  toolbarVertical.value = !toolbarVertical.value;
  clearTooltip();

  if (!toolbarVertical.value) {
    // Removing the custom position restores the default top-center placement.
    toolbarPosition.value = undefined;
    void nextTick(updateShortcutEditorPosition);
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
    void nextTick(updateShortcutEditorPosition);
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

function annotationPathParts(filePath = props.filePath): { directory: string; filename: string; separator: string } {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return {
    directory: filePath.slice(0, separatorIndex + 1),
    filename: filePath.slice(separatorIndex + 1),
    separator: filePath[separatorIndex] || '/',
  };
}

function annotationFilePath(filePath = props.filePath): string {
  const { directory, filename, separator } = annotationPathParts(filePath);
  return `${directory}.annotations${separator}${filename}.annotations.json`;
}

function legacyAnnotationFilePaths(): string[] {
  const { directory, filename } = annotationPathParts();
  return [`${directory}.${filename}.annotations.json`, `${props.filePath}.annotations.json`];
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

function setHtmlFrameElement(element: unknown): void {
  htmlFrameEl.value = element instanceof HTMLIFrameElement ? element : undefined;
}

function setTextEditorElement(element: unknown): void {
  textEditorEl.value = element instanceof HTMLTextAreaElement ? element : undefined;
}

function resizeTextEditor(): void {
  const element = textEditorEl.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

function scheduleTextEditorResize(): void {
  void nextTick(resizeTextEditor);
}

function clampScale(value: number): number {
  return Math.min(maxScale.value, Math.max(minScale.value, value));
}

function setScale(value: number): void {
  const nextScale = clampScale(value);
  if (nextScale === scale.value) return;
  scale.value = nextScale;
  emit('scale-change', nextScale);
}

function flattenOutline(items: PdfOutlineSource[] | null, level = 0): PdfOutlineItem[] {
  return (items || []).flatMap(item => [
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
  if (isImage.value) {
    if (!(availableWidth > 0) || !(availableHeight > 0)) return;
    setScale(Math.min(1, availableWidth / pageSize.width, availableHeight / pageSize.height));
    return;
  }
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
    htmlPageWidth: isHtml.value ? htmlPageWidth.value : undefined,
    htmlWidthCoordinates: isHtml.value ? true : undefined,
    page: pageNumber.value,
    tool: tool.value,
    penColor: penColor.value,
    coverColor: coverColor.value,
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
  htmlPageWidth.value = typeof view?.htmlPageWidth === 'number' && Number.isFinite(view.htmlPageWidth) && view.htmlPageWidth > 0
    ? view.htmlPageWidth
    : undefined;
  tool.value = view?.tool && ANNOTATION_TOOLS.has(view.tool) ? view.tool : 'pan';
  penColor.value = typeof view?.penColor === 'string' ? view.penColor : '#ef4444';
  coverColor.value = typeof view?.coverColor === 'string' ? view.coverColor : '#ffffff';
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

function setPageTone(value: string): void {
  if (!PDF_PAGE_TONES.has(value as PdfPageTone)) return;
  pageTone.value = value as PdfPageTone;
  void saveAnnotations();
}

function handleZoomWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  if (loading.value || event.deltaY === 0) return;
  setScale(scale.value + (event.deltaY < 0 ? scaleStep.value : -scaleStep.value));
}

function resetImageZoom(): void {
  if (isImage.value) setScale(1);
}

async function goToPage(page: number): Promise<void> {
  pageNumber.value = Math.min(pageCount.value, Math.max(1, page));
  await nextTick();
  pageElements.get(pageNumber.value)?.scrollIntoView({ block: 'start' });
  void renderPage(pageNumber.value);
}

function handleViewportScroll(): void {
  if (isHtml.value) drawAnnotations();
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

function setToolShortcut(annotationTool: ShortcutTool, event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.key.length !== 1 || /\s/.test(event.key)) return;
  event.preventDefault();
  const key = event.key.toUpperCase();
  const previousKey = toolShortcutKeys.value[annotationTool];
  const previousTool = (Object.keys(toolShortcutKeys.value) as ShortcutTool[])
    .find(name => name !== annotationTool && toolShortcutKeys.value[name] === key);
  const nextShortcuts = { ...toolShortcutKeys.value, [annotationTool]: key };
  if (previousTool) nextShortcuts[previousTool] = previousKey;
  void setAnnotationToolShortcuts(nextShortcuts);
}

function resetToolShortcuts(): void {
  void setAnnotationToolShortcuts({ ...DEFAULT_ANNOTATION_TOOL_SHORTCUTS });
}

function handleToolShortcut(event: KeyboardEvent): void {
  const target = event.target;
  const isEditable = target instanceof HTMLElement
    && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')));
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const nextTool = (Object.keys(toolShortcutKeys.value) as ShortcutTool[])
    .find(annotationTool => toolShortcutKeys.value[annotationTool] === key);
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

  let surface: DrawingSurface = canvas;
  let drawingScale: number | undefined;
  let translated = false;
  if (isHtml.value) {
    const pageRect = pageElements.get(pageNumberToDraw)?.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (pageRect?.width && pageRect.height && canvasRect.width) {
      const pixelRatio = canvas.width / canvasRect.width;
      surface = { width: pageRect.width * pixelRatio, height: pageRect.width * pixelRatio };
      drawingScale = canvas.width / Math.max(1, (pageSizes.value[pageNumberToDraw] || defaultPageSize.value).width);
      context.save();
      context.translate(0, -(canvasRect.top - pageRect.top) * pixelRatio);
      translated = true;
    }
  }

  const strokes = annotations.value.pages[String(pageNumberToDraw)] || [];
  strokes.forEach((stroke, index) => {
    if (textEditor.value?.page === String(pageNumberToDraw) && textEditor.value.index === index) return;
    drawAnnotation(context, surface, stroke, drawingScale);
  });
  if (tool.value === 'move' && selectedAnnotation.value?.page === pageNumberToDraw) {
    const selected = strokes[selectedAnnotation.value.index];
    if (selected) drawResizeHandles(context, surface, selected);
  }
  if (translated) context.restore();
}

function scheduleAnnotationDraw(): void {
  if (!isHtml.value) {
    drawAnnotations();
    return;
  }
  if (annotationDrawFrame !== undefined) return;
  annotationDrawFrame = window.requestAnimationFrame(() => {
    annotationDrawFrame = undefined;
    drawAnnotations();
  });
}

function flushAnnotationDraw(): void {
  if (annotationDrawFrame === undefined) return;
  window.cancelAnimationFrame(annotationDrawFrame);
  annotationDrawFrame = undefined;
  drawAnnotations();
}

function drawVisibleAnnotations(): void {
  pagesToDisplay.value.forEach(page => drawAnnotations(page));
}

function wrapTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const availableWidth = Math.max(1, maxWidth);
  return text.split('\n').flatMap((sourceLine) => {
    if (!sourceLine || context.measureText(sourceLine).width <= availableWidth) return [sourceLine];
    const lines: string[] = [];
    let line = '';
    for (const segment of sourceLine.match(/\S+\s*/g) || []) {
      const candidate = line + segment;
      if (line && context.measureText(candidate).width > availableWidth) {
        lines.push(line.trimEnd());
        line = segment.trimStart();
      } else {
        line = candidate;
      }

      // A single oversized word still needs character wrapping to stay on the page.
      while (context.measureText(line).width > availableWidth) {
        let splitAt = 1;
        while (splitAt < line.length && context.measureText(line.slice(0, splitAt + 1)).width <= availableWidth) splitAt += 1;
        lines.push(line.slice(0, splitAt).trimEnd());
        line = line.slice(splitAt).trimStart();
      }
    }
    lines.push(line.trimEnd());
    return lines;
  });
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  surface: DrawingSurface,
  stroke: AnnotationStroke,
  drawingScale = scale.value * (window.devicePixelRatio || 1),
): void {
  if (!stroke.points.length) return;
  const type = stroke.type || 'pen';
  const start = stroke.points[0];
  const end = stroke.points.at(-1) || start;
  const startX = start.x * surface.width;
  const startY = start.y * surface.height;
  const endX = end.x * surface.width;
  const endY = end.y * surface.height;

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
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * surface.width, point.y * surface.height);
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
    const fontSize = (stroke.fontSize ?? 16) * drawingScale;
    context.font = `${fontSize}px sans-serif`;
    context.textBaseline = 'top';
    const lines = wrapTextLines(context, stroke.text || '', surface.width * (1 - start.x - TEXT_BOUNDARY_INSET));
    for (const [index, line] of lines.entries()) {
      context.fillText(line, startX, startY + index * fontSize * 1.25);
    }
    context.restore();
    return;
  }
  context.stroke();
  context.restore();
}

async function exportAnnotatedDocument(): Promise<void> {
  if (exporting.value) return;
  commitTextAnnotation();
  exporting.value = true;
  exportError.value = '';

  try {
    if (isImage.value) {
      const image = imageDocument;
      if (!image) throw new Error('Image is unavailable');
      const canvas = window.document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(image, 0, 0);
      for (const stroke of currentPageStrokes.value) drawAnnotation(context, canvas, stroke, 1);
      const filename = props.filePath.split(/[\\/]/).pop() || 'image.png';
      const link = window.document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${filename.replace(/\.[^.]+$/, '')}-annotated.png`;
      link.click();
      return;
    }

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
    exportError.value = t(isImage.value
      ? 'components.editorPanel.exportAnnotatedImageFailed'
      : 'components.editorPanel.exportAnnotatedPdfFailed');
  } finally {
    exporting.value = false;
  }
}

function drawResizeHandles(
  context: CanvasRenderingContext2D,
  surface: DrawingSurface,
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
      point.x * surface.width - handleSize / 2,
      point.y * surface.height - handleSize / 2,
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
  const image = imageDocument;
  const canvas = canvasElements.get(pageNumberToRender);
  const annotationCanvas = annotationCanvasElements.get(pageNumberToRender);
  if (!annotationCanvas || (!isHtml.value && !canvas)) return;

  const generation = renderGeneration;
  if (isHtml.value) {
    const size = pageSizes.value[pageNumberToRender] || defaultPageSize.value;
    const pixelRatio = window.devicePixelRatio || 1;
    annotationCanvas.width = Math.max(1, Math.floor(size.width * scale.value * pixelRatio));
    annotationCanvas.height = Math.max(1, Math.floor(htmlCanvasHeight.value * pixelRatio));
    drawAnnotations(pageNumberToRender);
    return;
  }
  if (!canvas || (!pdf && !image)) return;
  if (image) {
    const viewport = {
      width: image.naturalWidth * scale.value,
      height: image.naturalHeight * scale.value,
    };
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('components.editorPanel.imageRenderFailed'));
    canvas.width = annotationCanvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
    canvas.height = annotationCanvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawAnnotations(pageNumberToRender);
    return;
  }
  if (!pdf) return;

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

function handleRenderError(renderError: unknown): void {
  console.error(`Failed to render ${isImage.value ? 'image' : 'PDF'}:`, renderError);
  error.value = t(isImage.value
    ? 'components.editorPanel.imageRenderFailed'
    : 'components.editorPanel.pdfRenderFailed');
}

function handlePageIntersection(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    const page = Number((entry.target as HTMLElement).dataset.page);
    if (!page) continue;
    if (entry.isIntersecting) {
      visiblePages.add(page);
      void renderPage(page).catch(handleRenderError);
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
  let lastLoadError: unknown;
  for (const filePath of [annotationFilePath(), ...legacyAnnotationFilePaths()]) {
    try {
      const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (version !== loadVersion) return;
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content?: string };
      const parsed = JSON.parse(data.content || '') as AnnotationDocument;
      if (parsed.version === 1 && parsed.pages && typeof parsed.pages === 'object') {
        annotations.value = parsed;
        annotationSidecarExists = true;
        return;
      }
    } catch (loadError) {
      lastLoadError = loadError;
    }
  }
  if (version === loadVersion && lastLoadError) {
    console.error('Failed to load annotations:', lastLoadError);
  }
}

function updateHtmlPageSize(): void {
  const frame = htmlFrameEl.value;
  const htmlDocument = frame?.contentDocument;
  const viewport = viewportEl.value;
  if (!frame || !htmlDocument || !viewport) return;

  // Freeze the layout width so zoom and viewport resizing cannot reflow content
  // independently of the annotation coordinates.
  const viewportStyle = window.getComputedStyle(viewport);
  const width = htmlPageWidth.value ?? Math.max(
    viewport.clientWidth - parseFloat(viewportStyle.paddingLeft) - parseFloat(viewportStyle.paddingRight),
    1,
  );
  htmlPageWidth.value = width;
  const height = Math.max(htmlDocument.documentElement.scrollHeight, htmlDocument.body?.scrollHeight || 0, 1);
  // Legacy MHTML strokes use page-height fractions. Convert once to width-based
  // coordinates so font reflow cannot stretch annotations vertically.
  if (!annotations.value.view?.htmlWidthCoordinates) {
    const strokes = annotations.value.pages['1'] || [];
    for (const stroke of strokes) {
      for (const point of stroke.points) point.y *= height / width;
    }
    annotations.value.view = { ...annotations.value.view, htmlWidthCoordinates: true };
    if (strokes.length) void saveAnnotations();
  }
  const availableHeight = viewport.clientHeight
    - parseFloat(viewportStyle.paddingTop)
    - parseFloat(viewportStyle.paddingBottom);
  htmlCanvasHeight.value = Math.max(1, Math.min(availableHeight, height * scale.value));
  if (pageSizes.value[1]?.width === width && pageSizes.value[1]?.height === height) return;
  defaultPageSize.value = { width, height };
  pageSizes.value = { 1: { width, height } };
  void nextTick(() => renderPage(1).catch(handleRenderError));
}

async function handleHtmlLoad(): Promise<void> {
  const frame = htmlFrameEl.value;
  const htmlDocument = frame?.contentDocument;
  if (!frame || !htmlDocument || !isHtml.value) return;

  // The outer viewport scrolls the page and its annotation overlay together.
  // Override archived root scrollbars while keeping body overflow measurable.
  htmlDocument.documentElement.style.setProperty('overflow', 'hidden', 'important');
  htmlDocument.body?.style.setProperty('overflow', 'visible', 'important');

  htmlResizeObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    htmlResizeObserver = new ResizeObserver(updateHtmlPageSize);
    htmlResizeObserver.observe(htmlDocument.documentElement);
    if (htmlDocument.body) htmlResizeObserver.observe(htmlDocument.body);
  }
  htmlDocument.addEventListener('wheel', event => {
    const viewport = viewportEl.value;
    if (event.ctrlKey || event.metaKey) {
      handleZoomWheel(event);
      return;
    }
    if (!viewport) return;
    event.preventDefault();
    viewport.scrollBy({ left: event.deltaX, top: event.deltaY });
  }, { passive: false });

  updateHtmlPageSize();
  loading.value = false;
  await nextTick();
  updateHtmlPageSize();
  await renderVisiblePages().catch(handleRenderError);
}

function loadImage(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = props.src;
  });
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
  imagePointers.clear();
  imagePinch = undefined;
  panStart = undefined;
  isPanning.value = false;
  pageSizes.value = {};
  outline.value = [];
  htmlResizeObserver?.disconnect();
  htmlResizeObserver = undefined;
  const previousLoadingTask = loadingTask;
  loadingTask = undefined;
  await previousLoadingTask?.destroy();
  document = undefined;
  imageDocument = undefined;

  try {
    const annotationPromise = loadAnnotations(version);
    if (isHtml.value) {
      pageCount.value = 1;
      await annotationPromise;
      if (version !== loadVersion) return;
      restoreViewState(annotations.value.view);
      loadedFilePath = props.filePath;
      await nextTick();
      return;
    }
    if (isImage.value) {
      const loadedImage = await loadImage();
      await annotationPromise;
      if (version !== loadVersion) return;
      imageDocument = loadedImage;
      pageCount.value = 1;
      defaultPageSize.value = { width: loadedImage.naturalWidth, height: loadedImage.naturalHeight };
      restoreViewState(annotations.value.view);
      await nextTick();
      if (version !== loadVersion) return;
      if (!annotations.value.view) fitPdfToViewport();
      keepToolbarInBounds();
      loadedFilePath = props.filePath;
      loading.value = false;
      await renderVisiblePages().catch(handleRenderError);
      return;
    }

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
    outline.value = flattenOutline(loadedOutline as PdfOutlineSource[] | null);
    const firstPageViewport = firstPage.getViewport({ scale: 1 });
    defaultPageSize.value = { width: firstPageViewport.width, height: firstPageViewport.height };
    restoreViewState(annotations.value.view);
    await nextTick();
    if (version !== loadVersion) return;
    keepToolbarInBounds();
    loadedFilePath = props.filePath;
    loading.value = false;
    await renderVisiblePages().catch(handleRenderError);
    if (pageNumber.value > 1) pageElements.get(pageNumber.value)?.scrollIntoView({ block: 'start' });
  } catch (loadError) {
    if (version !== loadVersion) return;
    console.error(`Failed to load ${isHtml.value ? 'MHTML' : isImage.value ? 'image' : 'PDF'}:`, loadError);
    loading.value = false;
    error.value = t(isHtml.value
      ? 'components.editorPanel.mhtmlLoadFailed'
      : isImage.value
        ? 'components.editorPanel.imageLoadFailed'
        : 'components.editorPanel.pdfLoadFailed');
  }
}

function imagePinchDistance(): number | undefined {
  const [first, second] = imagePointers.values();
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : undefined;
}

function startPan(event: PointerEvent): void {
  const viewport = viewportEl.value;
  if (tool.value !== 'pan' || event.button !== 0 || !viewport) return;
  viewport.setPointerCapture?.(event.pointerId);

  if (isImage.value) {
    imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const distance = imagePinchDistance();
    if (distance !== undefined) {
      imagePinch = { initialDistance: distance, initialScale: scale.value };
      panStart = undefined;
      isPanning.value = false;
      return;
    }
  }

  panStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
  };
  isPanning.value = true;
}

function continuePan(event: PointerEvent): void {
  const viewport = viewportEl.value;
  if (!viewport) return;
  if (isImage.value && imagePointers.has(event.pointerId)) {
    imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const distance = imagePinchDistance();
    if (imagePinch && distance !== undefined && imagePinch.initialDistance > 0) {
      setScale(imagePinch.initialScale * distance / imagePinch.initialDistance);
      return;
    }
  }
  if (panStart?.pointerId !== event.pointerId) return;
  viewport.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.x);
  viewport.scrollTop = panStart.scrollTop - (event.clientY - panStart.y);
}

function finishPan(event: PointerEvent): void {
  const viewport = viewportEl.value;
  if (isImage.value) {
    imagePointers.delete(event.pointerId);
    if (imagePointers.size < 2) imagePinch = undefined;
  }
  viewport?.releasePointerCapture?.(event.pointerId);
  if (panStart?.pointerId !== event.pointerId) return;
  panStart = undefined;
  isPanning.value = false;
}

function pointFromEvent(event: PointerEvent): AnnotationPoint | undefined {
  const canvas = event.currentTarget instanceof HTMLCanvasElement
    ? event.currentTarget
    : annotationCanvasElements.get(pageNumber.value);
  if (!canvas) return undefined;
  const pageRect = isHtml.value ? pageElements.get(pageNumber.value)?.getBoundingClientRect() : undefined;
  const rect = pageRect?.width && pageRect.height ? pageRect : canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  const heightUnit = isHtml.value ? rect.width : rect.height;
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(rect.height / heightUnit, Math.max(0, (event.clientY - rect.top) / heightUnit)),
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

function annotationDrawingSurface(canvas: HTMLCanvasElement): DrawingSurface {
  if (!isHtml.value) return canvas;
  const pageRect = pageElements.get(pageNumber.value)?.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  if (!pageRect || !canvasRect.width) return canvas;
  const pixelRatio = canvas.width / canvasRect.width;
  return { width: pageRect.width * pixelRatio, height: pageRect.width * pixelRatio };
}

function annotationContainsPoint(stroke: AnnotationStroke, point: AnnotationPoint, canvas: HTMLCanvasElement): boolean {
  if (!stroke.points.length) return false;
  const threshold = 12 * (window.devicePixelRatio || 1);
  const surface = annotationDrawingSurface(canvas);
  const target = { x: point.x * surface.width, y: point.y * surface.height };
  const points = stroke.points.map(item => ({ x: item.x * surface.width, y: item.y * surface.height }));
  const type = stroke.type || 'pen';

  if (type === 'rectangle' || type === 'ellipse' || type === 'text' || type === 'whiteout') {
    const start = points[0];
    const end = points.at(-1) || start;
    const textScale = scale.value * (window.devicePixelRatio || 1);
    const fontSize = (stroke.fontSize ?? 16) * textScale;
    const context = type === 'text' ? canvas.getContext('2d') : null;
    if (context) context.font = `${fontSize}px sans-serif`;
    const textLines = context
      ? wrapTextLines(context, stroke.text || '', surface.width * (1 - stroke.points[0].x - TEXT_BOUNDARY_INSET))
      : (stroke.text || '').split('\n');
    const textWidth = context ? Math.max(...textLines.map(line => context.measureText(line).width), 0) : 0;
    const textHeight = type === 'text' ? textLines.length * fontSize * 1.25 : 0;
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
  const surface = annotationDrawingSurface(canvas);
  const target = { x: point.x * surface.width, y: point.y * surface.height };
  const indexes = [0, stroke.points.length - 1];
  const distances = indexes.map(index => {
    const candidate = stroke.points[index];
    return Math.hypot(target.x - candidate.x * surface.width, target.y - candidate.y * surface.height);
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
    color: tool.value === 'whiteout' ? coverColor.value : penColor.value,
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
    // Image pixels may greatly outnumber screen pixels, so size new text for the current view.
    fontSize: existing?.fontSize ?? (isImage.value ? 16 / scale.value : 16),
  };
  drawAnnotations();
  void nextTick(() => {
    resizeTextEditor();
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
      fontSize: editor.fontSize,
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
      const page = pageElements.get(pageNumber.value)?.getBoundingClientRect();
      const maxPageY = isHtml.value && page?.width ? page.height / page.width : 1;
      const deltaY = Math.max(-minY, Math.min(Math.max(0, maxPageY - maxY), point.y - moveStart.point.y));
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
  scheduleAnnotationDraw();
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
  flushAnnotationDraw();
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
    console.error('Failed to save annotations:', saveError);
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
watch(() => props.htmlDocument, () => { if (!isHtml.value) void loadPdf(); });
function rerenderVisiblePages(): void {
  renderGeneration++;
  renderTasks.forEach(task => task.cancel());
  clearTimeout(zoomRenderTimer);
  if (loading.value || error.value) return;
  // CSS resizes existing canvases immediately; defer expensive rasterization until zoom settles.
  zoomRenderTimer = setTimeout(() => void renderVisiblePages().catch(handleRenderError), ZOOM_RENDER_DELAY);
}

watch(scale, rerenderVisiblePages);
watch(tool, () => {
  selectedAnnotation.value = undefined;
  drawVisibleAnnotations();
});
watch([scale, pageNumber, tool, penColor, coverColor, penWidth, toolbarVertical, toolbarPosition], scheduleViewSave);

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && viewportEl.value) {
    pageObserver = new IntersectionObserver(handlePageIntersection, {
      root: viewportEl.value,
      rootMargin: PAGE_RENDER_MARGIN,
    });
    pageElements.forEach(element => pageObserver?.observe(element));
  }
  window.addEventListener('resize', keepToolbarInBounds);
  window.addEventListener('pointerdown', closeColorPresetsOutside);
  window.addEventListener('keydown', handleToolShortcut);
});

onUnmounted(() => {
  loadVersion++;
  finishToolbarDrag();
  window.removeEventListener('resize', keepToolbarInBounds);
  window.removeEventListener('pointerdown', closeColorPresetsOutside);
  window.removeEventListener('keydown', handleToolShortcut);
  clearTooltip();
  clearTimeout(statusTimer);
  clearTimeout(viewSaveTimer);
  clearTimeout(zoomRenderTimer);
  if (annotationDrawFrame !== undefined) window.cancelAnimationFrame(annotationDrawFrame);
  imagePointers.clear();
  pageObserver?.disconnect();
  htmlResizeObserver?.disconnect();
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

.pdf-color-presets {
  position: absolute;
  z-index: 3;
  display: grid;
  box-sizing: border-box;
  width: min(260px, 100%);
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
}

.pdf-color-presets button {
  width: 100%;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
}

.pdf-color-presets button:hover,
.pdf-color-presets button:focus-visible,
.pdf-color-presets button.selected { outline: 2px solid var(--accent); outline-offset: 1px; }

.pdf-shortcut-editor {
  position: absolute;
  z-index: 3;
  display: grid;
  width: min(280px, calc(100% - 1.5rem));
  max-height: calc(100% - 1.5rem);
  gap: 0.45rem;
  padding: 0.75rem;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
}

.pdf-shortcut-editor-header,
.pdf-shortcut-editor label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.pdf-shortcut-editor-header button {
  display: inline-flex;
  padding: 0.2rem;
  border: 0;
  background: transparent;
  color: var(--text-primary);
}

.pdf-shortcut-editor p {
  margin: 0 0 0.25rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.pdf-shortcut-editor label { font-size: 0.8rem; }

.pdf-shortcut-tool {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

.pdf-shortcut-tool svg { flex: 0 0 auto; }

.pdf-shortcut-editor input {
  width: 2.25rem;
  padding: 0.25rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  text-align: center;
  text-transform: uppercase;
}

.pdf-shortcut-reset {
  margin-top: 0.3rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-primary);
  color: var(--text-primary);
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

.pdf-tone-control :deep(.custom-select) { width: 82px; }

.pdf-tone-control :deep(.custom-select-trigger) {
  height: 34px;
  padding: 0 0.45rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: 0.75rem;
}

.pdf-tone-control :deep(.custom-select-trigger:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  box-shadow: none;
}

.pdf-tone-control :deep(.custom-select-list) { min-width: 96px; }

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

.pdf-toolbar .pdf-color-presets-trigger {
  min-width: 18px;
  padding: 0;
  color: var(--text-secondary);
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

.mhtml-document-frame {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}

.pdf-annotation-canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.pdf-pages.tone-warm .pdf-page canvas { filter: sepia(0.18) saturate(0.9) brightness(0.94); }
.pdf-pages.tone-gray .pdf-page canvas { filter: grayscale(1) brightness(0.78) contrast(0.95); }
.pdf-pages.tone-dark .pdf-page canvas { filter: invert(0.88) hue-rotate(180deg) brightness(0.82) contrast(0.92); }
.pdf-pages.tone-warm .pdf-page { background: #eadfbe; }
.pdf-pages.tone-gray .pdf-page { background: #a9aaad; }
.pdf-pages.tone-dark .pdf-page { background: #202329; }

.pdf-annotation-canvas.mhtml {
  position: sticky;
  inset: auto;
  top: 0;
  width: 100%;
}

.pdf-annotation-canvas.enabled {
  cursor: crosshair;
  pointer-events: auto;
  touch-action: none;
}

.pdf-annotation-canvas.pen {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='m4 24 3.5-8.5L19 4l5 5-11.5 11.5z' fill='white' stroke='%23111827' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='m7.5 15.5 5 5M17 6l5 5' stroke='%23111827' stroke-width='1.5'/%3E%3C/svg%3E") 4 24, crosshair;
}

.pdf-annotation-canvas.highlighter {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='m4 23 4-8L18 5l5 5-10 10z' fill='%23facc15' stroke='%23111827' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='m8 15 5 5M16 7l5 5' stroke='%23111827' stroke-width='1.5'/%3E%3Cpath d='M3 25h10' stroke='%23facc15' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E") 4 23, crosshair;
}

.pdf-annotation-canvas.erasing {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='m4 17 10-10 6 6-8 8H8z' fill='%23fff' stroke='%231f2937' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='m11 10 6 6' stroke='%231f2937' stroke-width='1.5'/%3E%3C/svg%3E") 4 20, cell;
}

.pdf-annotation-canvas.moving { cursor: move; }

.pdf-text-editor {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  min-width: 0;
  min-height: 1.5em;
  padding: 0 2px;
  border: 1px solid currentColor;
  border-radius: 2px;
  outline: none;
  background: rgb(255 255 255 / 90%);
  overflow: hidden;
  overflow-wrap: anywhere;
  resize: none;
  font-family: sans-serif;
  line-height: 1.25;
  transform: translateY(-1px);
}

.pdf-message { margin-top: 2rem; color: var(--text-secondary); }
.pdf-error { color: var(--error-color, #ef4444); }
</style>
