<!-- client/src/components/EditorPanel.vue -->
<template>
  <div class="editor-panel" :class="panelClasses" :style="panelStyle">
    <div
      v-if="!isMaximized"
      class="editor-resize-handle"
      :class="{ 'is-resizing': isEditorResizing }"
      :title="t('components.editorPanel.resizeEditor')"
      @mousedown="startEditorResize"
    />
    <div class="editor-header" @dblclick.stop="toggleMaximize">
      <div class="editor-tabs">
        <div 
          v-for="tab in tabs"
          :key="tab.path"
          class="tab"
          :class="{ active: tab.path === activeTab }"
          @click="activeTab = tab.path"
          @contextmenu.prevent.stop="showTabContextMenu($event, tab.path)"
          @mouseenter="showTabTooltip($event, tab.path)"
          @mouseleave="hideTabTooltip"
          @focus="showTabTooltip($event, tab.path)"
          @blur="hideTabTooltip"
        >
          <PhPushPinSimple v-if="tab.pinned" class="tab-pin" :size="13" weight="fill" :aria-label="t('components.editorPanel.pinnedTab')" />
          <span>{{ tab.name }}{{ dirtyPaths.has(tab.path) ? ' •' : '' }}</span>
          <button @click.stop="closeTab(tab.path)"><PhX :size="14" /></button>
        </div>
      </div>
      <div
        v-if="tabTooltip.visible"
        class="editor-tab-tooltip"
        :style="{ left: `${tabTooltip.left}px`, top: `${tabTooltip.top}px` }"
      >
        {{ tabTooltip.text }}
      </div>
      <div class="editor-actions">
        <button
          class="window-btn tree-toggle-btn tooltip"
          @click="toggleFileTree"
          :data-tooltip="showTree ? t('components.editorPanel.hideFileTree') : t('components.editorPanel.showFileTree')"
          :aria-label="showTree ? t('components.editorPanel.hideFileTree') : t('components.editorPanel.showFileTree')"
          :aria-pressed="showTree"
        >
          <PhSidebarSimple :size="16" weight="bold" />
        </button>
        <div v-if="activeIsPreviewable" class="markdown-mode-toggle" role="group" :aria-label="activeViewModeLabel">
          <button
            :class="{ active: activePreviewMode === 'preview' }"
            @click="setActivePreviewMode('preview')"
            :title="activePreviewTitle"
          >
            {{ t('components.editorPanel.preview') }}
          </button>
          <button
            :class="{ active: activePreviewMode === 'edit' }"
            @click="setActivePreviewMode('edit')"
            :title="activeEditTitle"
          >
            {{ t('components.editorPanel.raw') }}
          </button>
        </div>
        <button class="window-btn tooltip" @click="$emit('close')" :data-tooltip="t('components.editorPanel.minimize')" :aria-label="t('components.editorPanel.minimizeEditor')">—</button>
        <button class="window-btn maximize-btn tooltip" @click="toggleMaximize" :data-tooltip="isMaximized ? t('components.editorPanel.restore') : t('components.editorPanel.maximize')" :aria-label="isMaximized ? t('components.editorPanel.restoreEditor') : t('components.editorPanel.maximizeEditor')">
          {{ isMaximized ? '❐' : '▢' }}
        </button>
        <button class="close-btn tooltip" @click="$emit('close')" :data-tooltip="t('components.editorPanel.close')"><PhX :size="16" weight="bold" /></button>
      </div>
    </div>

    <div v-if="statusMessage" class="editor-toast" :class="statusType" role="status" aria-live="polite">
      {{ statusMessage }}
    </div>
    
    <div class="editor-body">
      <div class="file-tree-pane" v-if="showTree" :style="fileTreePaneStyle">
        <div class="file-tree-toolbar">
          <button
            class="file-tree-toolbar-btn tooltip"
            @click="createNewFile()"
            :data-tooltip="t('components.editorPanel.newFile')"
            :aria-label="t('components.editorPanel.createNewFile')"
          >
            <PhFilePlus :size="15" />
          </button>
          <button
            class="file-tree-toolbar-btn tooltip"
            @click="createNewFolder()"
            :data-tooltip="t('components.editorPanel.newFolder')"
            :aria-label="t('components.editorPanel.createNewFolder')"
          >
            <PhFolderPlus :size="15" />
          </button>
          <button
            class="file-tree-toolbar-btn tooltip"
            @click="saveFile"
            :disabled="!activeTab || !activeIsDirty || isSaving"
            :data-tooltip="t('components.editorPanel.saveS')"
            :aria-label="t('components.editorPanel.saveActiveFile')"
          >
            <PhFloppyDisk :size="15" />
          </button>
          <button
            class="file-tree-toolbar-btn tooltip"
            @click="closeAllTabs"
            :disabled="!hasClosableTabs"
            :data-tooltip="t('components.editorPanel.closeAllUnpinnedTabs')"
            :aria-label="t('components.editorPanel.closeAllUnpinnedTabs')"
          >
            <PhX :size="15" />
          </button>
          <button
            class="file-tree-toolbar-btn tooltip"
            @click="handleRefresh"
            :data-tooltip="t('components.editorPanel.refresh')"
            :aria-label="t('components.editorPanel.refreshFiles')"
          >
            <PhArrowClockwise :size="15" />
          </button>
          <button
            class="file-tree-toolbar-btn tooltip"
            :class="{ active: showHiddenFiles }"
            @click="toggleHiddenFiles"
            :data-tooltip="showHiddenFiles ? t('components.editorPanel.hideHiddenFiles') : t('components.editorPanel.showHiddenFiles')"
            :aria-label="showHiddenFiles ? t('components.editorPanel.hideHiddenFilesAndFolders') : t('components.editorPanel.showHiddenFilesAndFolders')"
            :aria-pressed="showHiddenFiles"
          >
            <PhEyeSlash v-if="showHiddenFiles" :size="15" />
            <PhEye v-else :size="15" />
          </button>
          <button
            class="file-tree-toolbar-btn tooltip"
            @click="locateActiveFileInTree"
            :disabled="!activeTab"
            :data-tooltip="t('components.editorPanel.locateActiveFile')"
            :aria-label="t('components.editorPanel.locateActiveFileInFileTree')"
          >
            <PhCrosshair :size="15" />
          </button>
        </div>
        <div class="file-tree" ref="fileTreeEl">
          <TreeNode
            v-for="node in fileTree"
            :key="node.path"
            :node="node"
            :level="0"
            :expanded-paths="expandedPaths"
            :active-path="activeTab"
            :selected-directory-path="selectedDirectoryPath"
            @open="openFile"
            @toggle="toggleDirectory"
            @select-dir="selectedDirectoryPath = $event"
            @context-menu="showFileContextMenu"
          />
        </div>
        <div
          class="file-tree-resize-handle"
          :class="{ 'is-resizing': isFileTreeResizing }"
          :title="t('components.editorPanel.resizeFileTree')"
          @mousedown.prevent.stop="startFileTreeResize"
        />
      </div>
      <div v-if="showTree" class="file-tree-backdrop" @click="toggleFileTree" />
      
      <div
        v-if="activeIsMarkdown && activePreviewMode === 'preview'"
        ref="markdownPreviewEl"
        class="markdown-preview"
        :class="{ 'markdown-preview-light': resolvedTheme === 'light' }"
        v-html="activeMarkdownHtml"
        @click="handleMarkdownPreviewClick"
      ></div>
      <iframe
        v-else-if="activeIsHtml && activePreviewMode === 'preview'"
        class="html-preview"
        sandbox="allow-same-origin"
        :srcdoc="activeHtmlDocument"
        :title="t('components.editorPanel.htmlPreview')"
      ></iframe>
      <div v-else-if="activeImageSrc" class="image-preview">
        <div class="image-preview-toolbar" role="group" :aria-label="t('components.editorPanel.imageZoomControls')">
          <button
            type="button"
            :disabled="imageZoom <= MIN_IMAGE_ZOOM"
            :aria-label="t('components.editorPanel.zoomOut')"
            :title="t('components.editorPanel.zoomOut')"
            @click="zoomImage(-IMAGE_ZOOM_STEP)"
          >
            <PhMinus :size="16" weight="bold" />
          </button>
          <button
            type="button"
            class="image-zoom-level"
            :aria-label="t('components.editorPanel.resetImageZoom')"
            :title="t('components.editorPanel.fitImageToWindow')"
            @click="resetImageView"
          >
            {{ imageZoomPercent }}%
          </button>
          <button
            type="button"
            :disabled="imageZoom >= MAX_IMAGE_ZOOM"
            :aria-label="t('components.editorPanel.zoomIn')"
            :title="t('components.editorPanel.zoomIn')"
            @click="zoomImage(IMAGE_ZOOM_STEP)"
          >
            <PhPlus :size="16" weight="bold" />
          </button>
        </div>
        <div
          ref="imagePreviewEl"
          class="image-preview-viewport"
          :class="{ 'can-pan': imageZoom > 1, 'is-dragging': isImageDragging }"
          :title="t('components.editorPanel.imagePanHint')"
          @wheel.prevent="handleImageWheel"
          @pointerdown="handleImagePointerDown"
          @pointermove="handleImagePointerMove"
          @pointerup="handleImagePointerEnd"
          @pointercancel="handleImagePointerEnd"
          @dblclick="resetImageView"
        >
          <img
            ref="imageEl"
            :src="activeImageSrc"
            :alt="activeTab"
            :style="imageStyle"
            draggable="false"
            @load="resetImageView"
          />
        </div>
      </div>
      <div
        class="editor-container"
        :class="{ hidden: (activeIsPreviewable && activePreviewMode === 'preview') || !!activeImageSrc }"
        ref="editorContainer"
      ></div>
    </div>

    <div
      v-if="tabContextMenu.visible && contextTab"
      class="context-menu tab-context-menu"
      :style="{ left: `${tabContextMenu.left}px`, top: `${tabContextMenu.top}px` }"
      @click.stop
    >
      <button @click="addContextTabToReference">{{ t('components.editorPanel.addToReference') }}</button>
      <button @click="copyContextTabRelativePath">{{ t('components.editorPanel.copyRelativePath') }}</button>
      <button @click="downloadContextTab">{{ t('components.editorPanel.download') }}</button>
      <button @click="renameContextTab">{{ t('components.editorPanel.rename') }}</button>
      <button @click="closeContextTab">{{ t('components.editorPanel.close') }}</button>
      <button @click="closeAllTabs" :disabled="!hasClosableTabs">{{ t('components.editorPanel.closeAll') }}</button>
      <button @click="closeOtherTabs" :disabled="!hasCloseOtherTabs">{{ t('components.editorPanel.closeOthers') }}</button>
      <button v-if="contextTab.pinned" @click="unpinContextTab">{{ t('components.editorPanel.unpin') }}</button>
      <button v-else @click="pinContextTab">{{ t('components.editorPanel.pin') }}</button>
    </div>

    <div
      v-if="fileContextMenu.visible && fileContextMenu.node"
      class="context-menu file-context-menu"
      :style="{ left: `${fileContextMenu.left}px`, top: `${fileContextMenu.top}px` }"
      @click.stop
    >
      <button v-if="fileContextMenu.node.type === 'directory'" @click="createNewFileFromContext">
        {{ t('components.editorPanel.newFileHere') }}
      </button>
      <button v-if="fileContextMenu.node.type === 'directory'" @click="createNewFolderFromContext">
        {{ t('components.editorPanel.newFolderHere') }}
      </button>
      <button @click="copyPathFromContext('filename')">{{ t('components.editorPanel.copyFilename') }}</button>
      <button @click="copyPathFromContext('relative')">{{ t('components.editorPanel.copyRelativePath') }}</button>
      <button @click="copyPathFromContext('full')">{{ t('components.editorPanel.copyFullPath') }}</button>
      <button @click="downloadContextNode">{{ t('components.editorPanel.download') }}</button>
      <button
        v-if="fileContextMenu.node.type === 'file' && canOpenWithSystemTool"
        @click="openContextNodeWithSystemTool"
      >
        {{ t('components.editorPanel.openWithSystemTool') }}
      </button>
      <button v-if="fileContextMenu.node.type === 'file'" @click="cutContextNode">{{ t('components.editorPanel.cut') }}</button>
      <button
        v-if="fileContextMenu.node.type === 'directory' && cutFilePath"
        @click="pasteCutFileIntoContext"
      >
        Paste {{ basename(cutFilePath) }} here
      </button>
      <button @click="renameContextNode">{{ t('components.editorPanel.rename') }}</button>
      <button class="danger" @click="deleteContextNode">{{ t('components.editorPanel.delete') }}</button>
    </div>

    <InputPromptModal
      :visible="inputPrompt.visible"
      :title="inputPrompt.title"
      :label="inputPrompt.label"
      :description="inputPrompt.description"
      :model-value="inputPrompt.value"
      :confirm-text="inputPrompt.confirmText"
      @confirm="handleInputPromptConfirm"
      @cancel="handleInputPromptCancel"
    />

    <ConfirmModal
      :visible="confirmPrompt.visible"
      :variant="confirmPrompt.variant"
      :confirm-text="confirmPrompt.confirmText"
      :cancel-text="t('components.editorPanel.cancel')"
      @confirm="handleConfirmPromptConfirm"
      @cancel="handleConfirmPromptCancel"
    >
      <template #icon><PhTrash v-if="confirmPrompt.variant === 'danger'" :size="22" weight="duotone" /><PhWarning v-else :size="22" weight="duotone" /></template>
      <template #title>{{ confirmPrompt.title }}</template>
      <template #message>{{ confirmPrompt.message }}</template>
    </ConfirmModal>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, ref, watch, onMounted, onUnmounted, nextTick, type CSSProperties } from 'vue';
