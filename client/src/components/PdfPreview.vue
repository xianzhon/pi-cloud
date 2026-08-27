<template>
  <div class="pdf-preview">
    <div class="pdf-toolbar" role="toolbar" :aria-label="t('components.editorPanel.pdfControls')">
      <button
        type="button"
        :disabled="loading || pageNumber <= 1"
        :aria-label="t('components.editorPanel.previousPage')"
        @click="pageNumber--"
      >
        ‹
      </button>
      <span class="pdf-page-status">
        {{ t('components.editorPanel.pdfPageStatus', { page: pageNumber, pages: pageCount || 1 }) }}
      </span>
      <button
        type="button"
        :disabled="loading || pageNumber >= pageCount"
        :aria-label="t('components.editorPanel.nextPage')"
        @click="pageNumber++"
      >
        ›
      </button>
      <button
        type="button"
        :disabled="loading || scale <= MIN_SCALE"
        :aria-label="t('components.editorPanel.zoomOut')"
        @click="setScale(scale - SCALE_STEP)"
      >
        −
      </button>
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
      >
        +
      </button>
    </div>
    <div class="pdf-viewport">
      <div v-if="loading" class="pdf-message" role="status">{{ t('components.editorPanel.loadingPdf') }}</div>
      <div v-else-if="error" class="pdf-message pdf-error" role="alert">{{ error }}</div>
      <canvas v-show="!loading && !error" ref="canvasEl" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { i18n } from '../i18n';

const props = defineProps<{ src: string }>();
const t = i18n.global.t;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

const canvasEl = ref<HTMLCanvasElement>();
const pageNumber = ref(1);
const pageCount = ref(0);
const scale = ref(1);
const loading = ref(true);
const error = ref('');
let document: PDFDocumentProxy | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
let renderTask: RenderTask | undefined;
let loadVersion = 0;

function setScale(value: number): void {
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

async function renderPage(): Promise<void> {
  const pdf = document;
  const canvas = canvasEl.value;
  if (!pdf || !canvas) return;

  renderTask?.cancel();
  const page = await pdf.getPage(pageNumber.value);
  const viewport = page.getViewport({ scale: scale.value });
  const pixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('components.editorPanel.pdfRenderFailed'));

  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  });
  try {
    await renderTask.promise;
  } catch (renderError) {
    if ((renderError as Error).name !== 'RenderingCancelledException') throw renderError;
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
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({ url: props.src });
    loadingTask = task;
    const loadedDocument = await task.promise;
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

watch(() => props.src, () => void loadPdf(), { immediate: true });
watch([pageNumber, scale], () => {
  if (!loading.value && !error.value) void renderPage().catch((renderError) => {
    console.error('Failed to render PDF:', renderError);
    error.value = t('components.editorPanel.pdfRenderFailed');
  });
});

onUnmounted(() => {
  loadVersion++;
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
  z-index: 1;
  top: 0.75rem;
  left: 50%;
  display: flex;
  align-items: center;
  transform: translateX(-50%);
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
}

.pdf-toolbar button {
  height: 30px;
  min-width: 34px;
  padding: 0 0.55rem;
  border: 0;
  border-right: 1px solid var(--border-color);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
}

.pdf-toolbar button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.pdf-toolbar button:disabled {
  opacity: 0.45;
}

.pdf-page-status {
  min-width: 6rem;
  padding: 0 0.65rem;
  text-align: center;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.pdf-zoom-level {
  min-width: 58px !important;
}

.pdf-viewport {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 3.75rem 1rem 1rem;
  text-align: center;
}

.pdf-viewport canvas {
  display: inline-block;
  background: white;
  box-shadow: 0 2px 12px rgb(0 0 0 / 25%);
}

.pdf-message {
  margin-top: 2rem;
  color: var(--text-secondary);
}

.pdf-error {
  color: var(--error-color, #ef4444);
}
</style>