import * as monaco from 'monaco-editor';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import { PhX, PhArrowClockwise, PhFloppyDisk, PhCrosshair, PhEye, PhEyeSlash, PhFilePlus, PhFolderPlus, PhTrash, PhWarning, PhSidebarSimple, PhPushPinSimple, PhMinus, PhPlus } from '@phosphor-icons/vue';
import { Marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import { useTheme } from '../composables/useTheme';
import { normalizePathSeparators } from '../utils/paths';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import TreeNode, { type TreeNodeData } from './FileTreeNode.vue';
import ConfirmModal from './ConfirmModal.vue';
import InputPromptModal from './InputPromptModal.vue';

const t = i18n.global.t;

// Configure Monaco workers for Vite. Returning Worker instances directly avoids
// Monaco falling back to an undefined worker URL helper when a file is opened.
self.MonacoEnvironment = {
  getWorker: function (_workerId, label) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  }
};

monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
});
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
});
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  allowComments: true,
  comments: 'ignore',
});

const MAKEFILE_LANGUAGE_ID = 'makefile';
const DOTENV_LANGUAGE_ID = 'dotenv';
const IGNORE_LANGUAGE_ID = 'ignore';

if (!monaco.languages.getLanguages().some(language => language.id === IGNORE_LANGUAGE_ID)) {
  monaco.languages.register({
    id: IGNORE_LANGUAGE_ID,
    aliases: ['ignore', 'gitignore', 'dockerignore'],
    filenames: ['.gitignore', '.dockerignore'],
  });
  monaco.languages.setMonarchTokensProvider(IGNORE_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^!.*$/, 'keyword'],
        [/\*\*|\*|\?/, 'operator'],
        [/\[[^\]]+\]/, 'regexp'],
        [/\/$/, 'type.identifier'],
      ],
    },
  });
}

if (!monaco.languages.getLanguages().some(language => language.id === DOTENV_LANGUAGE_ID)) {
  monaco.languages.register({
    id: DOTENV_LANGUAGE_ID,
    aliases: ['dotenv', 'env'],
    filenames: ['.env', '.env.example', '.env.local', '.env.development', '.env.production', '.env.test'],
  });
  monaco.languages.setMonarchTokensProvider(DOTENV_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\s*export\b/, 'keyword'],
        [/^\s*(?:export\s+)?[A-Za-z_][\w.-]*(?=\s*=)/, 'variable.name'],
        [/=/, 'operator'],
        [/\$\{[^}]+\}|\$[A-Za-z_]\w*/, 'variable'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, 'string'],
      ],
    },
  });
}

if (!monaco.languages.getLanguages().some(language => language.id === MAKEFILE_LANGUAGE_ID)) {
  monaco.languages.register({
    id: MAKEFILE_LANGUAGE_ID,
    aliases: ['Makefile', 'makefile'],
    extensions: ['.mk'],
    filenames: ['Makefile', 'makefile', 'GNUmakefile', 'BSDmakefile'],
  });
  monaco.languages.setMonarchTokensProvider(MAKEFILE_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\t.*$/, 'string'],
        [/^[^\s:=#][^:=#]*:(?!=)/, 'type.identifier'],
        [/\$\([^)]+\)|\$\{[^}]+\}/, 'variable'],
        [/[:+?]?=/, 'operator'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, 'string'],
      ],
    },
  });
}

const defaultMarkdownRenderer = new Renderer();
const markdownRenderer = new Marked({
  renderer: {
    html(html) {
      return escapeHtml(String(html));
    },
    image(href, title, text) {
      return defaultMarkdownRenderer.image(resolveMarkdownImageHref(href), title, text);
    },
    code(code, language, escaped) {
      if (language?.trim().toLowerCase() === 'mermaid') {
        return `<div class="mermaid-diagram">${escapeHtml(code)}</div>`;
      }
      return defaultMarkdownRenderer.code(code, language, escaped);
    },
    heading(text, level, raw) {
      return `<h${level} id="${escapeHtml(markdownHeadingId(raw))}">${text}</h${level}>`;
    },
  },
});

const { resolvedTheme } = useTheme();

const props = defineProps<{
  visible: boolean;
  cwd: string;
  autoRefresh?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  addReference: [path: string];
}>();

interface Tab {
  name: string;
  path: string;
  kind: 'text' | 'image';
  virtual?: boolean;
  pinned?: boolean;
}

interface FileReadResponse {
  content?: string;
  error?: string;
  kind?: 'text' | 'image' | 'binary';
  message?: string;
  mtime?: number;
}

const tabs = ref<Tab[]>([]);
const activeTab = ref<string>();
const fileTree = ref<TreeNodeData[]>([]);
const showTree = ref(!isMobileViewport());
const showHiddenFiles = ref(false);
const expandedPaths = ref(new Set<string>());
const selectedDirectoryPath = ref<string>();
const dirtyPaths = ref(new Set<string>());
const cutFilePath = ref<string>();
type PreviewMode = 'preview' | 'edit';
const previewModes = ref(new Map<string, PreviewMode>());
const previewVersion = ref(0);
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'saving'>('success');
const isSaving = ref(false);
const editorContainer = ref<HTMLElement>();
const markdownPreviewEl = ref<HTMLElement>();
const fileTreeEl = ref<HTMLElement>();
const imagePreviewEl = ref<HTMLElement>();
const imageEl = ref<HTMLImageElement>();
const MIN_IMAGE_ZOOM = 0.25;
const MAX_IMAGE_ZOOM = 8;
const IMAGE_ZOOM_STEP = 0.25;
type ImagePoint = { x: number; y: number };
type ImagePinch = { distance: number; centerX: number; centerY: number };

const imageZoom = ref(1);
const imagePan = ref<ImagePoint>({ x: 0, y: 0 });
const isImageDragging = ref(false);
const imagePointers = new Map<number, ImagePoint>();
let imagePanStart: { pointerId: number; pointerX: number; pointerY: number; panX: number; panY: number } | undefined;
let imagePinch: ImagePinch | undefined;
const imageZoomPercent = computed(() => Math.round(imageZoom.value * 100));
const imageStyle = computed<CSSProperties>(() => ({
  left: `calc(50% + ${imagePan.value.x}px)`,
  top: `calc(50% + ${imagePan.value.y}px)`,
  transform: `translate(-50%, -50%) scale(${imageZoom.value})`,
}));
const defaultEditorWidth = '50vw';
const editorWidthPx = ref<number>();
const editorWidthCss = computed(() => editorWidthPx.value ? `${editorWidthPx.value}px` : defaultEditorWidth);
const isMaximized = ref(false);
const panelClasses = computed(() => ({
  visible: props.visible,
  maximized: isMaximized.value,
}));
const panelStyle = computed<CSSProperties>(() => {
  if (isMaximized.value) {
    return {
      position: 'fixed',
      top: '0',
      right: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '1200',
    };
  }

  return { '--editor-panel-width': editorWidthCss.value };
});
const minEditorWidth = 360;
const maxEditorWidthRatio = 0.85;
const minFileTreeWidth = 140;
const maxFileTreeWidth = 420;
const fileTreeWidthPx = ref(220);
const fileTreePaneStyle = computed<CSSProperties>(() => ({
  '--file-tree-pane-width': `${fileTreeWidthPx.value}px`,
}));
const tabTooltip = ref({
  visible: false,
  text: '',
  left: 0,
  top: 0,
});
const fileContextMenu = ref<{
  visible: boolean;
  left: number;
  top: number;
  node?: TreeNodeData;
}>({
  visible: false,
  left: 0,
  top: 0,
});
const tabContextMenu = ref<{
  visible: boolean;
  left: number;
  top: number;
  tabPath?: string;
}>({
  visible: false,
  left: 0,
  top: 0,
});
const inputPrompt = ref({
  visible: false,
  title: '',
  label: '',
  description: '',
  value: '',
  confirmText: t('components.editorPanel.continue'),
});
const confirmPrompt = ref({
  visible: false,
  title: '',
  message: '',
  confirmText: t('components.editorPanel.confirm'),
  variant: 'primary' as 'danger' | 'warning' | 'primary',
});
let inputPromptResolve: ((value: string | null) => void) | undefined;
let confirmPromptResolve: ((value: boolean) => void) | undefined;

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let statusClearTimer: ReturnType<typeof setTimeout> | undefined;
let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
const models = new Map<string, monaco.editor.ITextModel>();
const modelListeners = new Map<string, monaco.IDisposable>();
const fileTimestamps = new Map<string, number>();
const gitChanges = ref(new Map<string, GitChangeRange[]>());
let gitChangeDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let diffDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
const activeIsDirty = computed(() => !!activeTab.value && dirtyPaths.value.has(activeTab.value));
const activeTabInfo = computed(() => tabs.value.find(tab => tab.path === activeTab.value));
const activeIsVirtual = computed(() => !!activeTabInfo.value?.virtual);
const contextTab = computed(() => tabs.value.find(tab => tab.path === tabContextMenu.value.tabPath));
const closableTabPaths = computed(() => tabs.value.filter(tab => !tab.pinned).map(tab => tab.path));
const closeOtherTabPaths = computed(() => tabs.value
  .filter(tab => !tab.pinned && tab.path !== tabContextMenu.value.tabPath)
  .map(tab => tab.path));
const hasClosableTabs = computed(() => closableTabPaths.value.length > 0);
const hasCloseOtherTabs = computed(() => closeOtherTabPaths.value.length > 0);
const activeImageSrc = computed(() => activeTabInfo.value?.kind === 'image' && activeTab.value
  ? `/api/files/raw?path=${encodeURIComponent(activeTab.value)}`
  : '');
const activeIsMarkdown = computed(() => !!activeTab.value && activeTabInfo.value?.kind === 'text' && isMarkdownFile(activeTab.value));
const activeIsHtml = computed(() => !!activeTab.value && activeTabInfo.value?.kind === 'text' && isHtmlFile(activeTab.value));
const activeIsPreviewable = computed(() => activeIsMarkdown.value || activeIsHtml.value);
const activePreviewMode = computed(() => activeTab.value ? (previewModes.value.get(activeTab.value) || 'preview') : 'preview');
const activeViewModeLabel = computed(() => t(activeIsHtml.value
  ? 'components.editorPanel.htmlViewMode'
  : 'components.editorPanel.markdownViewMode'));
const activePreviewTitle = computed(() => t(activeIsHtml.value
  ? 'components.editorPanel.previewHtml'
  : 'components.editorPanel.previewMarkdown'));
const activeEditTitle = computed(() => t(activeIsHtml.value
  ? 'components.editorPanel.editHtmlSource'
  : 'components.editorPanel.editMarkdownSource'));
const activeMarkdownHtml = computed(() => {
  previewVersion.value;
  const filePath = activeTab.value;
  if (!filePath) return '';
  const model = models.get(filePath);
  if (!model) return '';
  return sanitizeHtmlFragment(renderMarkdownPreview(model.getValue()));
});
const activeHtmlDocument = computed(() => {
  previewVersion.value;
  const filePath = activeTab.value;
  const model = filePath ? models.get(filePath) : undefined;
  return filePath && model ? renderHtmlPreview(model.getValue(), filePath) : '';
});
const canOpenWithSystemTool = isLocalHostname(window.location.hostname);

function resolveMarkdownImageHref(href: string): string {
  if (!activeTab.value || !href || href.startsWith('/') || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) {
    return href;
  }

  const suffixIndex = href.search(/[?#]/);
  const encodedPath = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : href.slice(suffixIndex);
  let imagePath = encodedPath;
  try {
    imagePath = decodeURIComponent(encodedPath);
  } catch {
    // Keep malformed escapes unchanged; the raw endpoint will return a normal file error.
  }

  const resolvedPath = resolveNewFilePath(imagePath, dirname(activeTab.value));
  return `/api/files/raw?path=${encodeURIComponent(resolvedPath)}${suffix}`;
}

const markdownHeadingCounts = new Map<string, number>();

function markdownHeadingId(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-');
  const count = markdownHeadingCounts.get(base) || 0;
  markdownHeadingCounts.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

function renderMarkdownPreview(markdown: string): string {
  markdownHeadingCounts.clear();
  const frontmatter = parseFrontmatter(markdown);
  if (!frontmatter) return markdownRenderer.parse(markdown) as string;

  const metadataRows = frontmatter.metadata
    .map(({ key, value }) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const metadataTable = metadataRows
    ? `<table class="markdown-frontmatter"><tbody>${metadataRows}</tbody></table>`
    : '';

  return `${metadataTable}${markdownRenderer.parse(frontmatter.body) as string}`;
}

let mermaidRenderVersion = 0;

async function renderMermaidDiagrams(): Promise<void> {
  const preview = markdownPreviewEl.value;
  if (!preview) return;
  const diagrams = Array.from(preview.querySelectorAll<HTMLElement>('.mermaid-diagram'));
  if (!diagrams.length) return;

  const renderVersion = ++mermaidRenderVersion;
  // Mermaid is large, so load it only when a preview actually contains a diagram.
  const { default: mermaid } = await import('mermaid');
  if (renderVersion !== mermaidRenderVersion || preview !== markdownPreviewEl.value) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: resolvedTheme.value === 'light' ? 'default' : 'dark',
    // Mermaid 11 reads this globally when creating node labels.
    // Native SVG text survives sanitization; HTML foreignObject labels do not.
    htmlLabels: false,
  });

  for (const [index, diagram] of diagrams.entries()) {
    const source = diagram.dataset.mermaidSource || diagram.textContent || '';
    diagram.dataset.mermaidSource = source;
    try {
      const { svg, bindFunctions } = await mermaid.render(`editor-mermaid-${renderVersion}-${index}`, source);
      if (renderVersion !== mermaidRenderVersion || preview !== markdownPreviewEl.value || !preview.contains(diagram)) return;
      diagram.innerHTML = sanitizeHtmlFragment(svg);
      bindFunctions?.(diagram);
    } catch {
      // Keep invalid Mermaid source visible so users can correct it in edit mode.
      diagram.replaceChildren(Object.assign(document.createElement('pre'), {
        className: 'mermaid-error',
        textContent: source,
      }));
    }
  }
}

function isLocalMarkdownHref(href: string): boolean {
  if (href.startsWith('#')) return true;
  return !href.startsWith('/') && !href.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(href);
}

async function handleMarkdownPreviewClick(event: MouseEvent): Promise<void> {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  const href = link?.getAttribute('href');
  if (!href || !isLocalMarkdownHref(href)) return;

  event.preventDefault();
  const hashIndex = href.indexOf('#');
  const encodedPath = (hashIndex === -1 ? href : href.slice(0, hashIndex)).split('?')[0];
  const encodedHeading = hashIndex === -1 ? '' : href.slice(hashIndex + 1);
  let linkedPath = encodedPath;
  let headingId = encodedHeading;
  try {
    linkedPath = decodeURIComponent(encodedPath);
    headingId = decodeURIComponent(encodedHeading);
  } catch {
    // Keep malformed escapes unchanged so the file API can report a normal error.
  }

  if (linkedPath && activeTab.value) {
    const targetPath = resolveNewFilePath(linkedPath, dirname(activeTab.value));
    await openFile(targetPath);
    if (activeTab.value !== targetPath) return;
  }

  if (!headingId) return;
  await nextTick();
  const heading = Array.from(markdownPreviewEl.value?.querySelectorAll<HTMLElement>('[id]') || [])
    .find(element => element.id === headingId);
  heading?.scrollIntoView({ block: 'start' });
}

function parseFrontmatter(markdown: string): { metadata: Array<{ key: string; value: string }>; body: string } | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return null;

  const metadata = match[1]
    .split(/\r?\n/)
    .map(line => line.match(/^([^:#][^:]*):\s*(.*)$/))
    .filter((line): line is RegExpMatchArray => Boolean(line))
    .map(line => ({ key: line[1].trim(), value: line[2].trim() }));

  return { metadata, body: match[2] };
}

function sanitizeHtmlFragment(html: string): string {
  // DOMPurify 3.4.13 can drop top-level structural wrappers under happy-dom.
  // A neutral wrapper preserves the intended sanitized fragment contents.
  return DOMPurify.sanitize(`<section>${html}</section>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function monacoLanguageForFile(filePath: string): string | undefined {
  const lowerPath = filePath.toLowerCase();
  const filename = lowerPath.split(/[\\/]/).pop() || '';

  if (filename === 'makefile' || filename === 'gnumakefile' || filename === 'bsdmakefile' || filename.endsWith('.mk')) {
    return MAKEFILE_LANGUAGE_ID;
  }
  if (filename === '.env' || filename.startsWith('.env.') || filename.endsWith('.env')) {
    return DOTENV_LANGUAGE_ID;
  }
  if (filename === '.gitignore' || filename === '.dockerignore') {
    return IGNORE_LANGUAGE_ID;
  }
  return lowerPath.endsWith('.vue') ? 'html' : undefined;
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkdn|mdx)$/i.test(filePath);
}

function isHtmlFile(filePath: string): boolean {
  return /\.html?$/i.test(filePath);
}

function isPreviewableFile(filePath: string): boolean {
  return isMarkdownFile(filePath) || isHtmlFile(filePath);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function renderHtmlPreview(html: string, filePath: string): string {
  const root = encodeBase64Url(dirname(filePath));
  const document = new DOMParser().parseFromString(html, 'text/html');

  // srcdoc has no filesystem-relative URL base, so local resources must go
  // through the authenticated preview endpoint.
  function rewriteAttribute(element: Element, attribute: string): void {
    const value = element.getAttribute(attribute);
    if (!value || value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return;

    const assetPath = value.split(/[?#]/, 1)[0].replace(/^[/\\]+/, '');
    if (!assetPath) return;
    const params = new URLSearchParams({ root, path: assetPath });
    element.setAttribute(attribute, `/api/files/preview-asset?${params}`);
  }

  document.querySelectorAll('[src]').forEach(element => rewriteAttribute(element, 'src'));
  document.querySelectorAll('[poster]').forEach(element => rewriteAttribute(element, 'poster'));
  document.querySelectorAll('link[href]').forEach(element => rewriteAttribute(element, 'href'));

  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  const previewOrigin = window.location.origin;
  policy.content = `default-src 'none'; style-src ${previewOrigin} 'unsafe-inline' data: blob:; img-src ${previewOrigin} data: blob:; font-src ${previewOrigin} data:; media-src ${previewOrigin} data: blob:; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'`;
  document.head.prepend(policy);

  const doctype = /^\s*<!doctype\s+html[^>]*>/i.test(html) ? '<!DOCTYPE html>' : '';
  return `${doctype}${document.documentElement.outerHTML}`;
}

function clampImagePan(pan = imagePan.value): { x: number; y: number } {
  const viewport = imagePreviewEl.value;
  const image = imageEl.value;
  if (!viewport || !image) return pan;

  const maxX = Math.max(0, (image.offsetWidth * imageZoom.value - viewport.clientWidth) / 2);
  const maxY = Math.max(0, (image.offsetHeight * imageZoom.value - viewport.clientHeight) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

function setImageZoom(nextZoom: number, focalPoint?: { x: number; y: number }): void {
  const previousZoom = imageZoom.value;
  const zoom = Math.max(MIN_IMAGE_ZOOM, Math.min(MAX_IMAGE_ZOOM, nextZoom));
  if (zoom === previousZoom) return;

  if (focalPoint && imagePreviewEl.value) {
    const bounds = imagePreviewEl.value.getBoundingClientRect();
    const pointX = focalPoint.x - bounds.left - bounds.width / 2;
    const pointY = focalPoint.y - bounds.top - bounds.height / 2;
    const zoomRatio = zoom / previousZoom;
    // Offset the pan so the pixel beneath the pointer stays stationary while zooming.
    imagePan.value = {
      x: pointX - (pointX - imagePan.value.x) * zoomRatio,
      y: pointY - (pointY - imagePan.value.y) * zoomRatio,
    };
  }

  imageZoom.value = zoom;
  imagePan.value = clampImagePan();
}

function zoomImage(amount: number): void {
  setImageZoom(imageZoom.value + amount);
}

function handleImageWheel(event: WheelEvent): void {
  setImageZoom(
    imageZoom.value + (event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP),
    { x: event.clientX, y: event.clientY },
  );
}

function resetImageView(): void {
  imageZoom.value = 1;
  imagePan.value = { x: 0, y: 0 };
  isImageDragging.value = false;
  imagePointers.clear();
  imagePanStart = undefined;
  imagePinch = undefined;
}

function getImagePinch(): ImagePinch | undefined {
  const [first, second] = imagePointers.values();
  if (!first || !second) return undefined;
  return {
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    centerX: (first.x + second.x) / 2,
    centerY: (first.y + second.y) / 2,
  };
}

function startImagePan(pointerId: number, pointer: ImagePoint): void {
  imagePanStart = {
    pointerId,
    pointerX: pointer.x,
    pointerY: pointer.y,
    panX: imagePan.value.x,
    panY: imagePan.value.y,
  };
  isImageDragging.value = true;
}

function handleImagePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const pointer = { x: event.clientX, y: event.clientY };
  imagePointers.set(event.pointerId, pointer);
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

  if (imagePointers.size === 2) {
    imagePinch = getImagePinch();
    imagePanStart = undefined;
    isImageDragging.value = false;
  } else if (imagePointers.size === 1 && imageZoom.value > 1) {
    startImagePan(event.pointerId, pointer);
  }
}

function handleImagePointerMove(event: PointerEvent): void {
  if (!imagePointers.has(event.pointerId)) return;
  imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (imagePinch) {
    const pinch = getImagePinch();
    if (!pinch) return;
    if (imagePinch.distance > 0) {
      // Moving the pinch center and then zooming around it keeps the touched image point under the fingers.
      imagePan.value = {
        x: imagePan.value.x + pinch.centerX - imagePinch.centerX,
        y: imagePan.value.y + pinch.centerY - imagePinch.centerY,
      };
      setImageZoom(imageZoom.value * pinch.distance / imagePinch.distance, {
        x: pinch.centerX,
        y: pinch.centerY,
      });
    }
    imagePinch = pinch;
    return;
  }

  if (!imagePanStart || imagePanStart.pointerId !== event.pointerId) return;
  imagePan.value = clampImagePan({
    x: imagePanStart.panX + event.clientX - imagePanStart.pointerX,
    y: imagePanStart.panY + event.clientY - imagePanStart.pointerY,
  });
}

function handleImagePointerEnd(event: PointerEvent): void {
  if (!imagePointers.delete(event.pointerId)) return;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

  if (imagePinch) {
    imagePinch = getImagePinch();
    if (imagePinch) return;

    const [remaining] = imagePointers.entries();
    if (remaining && imageZoom.value > 1) startImagePan(...remaining);
    else {
      imagePanStart = undefined;
      isImageDragging.value = false;
    }
    return;
  }

  if (imagePanStart?.pointerId === event.pointerId) imagePanStart = undefined;
  if (!imagePanStart) isImageDragging.value = false;
}

function setActivePreviewMode(mode: PreviewMode) {
  if (!activeTab.value) return;
  const nextModes = new Map(previewModes.value);
  nextModes.set(activeTab.value, mode);
  previewModes.value = nextModes;
  if (mode === 'edit') nextTick(() => editor?.layout());
}

type GitChangeType = 'added' | 'modified' | 'deleted';

interface GitChangeRange {
  start: number;
  end: number;
  type: GitChangeType;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
}

function requestInput(options: {
  title: string;
  label: string;
  description?: string;
  value?: string;
  confirmText?: string;
}) {
  inputPromptResolve?.(null);
  inputPrompt.value = {
    visible: true,
    title: options.title,
    label: options.label,
    description: options.description || '',
    value: options.value || '',
    confirmText: options.confirmText || t('components.editorPanel.continue'),
  };
  return new Promise<string | null>((resolve) => {
    inputPromptResolve = resolve;
  });
}

function handleInputPromptConfirm(value: string) {
  inputPrompt.value.visible = false;
  inputPromptResolve?.(value);
  inputPromptResolve = undefined;
}

function handleInputPromptCancel() {
  inputPrompt.value.visible = false;
  inputPromptResolve?.(null);
  inputPromptResolve = undefined;
}

function requestConfirm(options: {
  title: string;
  message: string;
  confirmText: string;
  variant?: 'danger' | 'warning' | 'primary';
}) {
  confirmPromptResolve?.(false);
  confirmPrompt.value = {
    visible: true,
    title: options.title,
    message: options.message,
    confirmText: options.confirmText,
    variant: options.variant || 'primary',
  };
  return new Promise<boolean>((resolve) => {
    confirmPromptResolve = resolve;
  });
}

function handleConfirmPromptConfirm() {
  confirmPrompt.value.visible = false;
  confirmPromptResolve?.(true);
  confirmPromptResolve = undefined;
}

function handleConfirmPromptCancel() {
  confirmPrompt.value.visible = false;
  confirmPromptResolve?.(false);
  confirmPromptResolve = undefined;
}

function normalizeTreePaths(nodes: TreeNodeData[]): TreeNodeData[] {
  return nodes.map(node => ({
    ...node,
    path: normalizePathSeparators(node.path),
    linkTarget: node.linkTarget ? normalizePathSeparators(node.linkTarget) : undefined,
    children: node.children ? normalizeTreePaths(node.children) : undefined,
  }));
}

async function loadFileTree(path = props.cwd): Promise<TreeNodeData[]> {
  try {
    const params = new URLSearchParams({
      path: normalizePathSeparators(path || '~'),
      depth: '1',
      hidden: showHiddenFiles.value ? 'true' : 'false',
    });
    const response = await fetch(`/api/files/tree?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return normalizeTreePaths(data.tree || []);
  } catch (error) {
    console.error(t('components.editorPanel.failedToLoadFileTree'), error);
    return [];
  }
}

function clampEditorWidth(width: number): number {
  const maxEditorWidth = Math.max(minEditorWidth, Math.floor(window.innerWidth * maxEditorWidthRatio));
  return Math.min(maxEditorWidth, Math.max(minEditorWidth, width));
}

function getCurrentEditorWidth(): number {
  return editorWidthPx.value || window.innerWidth * 0.5;
}

const isEditorResizing = ref(false);
const isFileTreeResizing = ref(false);

function stopEditorResize() {
  isEditorResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', handleEditorResize);
  window.removeEventListener('mouseup', stopEditorResize);
  window.removeEventListener('blur', stopEditorResize);
}

function stopFileTreeResize() {
  isFileTreeResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', handleFileTreeResize);
  window.removeEventListener('mouseup', stopFileTreeResize);
  window.removeEventListener('blur', stopFileTreeResize);
}

let resizeStartX = 0;
let resizeStartWidth = 0;
let fileTreeResizeStartX = 0;
let fileTreeResizeStartWidth = 0;

function handleEditorResize(event: MouseEvent) {
  const delta = resizeStartX - event.clientX;
  editorWidthPx.value = clampEditorWidth(resizeStartWidth + delta);
  editor?.layout();
}

function startEditorResize(event: MouseEvent) {
  event.preventDefault();
  isEditorResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = getCurrentEditorWidth();
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', handleEditorResize);
  window.addEventListener('mouseup', stopEditorResize);
  window.addEventListener('blur', stopEditorResize);
}

function clampFileTreeWidth(width: number): number {
  return Math.min(maxFileTreeWidth, Math.max(minFileTreeWidth, width));
}

function handleFileTreeResize(event: MouseEvent) {
  const delta = event.clientX - fileTreeResizeStartX;
  fileTreeWidthPx.value = clampFileTreeWidth(fileTreeResizeStartWidth + delta);
  nextTick(() => editor?.layout());
}

function startFileTreeResize(event: MouseEvent) {
  isFileTreeResizing.value = true;
  fileTreeResizeStartX = event.clientX;
  fileTreeResizeStartWidth = fileTreeWidthPx.value;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', handleFileTreeResize);
  window.addEventListener('mouseup', stopFileTreeResize);
  window.addEventListener('blur', stopFileTreeResize);
}

function toggleMaximize() {
  isMaximized.value = !isMaximized.value;
  nextTick(() => editor?.layout());
}

function normalizePathForCompare(path: string): string {
  const normalized = normalizePathSeparators(path);
  if (normalized === '~') return '~/';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizePath(path: string): string {
  const normalized = normalizePathSeparators(path);
  if (normalized === '/') return normalized;
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return index === 0 ? '/' : '';
  return normalized.slice(0, index);
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function directoryChainForFile(filePath: string): string[] {
  const cwd = normalizePath(props.cwd || '');
  const directories: string[] = [];
  let current = dirname(filePath);

  while (current && current !== cwd && current !== dirname(current)) {
    directories.unshift(current);
    current = dirname(current);
  }

  return directories;
}

function findTreeNodeByPath(nodes: TreeNodeData[], path: string): TreeNodeData | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = node.children ? findTreeNodeByPath(node.children, path) : undefined;
    if (child) return child;
  }
}

function relativePathFromCwd(filePath: string): string {
  const cwd = props.cwd || '';
  const normalizedFilePath = normalizePathSeparators(filePath);
  if (!cwd || cwd === '~') return normalizedFilePath;

  const normalizedCwd = normalizePathForCompare(cwd);
  if (normalizedFilePath.startsWith(normalizedCwd)) {
    return normalizedFilePath.slice(normalizedCwd.length);
  }

  return normalizedFilePath;
}

function relativePathForGit(filePath: string): string {
  return relativePathFromCwd(filePath);
}

function tabTooltipPath(filePath: string): string {
  return normalizePathSeparators(filePath);
}

function rootDirectory(): string {
  return normalizePath(props.cwd || '~');
}

function resolveNewFilePath(input: string, targetDirectory = selectedDirectoryPath.value || rootDirectory()): string {
  const trimmed = input.trim().replace(/^\.\//, '');
  if (trimmed.startsWith('/') || trimmed.startsWith('~/')) return trimmed;

  const baseDirectory = normalizePath(targetDirectory);
  if (baseDirectory === '~') return `~/${trimmed}`;
  if (baseDirectory === '/') return `/${trimmed}`;
  return `${baseDirectory}/${trimmed}`;
}

function resolveRenamePath(input: string, originalPath: string): string {
  const trimmed = input.trim().replace(/^\.\//, '');
  if (trimmed.startsWith('/') || trimmed.startsWith('~/')) return trimmed;
  return resolveNewFilePath(trimmed, dirname(originalPath));
}

function showTabTooltip(event: MouseEvent | FocusEvent, filePath: string) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  tabTooltip.value = {
    visible: true,
    text: tabTooltipPath(filePath),
    left: rect.left + rect.width / 2,
    top: rect.bottom + 6,
  };
}

function hideTabTooltip() {
  tabTooltip.value = {
    ...tabTooltip.value,
    visible: false,
  };
}

function clearStatusTimer() {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = undefined;
  }
}

function clearStatus() {
  clearStatusTimer();
  statusMessage.value = '';
}

function scheduleStatusClear() {
  clearStatusTimer();
  statusClearTimer = setTimeout(() => {
    statusMessage.value = '';
    statusClearTimer = undefined;
  }, 2000);
}

function gitChangeClass(type: GitChangeType) {
  if (type === 'added') return 'git-change-added';
  if (type === 'deleted') return 'git-change-deleted';
  return 'git-change-modified';
}

function gitChangeColor(type: GitChangeType) {
  const styles = getComputedStyle(document.documentElement);
  if (type === 'added') return styles.getPropertyValue('--git-added').trim() || '#3fb950';
  if (type === 'deleted') return styles.getPropertyValue('--git-deleted').trim() || '#f85149';
  return styles.getPropertyValue('--git-modified').trim() || '#d29922';
}

function diffLineClass(line: string): string | undefined {
  if (line.startsWith('@@')) return 'git-diff-hunk';
  if (/^(diff --git|index |---|\+\+\+|new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line)) {
    return 'git-diff-meta';
  }
  if (line.startsWith('+')) return 'git-diff-added';
  if (line.startsWith('-')) return 'git-diff-removed';
  return undefined;
}

function applyDiffDecorations(filePath = activeTab.value): void {
  if (!editor || !filePath || !tabs.value.find(tab => tab.path === filePath)?.virtual) {
    diffDecorations?.clear();
    return;
  }

  const model = models.get(filePath);
  const currentModel = typeof editor.getModel === 'function' ? editor.getModel() : model;
  if (!model || currentModel !== model) {
    diffDecorations?.clear();
    return;
  }

  const decorations = [];
  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
    const className = diffLineClass(model.getLineContent(lineNumber));
    if (!className) continue;
    decorations.push({
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: { isWholeLine: true, className },
    });
  }

  if (!diffDecorations && editor.createDecorationsCollection) {
    diffDecorations = editor.createDecorationsCollection();
  }
  diffDecorations?.set(decorations);
}

function applyGitChangeDecorations(filePath = activeTab.value) {
  if (!editor || !filePath) return;

  const model = models.get(filePath);
  const currentModel = typeof editor.getModel === 'function' ? editor.getModel() : model;
  if (!model || currentModel !== model) {
    gitChangeDecorations?.clear();
    return;
  }

  const ranges = gitChanges.value.get(relativePathForGit(filePath)) || [];
  const lineCount = typeof model.getLineCount === 'function' ? model.getLineCount() : Number.MAX_SAFE_INTEGER;
  const decorations = ranges.map((change) => {
    const start = Math.min(lineCount, Math.max(1, change.start));
    const end = Math.min(lineCount, Math.max(start, change.end));
    return {
      range: new monaco.Range(start, 1, end, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: gitChangeClass(change.type),
        overviewRuler: {
          color: gitChangeColor(change.type),
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    };
  });

  if (!gitChangeDecorations && editor.createDecorationsCollection) {
    gitChangeDecorations = editor.createDecorationsCollection();
  }

  gitChangeDecorations?.set(decorations);
}

async function refreshGitChanges() {
  if (!props.cwd || props.cwd === '~') {
    gitChanges.value = new Map();
    applyGitChangeDecorations();
    return;
  }

  try {
    const params = new URLSearchParams({ cwd: props.cwd });
    const response = await fetch(`/api/git/changes?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    gitChanges.value = new Map(Object.entries(data.changes || {}) as [string, GitChangeRange[]][]);
  } catch {
    gitChanges.value = new Map();
  }

  applyGitChangeDecorations();
}

async function reloadRootTree() {
  clearStatusTimer();
  modelListeners.forEach(listener => listener.dispose());
  modelListeners.clear();
  models.forEach(model => model.dispose());
  models.clear();
  tabs.value = [];
  activeTab.value = undefined;
  dirtyPaths.value = new Set();
  previewModes.value = new Map();
  previewVersion.value++;
  gitChanges.value = new Map();
  gitChangeDecorations?.clear();
  diffDecorations?.clear();
  clearStatus();
  expandedPaths.value = new Set();
  selectedDirectoryPath.value = undefined;
  fileTree.value = await loadFileTree(props.cwd);
  await refreshGitChanges();

  const activePath = activeTab.value;
  if (activePath && models.has(activePath)) {
    editor?.setModel(models.get(activePath) || null);
    return;
  }

  editor?.setModel(null);
}

function openFileErrorMessage(filePath: string, status: number, data: FileReadResponse): string {
  let serverMessage = '';
  if (typeof data.error === 'string') {
    serverMessage = data.error;
  } else if (typeof data.message === 'string') {
    serverMessage = data.message;
  }

  if (status === 404 || /ENOENT|not found/i.test(serverMessage)) {
    return t('components.editorPanel.fileDoesNotExist', { path: filePath });
  }

  return serverMessage || t('components.editorPanel.openFailedStatus', { status });
}

// Keep virtual diffs outside the filesystem path namespace so file actions never target them.
function virtualDiffPath(cwd: string, scope: string): string {
  return `git-diff://${encodeURIComponent(cwd)}/${scope}`;
}

function openVirtualDiff({ cwd, scope, content }: { cwd: string; scope: string; content: string }): void {
  const path = virtualDiffPath(cwd, scope);
  const existing = tabs.value.find(tab => tab.path === path);
  const model = models.get(path);

  if (model) {
    model.setValue(content);
  } else {
    const nextModel = monaco.editor.createModel(content, 'diff', monaco.Uri.parse(path));
    models.set(path, nextModel);
  }

  if (!existing) {
    tabs.value.push({ name: t('components.editorPanel.gitDiffScope', { scope }), path, kind: 'text', virtual: true });
  }

  activeTab.value = path;
  collapseFileTreeOnMobile();
  nextTick(() => {
    editor?.focus();
    applyDiffDecorations(path);
  });
}

async function openFile(filePath: string, line?: number, column?: number) {
  filePath = normalizePathSeparators(filePath);
  selectedDirectoryPath.value = dirname(filePath) || rootDirectory();

  const existing = tabs.value.find(t => t.path === filePath);
  if (existing) {
    activeTab.value = filePath;
    collapseFileTreeOnMobile();
    if (existing.kind === 'text') {
      // Refresh file content if it changed on disk
      await refreshFile(filePath);
      revealPosition(line, column);
    }
    return;
  }

  try {
    const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
    const data = await response.json().catch(() => ({})) as FileReadResponse;

    if (response.status === 415) {
      if (data.kind === 'image') {
        tabs.value.push({
          name: basename(filePath),
          path: filePath,
          kind: 'image',
        });
        activeTab.value = filePath;
        collapseFileTreeOnMobile();
        if (data.mtime) fileTimestamps.set(filePath, data.mtime);
        return;
      }

      statusType.value = 'error';
      statusMessage.value = data.error || t('components.editorPanel.unsupportedFileType');
      scheduleStatusClear();
      return;
    }
    if (!response.ok) {
      statusType.value = 'error';
      statusMessage.value = openFileErrorMessage(filePath, response.status, data);
      scheduleStatusClear();
      return;
    }
    
    const model = monaco.editor.createModel(data.content!, monacoLanguageForFile(filePath), monaco.Uri.file(filePath));
    const listener = model.onDidChangeContent(() => markDirty(filePath));
    
    models.set(filePath, model);
    modelListeners.set(filePath, listener);
    if (data.mtime) fileTimestamps.set(filePath, data.mtime);
    tabs.value.push({
      name: basename(filePath),
      path: filePath,
      kind: 'text',
    });
    
    activeTab.value = filePath;
    collapseFileTreeOnMobile();
    
    if (editor) {
      editor.setModel(model);
      editor.layout();
      await refreshGitChanges();
      revealPosition(line, column);
    }
  } catch (error) {
    console.error(t('components.editorPanel.failedToOpenFile'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.openFailed');
    scheduleStatusClear();
  }
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function toggleFileTree() {
  showTree.value = !showTree.value;
  void nextTick(() => editor?.layout());
}

function collapseFileTreeOnMobile() {
  if (!isMobileViewport()) return;
  showTree.value = false;
  void nextTick(() => editor?.layout());
}

function revealPosition(line?: number, column?: number) {
  if (!editor || line == null) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: column ?? 1 });
  editor.focus();
}

function markDirty(filePath: string) {
  const nextDirtyPaths = new Set(dirtyPaths.value);
  nextDirtyPaths.add(filePath);
  dirtyPaths.value = nextDirtyPaths;
  if (isPreviewableFile(filePath)) previewVersion.value++;
  clearStatus();
}

function clearDirty(filePath: string) {
  const nextDirtyPaths = new Set(dirtyPaths.value);
  nextDirtyPaths.delete(filePath);
  dirtyPaths.value = nextDirtyPaths;
}

async function openFileWithSystemTool(filePath: string): Promise<void> {
  try {
    const response = await fetch('/api/files/open-system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    statusType.value = 'success';
    statusMessage.value = t('components.editorPanel.openedWithSystemTool');
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToOpenFileWithSystemTool'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.openFailed');
    scheduleStatusClear();
  }
}

async function openActiveFileWithSystemTool(): Promise<void> {
  if (!activeTab.value) return;
  await openFileWithSystemTool(activeTab.value);
}

async function openContextNodeWithSystemTool(): Promise<void> {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (node?.type !== 'file') return;
  await openFileWithSystemTool(node.path);
}

async function saveFile() {
  if (!activeTab.value || activeIsVirtual.value || !editor || isSaving.value) return;
  
  const filePath = activeTab.value;
  const content = editor.getValue();
  isSaving.value = true;
  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Saving...';

  try {
    const response = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.mtime) fileTimestamps.set(filePath, data.mtime);
    clearDirty(filePath);
    await refreshGitChanges();
    statusType.value = 'success';
    statusMessage.value = 'Saved';
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToSaveFile'), error);
    clearStatusTimer();
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.saveFailed');
  } finally {
    isSaving.value = false;
  }
}

async function refreshFile(filePath: string): Promise<boolean> {
  const model = models.get(filePath);
  if (!model) return false;

  try {
    const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
    if (!response.ok) return false;
    const data = await response.json();

    const newMtime = data.mtime ?? 0;
    const oldMtime = fileTimestamps.get(filePath) ?? 0;

    // Skip if file hasn't changed
    if (newMtime && newMtime <= oldMtime) return false;

    // Check if model content differs from server
    if (model.getValue() === data.content) {
      if (newMtime) fileTimestamps.set(filePath, newMtime);
      return false;
    }

    // Only update if user hasn't made local edits
    if (dirtyPaths.value.has(filePath)) return false;

    // Preserve cursor/scroll position
    const position = editor?.getPosition();
    const scrollTop = editor?.getScrollTop();

    // Temporarily suppress the content change listener to avoid marking as dirty
    const listener = modelListeners.get(filePath);
    listener?.dispose();

    model.setValue(data.content);
    if (isPreviewableFile(filePath)) previewVersion.value++;
    if (newMtime) fileTimestamps.set(filePath, newMtime);

    // Re-attach the listener
    if (listener) {
      const newListener = model.onDidChangeContent(() => markDirty(filePath));
      modelListeners.set(filePath, newListener);
    }

    // Restore cursor/scroll
    if (position && editor) {
      editor.setPosition(position);
      if (scrollTop != null) editor.setScrollTop(scrollTop);
    }

    return true;
  } catch (error) {
    console.error(t('components.editorPanel.failedToRefreshFile'), error);
    return false;
  }
}

async function restoreExpandedDirectories(nodes: TreeNodeData[], paths: Set<string>, restored: Set<string>) {
  for (const node of nodes) {
    if (node.type !== 'directory' || !paths.has(node.path)) continue;
    node.children = await loadFileTree(node.path);
    restored.add(node.path);
    await restoreExpandedDirectories(node.children, paths, restored);
  }
}

async function refreshFileTree() {
  const paths = expandedPaths.value;
  const tree = await loadFileTree(props.cwd);
  const restored = new Set<string>();
  await restoreExpandedDirectories(tree, paths, restored);
  fileTree.value = tree;
  expandedPaths.value = restored;
}

async function refreshDirectoryInTree(directoryPath: string) {
  const cwd = normalizePath(props.cwd || '~');
  const normalizedDirectory = normalizePath(directoryPath);
  if (normalizedDirectory === cwd) {
    await refreshFileTree();
    return;
  }

  const node = findTreeNodeByPath(fileTree.value, normalizedDirectory);
  if (!node || node.type !== 'directory') {
    await refreshFileTree();
    return;
  }

  node.children = await loadFileTree(node.path);
  const nextExpanded = new Set(expandedPaths.value);
  nextExpanded.add(node.path);
  expandedPaths.value = nextExpanded;
}

async function refreshActiveFile() {
  if (!activeTab.value) return;

  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Checking...';

  const [changed] = await Promise.all([
    refreshFile(activeTab.value),
    refreshFileTree(),
  ]);

  if (changed) {
    statusType.value = 'success';
    statusMessage.value = 'Refreshed';
  } else {
    statusType.value = 'success';
    statusMessage.value = t('components.editorPanel.upToDate');
  }
  scheduleStatusClear();
}

async function refreshAllOpenFiles() {
  const paths = tabs.value.map(t => t.path);
  await Promise.all([
    ...paths.map(p => refreshFile(p)),
    refreshFileTree(),
  ]);
  await refreshGitChanges();
}

async function handleRefresh() {
  selectedDirectoryPath.value = rootDirectory();
  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Refreshing...';

  await refreshAllOpenFiles();

  statusType.value = 'success';
  statusMessage.value = 'Refreshed';
  scheduleStatusClear();
}

async function toggleHiddenFiles() {
  showHiddenFiles.value = !showHiddenFiles.value;
  await refreshFileTree();
}

async function createNewFile(targetDirectory = selectedDirectoryPath.value || rootDirectory()) {
  const input = await requestInput({
    title: t('components.editorPanel.createNewFile'),
    label: t('components.editorPanel.filePath'),
    description: t('components.editorPanel.enterAFilePathRelativeToThe'),
    confirmText: t('components.editorPanel.createFile'),
  });
  if (input === null) return;

  const trimmed = input.trim();
  if (!trimmed || trimmed.endsWith('/')) {
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.invalidPath');
    scheduleStatusClear();
    return;
  }

  const filePath = resolveNewFilePath(trimmed, targetDirectory);
  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Creating...';

  try {
    const response = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: '' }),
    });

    if (response.status === 409) {
      statusType.value = 'error';
      statusMessage.value = t('components.editorPanel.fileExists');
      scheduleStatusClear();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    await refreshDirectoryInTree(dirname(data.path || filePath));
    await openFile(data.path || filePath);
    statusType.value = 'success';
    statusMessage.value = 'Created';
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToCreateFile'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.createFailed');
  }
}

async function downloadPath(filePath: string, isDirectory = false): Promise<void> {
  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = t('components.editorPanel.preparingDownload');

  try {
    const response = await fetch(`/api/files/download?path=${encodeURIComponent(filePath)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${basename(filePath)}${isDirectory ? '.zip' : ''}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    statusType.value = 'success';
    statusMessage.value = t('components.editorPanel.downloadStarted');
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToDownloadPath'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.downloadFailed');
  }
}

function downloadContextTab(): void {
  const filePath = contextTab.value?.path;
  closeTabContextMenu();
  if (filePath) void downloadPath(filePath);
}

function downloadContextNode(): void {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (node) void downloadPath(node.path, node.type === 'directory');
}

function closeFileContextMenu() {
  fileContextMenu.value = { ...fileContextMenu.value, visible: false };
}

function closeTabContextMenu() {
  tabContextMenu.value = { ...tabContextMenu.value, visible: false };
}

function closeContextMenus() {
  closeFileContextMenu();
  closeTabContextMenu();
}

function showFileContextMenu(event: MouseEvent, node: TreeNodeData) {
  closeTabContextMenu();
  if (node.type === 'directory') selectedDirectoryPath.value = node.path;
  fileContextMenu.value = {
    visible: true,
    left: event.clientX,
    top: event.clientY,
    node,
  };
}

function showTabContextMenu(event: MouseEvent, tabPath: string) {
  hideTabTooltip();
  closeFileContextMenu();
  tabContextMenu.value = {
    visible: true,
    left: event.clientX,
    top: event.clientY,
    tabPath,
  };
}

function createNewFileFromContext() {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (node?.type === 'directory') {
    createNewFile(node.path);
  }
}

function createNewFolderFromContext() {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (node?.type === 'directory') {
    createNewFolder(node.path);
  }
}

function cutContextNode() {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (node?.type !== 'file') return;
  cutFilePath.value = node.path;
  statusType.value = 'success';
  statusMessage.value = t('components.editorPanel.cutFile', { name: node.name });
  scheduleStatusClear();
}

async function pasteCutFileIntoContext() {
  const targetDirectory = fileContextMenu.value.node;
  const sourcePath = cutFilePath.value;
  closeFileContextMenu();
  if (targetDirectory?.type !== 'directory' || !sourcePath) return;

  const sourceDirectoryPath = dirname(sourcePath);
  const targetDirectoryPath = targetDirectory.path;
  const targetPath = resolveNewFilePath(basename(sourcePath), targetDirectoryPath);
  if (targetPath === sourcePath) {
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.alreadyInThisFolder');
    scheduleStatusClear();
    return;
  }

  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Moving...';

  try {
    const response = await fetch('/api/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sourcePath, to: targetPath }),
    });

    if (response.status === 409) {
      statusType.value = 'error';
      statusMessage.value = t('components.editorPanel.targetExists');
      scheduleStatusClear();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const movedPath = data.path || targetPath;
    moveOpenPaths(sourcePath, movedPath, false);
    if (selectedDirectoryPath.value === sourceDirectoryPath) selectedDirectoryPath.value = targetDirectoryPath;
    await refreshDirectoryInTree(sourceDirectoryPath);
    await refreshDirectoryInTree(targetDirectoryPath);
    cutFilePath.value = undefined;
    statusType.value = 'success';
    statusMessage.value = 'Moved';
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToMoveFile'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.moveFailed');
  }
}

async function copyPathFromContext(kind: 'filename' | 'relative' | 'full') {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (!node) return;

  const text = kind === 'filename'
    ? node.name
    : kind === 'relative'
      ? relativePathFromCwd(node.path)
      : node.path;
  await copyPath(text);
}

async function copyPath(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    statusType.value = 'success';
    statusMessage.value = 'Copied';
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToCopyPath'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.copyFailed');
    scheduleStatusClear();
  }
}

async function createNewFolder(targetDirectory = selectedDirectoryPath.value || rootDirectory()) {
  const input = await requestInput({
    title: t('components.editorPanel.createNewFolder'),
    label: t('components.editorPanel.folderPath'),
    description: t('components.editorPanel.enterAFolderPathRelativeToThe'),
    confirmText: t('components.editorPanel.createFolder'),
  });
  if (input === null) return;
  const trimmed = input.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (!trimmed) {
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.invalidPath');
    scheduleStatusClear();
    return;
  }

  const folderPath = resolveNewFilePath(trimmed, targetDirectory);
  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Creating...';

  try {
    const response = await fetch('/api/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });

    if (response.status === 409) {
      statusType.value = 'error';
      statusMessage.value = t('components.editorPanel.folderExists');
      scheduleStatusClear();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    await refreshDirectoryInTree(dirname(data.path || folderPath));
    selectedDirectoryPath.value = data.path || folderPath;
    const nextExpanded = new Set(expandedPaths.value);
    nextExpanded.add(data.path || folderPath);
    expandedPaths.value = nextExpanded;
    statusType.value = 'success';
    statusMessage.value = t('components.editorPanel.folderCreated');
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToCreateFolder'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.createFailed');
  }
}

function moveOpenTabPath(oldPath: string, newPath: string) {
  const model = models.get(oldPath);
  if (model) {
    modelListeners.get(oldPath)?.dispose();
    modelListeners.delete(oldPath);
    models.delete(oldPath);
    models.set(newPath, model);
    modelListeners.set(newPath, model.onDidChangeContent(() => markDirty(newPath)));
  }

  const timestamp = fileTimestamps.get(oldPath);
  if (timestamp !== undefined) {
    fileTimestamps.delete(oldPath);
    fileTimestamps.set(newPath, timestamp);
  }

  const previewMode = previewModes.value.get(oldPath);
  if (previewMode) {
    const nextPreviewModes = new Map(previewModes.value);
    nextPreviewModes.delete(oldPath);
    if (isPreviewableFile(newPath)) nextPreviewModes.set(newPath, previewMode);
    previewModes.value = nextPreviewModes;
  }

  if (dirtyPaths.value.has(oldPath)) {
    const nextDirtyPaths = new Set(dirtyPaths.value);
    nextDirtyPaths.delete(oldPath);
    nextDirtyPaths.add(newPath);
    dirtyPaths.value = nextDirtyPaths;
  }

  const tab = tabs.value.find(t => t.path === oldPath);
  if (tab) {
    tab.path = newPath;
    tab.name = basename(newPath);
  }

  if (activeTab.value === oldPath) activeTab.value = newPath;
}

function moveOpenPaths(oldPath: string, newPath: string, isDirectory: boolean) {
  const prefix = `${normalizePath(oldPath)}/`;
  const paths = tabs.value
    .map(tab => tab.path)
    .filter(path => path === oldPath || (isDirectory && path.startsWith(prefix)));

  for (const path of paths) {
    moveOpenTabPath(path, path === oldPath ? newPath : `${normalizePath(newPath)}/${path.slice(prefix.length)}`);
  }
}

function removeOpenTab(filePath: string) {
  const index = tabs.value.findIndex(t => t.path === filePath);
  if (index === -1) return;

  tabs.value.splice(index, 1);
  modelListeners.get(filePath)?.dispose();
  modelListeners.delete(filePath);
  models.get(filePath)?.dispose();
  models.delete(filePath);
  const nextPreviewModes = new Map(previewModes.value);
  nextPreviewModes.delete(filePath);
  previewModes.value = nextPreviewModes;
  fileTimestamps.delete(filePath);
  clearDirty(filePath);

  if (activeTab.value === filePath) {
    activeTab.value = tabs.value[index]?.path || tabs.value[index - 1]?.path;
  }
}

function removeOpenPaths(path: string, isDirectory: boolean) {
  const prefix = `${normalizePath(path)}/`;
  const paths = tabs.value
    .map(tab => tab.path)
    .filter(tabPath => tabPath === path || (isDirectory && tabPath.startsWith(prefix)));

  for (const tabPath of paths) removeOpenTab(tabPath);
}

async function renameContextNode() {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (node) await renamePath(node);
}

async function renamePath(node: Pick<TreeNodeData, 'path' | 'type'>) {
  const input = await requestInput({
    title: t('components.editorPanel.renameType', { type: node.type }),
    label: t('components.editorPanel.newNameOrPath'),
    description: t('components.editorPanel.useASimpleNameToRenameIn'),
    value: basename(node.path),
    confirmText: t('components.editorPanel.rename'),
  });
  if (input === null) return;
  const trimmed = input.trim();
  if (!trimmed || trimmed.endsWith('/')) {
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.invalidPath');
    scheduleStatusClear();
    return;
  }

  const targetPath = resolveRenamePath(trimmed, node.path);
  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Renaming...';

  try {
    const response = await fetch('/api/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: node.path, to: targetPath }),
    });

    if (response.status === 409) {
      statusType.value = 'error';
      statusMessage.value = t('components.editorPanel.targetExists');
      scheduleStatusClear();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    moveOpenPaths(node.path, data.path || targetPath, node.type === 'directory');
    if (selectedDirectoryPath.value === node.path) selectedDirectoryPath.value = data.path || targetPath;
    await refreshDirectoryInTree(dirname(node.path));
    if (dirname(data.path || targetPath) !== dirname(node.path)) {
      await refreshDirectoryInTree(dirname(data.path || targetPath));
    }
    statusType.value = 'success';
    statusMessage.value = 'Renamed';
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToRenameFile'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.renameFailed');
  }
}

async function deleteContextNode() {
  const node = fileContextMenu.value.node;
  closeFileContextMenu();
  if (!node) return;
  const deleteMessage = node.type === 'directory'
    ? t('components.editorPanel.deleteDirectoryMessage', { name: node.name })
    : t('components.editorPanel.deleteFileMessage', { name: node.name });
  const confirmed = await requestConfirm({
    title: node.type === 'directory' ? t('components.editorPanel.deleteDirectory') : t('components.editorPanel.deleteFile'),
    message: deleteMessage,
    confirmText: t('components.editorPanel.delete'),
    variant: 'danger',
  });
  if (!confirmed) return;

  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Deleting...';

  try {
    const response = await fetch('/api/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: node.path }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    removeOpenPaths(node.path, node.type === 'directory');
    if (selectedDirectoryPath.value === node.path) selectedDirectoryPath.value = undefined;
    await refreshDirectoryInTree(dirname(node.path));
    statusType.value = 'success';
    statusMessage.value = 'Deleted';
    scheduleStatusClear();
  } catch (error) {
    console.error(t('components.editorPanel.failedToDeleteFile'), error);
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.deleteFailed');
  }
}

async function closeTab(filePath: string) {
  if (dirtyPaths.value.has(filePath)) {
    const confirmed = await requestConfirm({
      title: t('components.editorPanel.discardUnsavedChanges'),
      message: t('components.editorPanel.closeThisFileAndDiscardUnsavedChanges'),
      confirmText: t('components.editorPanel.discard'),
      variant: 'warning',
    });
    if (!confirmed) return;
  }

  removeOpenTab(filePath);
}

function pinTab(filePath: string) {
  const index = tabs.value.findIndex(tab => tab.path === filePath);
  if (index === -1) return;

  const [tab] = tabs.value.splice(index, 1);
  tab.pinned = true;
  tabs.value.unshift(tab);
}

function unpinTab(filePath: string) {
  const tab = tabs.value.find(tab => tab.path === filePath);
  if (tab) tab.pinned = false;
}

function pinContextTab() {
  const tabPath = tabContextMenu.value.tabPath;
  closeTabContextMenu();
  if (tabPath) pinTab(tabPath);
}

function addContextTabToReference() {
  const tabPath = tabContextMenu.value.tabPath;
  closeTabContextMenu();
  if (tabPath) emit('addReference', relativePathFromCwd(tabPath));
}

async function copyContextTabRelativePath() {
  const tabPath = tabContextMenu.value.tabPath;
  closeTabContextMenu();
  if (tabPath) await copyPath(relativePathFromCwd(tabPath));
}

async function renameContextTab() {
  const tabPath = tabContextMenu.value.tabPath;
  closeTabContextMenu();
  if (tabPath) await renamePath({ path: tabPath, type: 'file' });
}

async function closeContextTab() {
  const tabPath = tabContextMenu.value.tabPath;
  closeTabContextMenu();
  if (tabPath) await closeTab(tabPath);
}

function unpinContextTab() {
  const tabPath = tabContextMenu.value.tabPath;
  closeTabContextMenu();
  if (tabPath) unpinTab(tabPath);
}

async function closeAllTabs() {
  closeTabContextMenu();
  const closePaths = closableTabPaths.value;
  await closeTabs(closePaths, t('components.editorPanel.closeAllUnpinnedTabsAndDiscardUnsaved'));
}

async function closeOtherTabs() {
  const closePaths = closeOtherTabPaths.value;
  closeTabContextMenu();
  await closeTabs(closePaths, t('components.editorPanel.closeOtherUnpinnedTabsAndDiscardUnsaved'));
}

async function closeTabs(closePaths: string[], dirtyMessage: string) {
  if (closePaths.length === 0) return;

  const hasDirtyTabs = closePaths.some(path => dirtyPaths.value.has(path));
  if (hasDirtyTabs) {
    const confirmed = await requestConfirm({
      title: t('components.editorPanel.discardUnsavedChanges'),
      message: dirtyMessage,
      confirmText: t('components.editorPanel.discard'),
      variant: 'warning',
    });
    if (!confirmed) return;
  }

  for (const path of closePaths) removeOpenTab(path);
}

async function toggleDirectory(node: TreeNodeData) {
  const nextExpanded = new Set(expandedPaths.value);

  if (nextExpanded.has(node.path)) {
    nextExpanded.delete(node.path);
    expandedPaths.value = nextExpanded;
    return;
  }

  if (!node.children?.length) {
    node.children = await loadFileTree(node.path);
  }

  nextExpanded.add(node.path);
  expandedPaths.value = nextExpanded;
}

async function expandDirectoryPath(path: string): Promise<boolean> {
  const node = findTreeNodeByPath(fileTree.value, path);
  if (!node || node.type !== 'directory') return false;

  if (!node.children?.length) {
    node.children = await loadFileTree(node.path);
  }

  const nextExpanded = new Set(expandedPaths.value);
  nextExpanded.add(node.path);
  expandedPaths.value = nextExpanded;
  return true;
}

async function locateActiveFileInTree() {
  if (!activeTab.value) return;

  clearStatusTimer();
  statusType.value = 'saving';
  statusMessage.value = 'Locating...';

  for (const directory of directoryChainForFile(activeTab.value)) {
    const expanded = await expandDirectoryPath(directory);
    if (!expanded) {
      await refreshFileTree();
      const retryExpanded = await expandDirectoryPath(directory);
      if (!retryExpanded) {
        statusType.value = 'error';
        statusMessage.value = t('components.editorPanel.notInTree');
        scheduleStatusClear();
        return;
      }
    }
  }

  await nextTick();
  const activeNode = fileTreeEl.value?.querySelector<HTMLElement>('[data-tree-current="true"]');
  if (!activeNode) {
    statusType.value = 'error';
    statusMessage.value = t('components.editorPanel.notInTree');
    scheduleStatusClear();
    return;
  }

  activeNode.scrollIntoView({ block: 'center', inline: 'nearest' });
  statusType.value = 'success';
  statusMessage.value = 'Located';
  scheduleStatusClear();
}

watch(() => props.visible, (isVisible) => {
  if (isVisible && editor) {
    nextTick(() => editor?.layout());
  }
});

watch(isMaximized, () => {
  nextTick(() => editor?.layout());
});

watch(activeTab, (path) => {
  resetImageView();
  editor?.setModel(path ? models.get(path) || null : null);
  if (typeof editor?.updateOptions === 'function') {
    editor.updateOptions({ readOnly: !!tabs.value.find(tab => tab.path === path)?.virtual });
  }
  previewVersion.value++;
  nextTick(() => editor?.layout());
  applyGitChangeDecorations(path);
  applyDiffDecorations(path);
});

watch(() => props.cwd, () => {
  reloadRootTree();
});

watch(resolvedTheme, (theme) => {
  monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark');
  applyGitChangeDecorations();
});

watch([
  () => activeIsMarkdown.value ? activeMarkdownHtml.value : '',
  activePreviewMode,
  resolvedTheme,
], () => {
  void nextTick(renderMermaidDiagrams);
});

watch(() => props.autoRefresh, (enabled) => {
  stopAutoRefresh();
  if (enabled) startAutoRefresh();
}, { immediate: true });

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    refreshAllOpenFiles();
  }, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  }
}

onMounted(() => {
  reloadRootTree();
  
  if (editorContainer.value) {
    editor = monaco.editor.create(editorContainer.value, {
      theme: resolvedTheme.value === 'light' ? 'vs' : 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: 'on',
      fontSize: 14,
      fontFamily: "'Fira Code', 'Consolas', monospace",
    });

    gitChangeDecorations = editor.createDecorationsCollection?.() || null;

    editor.addCommand(monaco.KeyMod.CtrlCmd + monaco.KeyCode.KeyS, () => {
      saveFile();
    });

    if (canOpenWithSystemTool) {
      editor.addAction({
        id: 'open-with-system-tool',
        label: t('components.editorPanel.openWithSystemTool'),
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        run: openActiveFileWithSystemTool,
      });
    }

    applyGitChangeDecorations();
  }

  if (props.autoRefresh) startAutoRefresh();

  // Listen for open-file events from file search
  window.addEventListener('open-file', handleOpenFile);
  window.addEventListener('click', closeContextMenus);
});

function handleOpenFile(event: Event) {
  const customEvent = event as CustomEvent;
  const filePath = customEvent.detail?.path;
  if (filePath) {
    openFile(filePath);
  }
}

onUnmounted(() => {
  clearStatusTimer();
  stopAutoRefresh();
  modelListeners.forEach(listener => listener.dispose());
  modelListeners.clear();
  models.forEach(model => model.dispose());
  models.clear();
  fileTimestamps.clear();
  gitChangeDecorations?.clear();
  diffDecorations?.clear();
  gitChangeDecorations = null;
  diffDecorations = null;
  editor?.dispose();
  stopEditorResize();
  stopFileTreeResize();
  window.removeEventListener('open-file', handleOpenFile);
  window.removeEventListener('click', closeContextMenus);
});

defineExpose({ openFile, openVirtualDiff, locateActiveFileInTree });
</script>

<style scoped>
.editor-panel {
  position: relative;
  flex: 0 0 var(--editor-panel-width);
  width: var(--editor-panel-width);
  min-width: 360px;
  height: 100vh;
  background: var(--bg-primary);
  border-left: 1px solid var(--border);
  display: none;
  flex-direction: column;
}

.editor-panel.visible {
  display: flex;
}

.editor-panel.maximized {
  min-width: 0;
  border-left: none;
  box-shadow: var(--shadow-lg);
}

.editor-resize-handle {
  position: absolute;
  top: 0;
  left: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}

.editor-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  left: 4px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s;
}

.editor-resize-handle:hover::after,
.editor-resize-handle.is-resizing::after {
  background: var(--accent);
}

.editor-header {
  position: relative;
  min-width: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent),
    var(--bg-elevated);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 1px 0 rgba(0, 0, 0, 0.28);
  display: flex;
  justify-content: space-between;
}

.editor-header::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: 3px;
  background: var(--accent);
  opacity: 0.85;
}

.editor-tabs {
  min-width: 0;
  display: flex;
  flex: 1 1 auto;
  overflow-x: auto;
}

.tab {
  flex: 0 0 auto;
  padding: 0.5rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  border-right: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: inset 0 2px 0 var(--accent);
}

.tab-pin {
  flex: 0 0 auto;
  color: var(--accent);
}

.tab button {
  opacity: 0;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  transition: opacity 0.2s;
}

.tab:hover button {
  opacity: 1;
}

.editor-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
}

.markdown-mode-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  margin-right: 0.25rem;
  padding: 0.125rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.editor-actions .markdown-mode-toggle button {
  padding: 0.25rem 0.5rem;
  white-space: nowrap;
  border-radius: calc(var(--radius-sm) - 1px);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.editor-actions .markdown-mode-toggle button.active {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.editor-actions button {
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
}

.editor-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.editor-actions .window-btn,
.editor-actions .close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.editor-actions .window-btn {
  min-width: 1.75rem;
  font-size: 0.95rem;
  line-height: 1;
}

.editor-actions .close-btn {
  margin-right: 4px;
}

.editor-actions .window-btn:hover:not(:disabled),
.editor-actions .close-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.editor-actions .tooltip {
  position: relative;
}

.editor-actions .tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.75rem;
  border-radius: var(--radius-sm);
  max-width: min(520px, calc(100vw - 32px));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
  border: 1px solid var(--border);
  z-index: 100;
  box-shadow: var(--shadow-md);
}

.editor-actions .tooltip:hover::after {
  opacity: 1;
}

.editor-tab-tooltip {
  position: fixed;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.75rem;
  border-radius: var(--radius-sm);
  max-width: min(520px, calc(100vw - 32px));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  border: 1px solid var(--border);
  z-index: 1000;
  box-shadow: var(--shadow-md);
}

.editor-toast {
  position: absolute;
  top: 3.25rem;
  right: 1rem;
  z-index: 1250;
  max-width: min(24rem, calc(100% - 2rem));
  padding: 0.625rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  font-size: 0.8125rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  pointer-events: none;
}

.editor-toast.success {
  border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  color: var(--success);
}

.editor-toast.error {
  border-color: color-mix(in srgb, var(--error) 45%, var(--border));
  color: var(--error);
}

.editor-toast.saving {
  color: var(--text-secondary);
}

.editor-body {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  overflow: hidden;
}

.file-tree-pane {
  position: relative;
  flex: 0 0 var(--file-tree-pane-width, 220px);
  min-width: 140px;
  max-width: 420px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 2rem;
  padding: 0.25rem 0.375rem;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-elevated) 52%, transparent);
}

.file-tree-toolbar-btn {
  position: relative;
  width: 1.5rem;
  height: 1.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.file-tree-toolbar-btn:hover:not(:disabled),
.file-tree-toolbar-btn.active {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.file-tree-toolbar-btn.active {
  color: var(--accent);
}

.file-tree-toolbar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.file-tree-toolbar .tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  padding: 4px 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.75rem;
  border-radius: var(--radius-sm);
  max-width: min(220px, calc(100vw - 32px));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
  border: 1px solid var(--border);
  z-index: 100;
  box-shadow: var(--shadow-md);
}

.file-tree-toolbar .tooltip:hover::after {
  opacity: 1;
}

.context-menu {
  position: fixed;
  width: 180px;
  padding: 0.25rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 1300;
}

.context-menu button {
  width: 100%;
  padding: 0.45rem 0.65rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-align: left;
  font-size: 0.8125rem;
}

.context-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.context-menu button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.context-menu button.danger:hover {
  color: var(--error);
}

.file-tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem;
}

.file-tree-resize-handle {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}

.file-tree-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  right: 4px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s;
}

.file-tree-resize-handle:hover::after,
.file-tree-resize-handle.is-resizing::after {
  background: var(--accent);
}

.file-tree-backdrop {
  display: none;
}

.editor-container {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.editor-container.hidden {
  display: none;
}

.image-preview {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.image-preview-toolbar {
  position: absolute;
  top: 0.75rem;
  left: 50%;
  z-index: 1;
  display: flex;
  align-items: center;
  transform: translateX(-50%);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.image-preview-toolbar button {
  height: 30px;
  min-width: 34px;
  padding: 0 0.55rem;
  border: 0;
  border-right: 1px solid var(--border);
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
}

.image-preview-toolbar button:last-child {
  border-right: 0;
}

.image-preview-toolbar button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.image-preview-toolbar button:disabled {
  opacity: 0.45;
  cursor: default;
}

.image-preview-toolbar .image-zoom-level {
  min-width: 64px;
  font-variant-numeric: tabular-nums;
}

.image-preview-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
}

.image-preview-viewport.can-pan {
  cursor: grab;
}

.image-preview-viewport.is-dragging {
  cursor: grabbing;
}

.image-preview img {
  position: absolute;
  max-width: calc(100% - 2rem);
  max-height: calc(100% - 2rem);
  object-fit: contain;
  user-select: none;
  transform-origin: center;
  will-change: transform;
}

.html-preview {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: #fff;
}

.markdown-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  padding: 2rem min(3rem, 6vw);
  color: var(--text-primary);
  background: var(--bg-primary);
  line-height: 1.65;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  margin: 1.5em 0 0.65em;
  line-height: 1.25;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2) {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border-subtle);
}

.markdown-preview :deep(p),
.markdown-preview :deep(ul),
.markdown-preview :deep(ol),
.markdown-preview :deep(blockquote),
.markdown-preview :deep(pre),
.markdown-preview :deep(table) {
  margin: 0 0 1rem;
}

.markdown-preview :deep(a) {
  color: var(--accent);
}

.markdown-preview :deep(blockquote) {
  padding: 0 1rem;
  color: var(--text-secondary);
  border-left: 4px solid var(--border);
}

.markdown-preview :deep(code) {
  padding: 0.15rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-family: 'Fira Code', 'Consolas', monospace;
}

.markdown-preview :deep(pre) {
  padding: 1rem;
  overflow: auto;
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.markdown-preview :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-preview :deep(img) {
  max-width: 100%;
}

.markdown-preview :deep(.mermaid-diagram) {
  margin: 0 0 1rem;
  overflow: auto;
  text-align: center;
}

.markdown-preview :deep(.mermaid-diagram svg) {
  max-width: 100%;
  height: auto;
}

.markdown-preview :deep(.mermaid-error) {
  text-align: left;
  white-space: pre-wrap;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--border);
}

.markdown-preview-light :deep(tbody tr:nth-child(2n)) {
  background: #f6f8fa;
}

.markdown-preview :deep(.markdown-frontmatter th) {
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.markdown-preview :deep(.markdown-frontmatter td) {
  word-break: break-word;
}

:deep(.git-change-added) {
  border-left: 3px solid var(--git-added);
}

:deep(.git-change-modified) {
  border-left: 3px solid var(--git-modified);
}

:deep(.git-change-deleted) {
  border-left: 3px solid var(--git-deleted);
}

:deep(.git-diff-added) {
  background: var(--diff-added-bg);
  color: var(--diff-added-text);
}

:deep(.git-diff-removed) {
  background: var(--diff-removed-bg);
  color: var(--diff-removed-text);
}

:deep(.git-diff-hunk) {
  background: var(--diff-hunk-bg);
  color: var(--diff-hunk-text);
}

:deep(.git-diff-meta) {
  color: var(--diff-meta-text);
}

/* ── Mobile ────────────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .editor-panel {
    min-width: 0;
  }

  .editor-header {
    padding-top: env(safe-area-inset-top, 0px);
  }

  .editor-actions button {
    min-height: 44px;
    padding: 0.5rem 0.75rem;
  }

  .file-tree-pane {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 8;
    width: min(82vw, 320px);
    min-width: 0;
    max-width: none;
    flex-basis: auto;
    border-right: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
  }

  .file-tree-resize-handle {
    display: none;
  }

  .file-tree-backdrop {
    position: absolute;
    inset: 0;
    z-index: 7;
    display: block;
    background: rgba(0, 0, 0, 0.28);
  }

  .editor-container,
  .markdown-preview,
  .html-preview,
  .image-preview {
    min-height: 0;
  }
}
</style>
