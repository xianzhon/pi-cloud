<!-- client/src/components/MessageBubble.vue -->
<template>
  <div
    v-if="showEventRow"
    class="chat-event-row"
    :class="[`event-${message.kind}`, `status-${message.status || 'info'}`]"
  >
    <button
      v-if="copyableText"
      class="copy-btn event-copy-btn"
      :class="{ copied }"
      @click="copyContent"
      :title="copied ? t('components.messageBubble.copied') : t('components.messageBubble.copyMessage')"
      :aria-label="t('components.messageBubble.copyMessage')"
    >
      <PhCheck v-if="copied" :size="14" weight="bold" />
      <PhCopy v-else :size="14" />
    </button>
    <div class="event-header" @click="toggleEventExpanded">
      <component :is="eventIcon" :size="16" weight="bold" class="event-icon" />
      <span class="event-title">{{ eventTitle }}</span>
      <span v-if="eventPathLabel" class="event-path" :title="eventPathTitle">{{ eventPathLabel }}</span>
      <PhCaretDown v-if="message.kind === 'thinking' && hasExpandableThinking && thinkingExpanded" :size="14" class="event-toggle" />
      <PhCaretRight v-else-if="message.kind === 'thinking' && hasExpandableThinking" :size="14" class="event-toggle" />
      <PhCaretDown v-else-if="isCollapsibleEvent && eventExpanded" :size="14" class="event-toggle" />
      <PhCaretRight v-else-if="isCollapsibleEvent" :size="14" class="event-toggle" />
    </div>
    <div v-if="eventExpanded && renderedToolInput" class="event-block markdown-body" v-html="renderedToolInput"></div>
    <div v-if="eventExpanded && renderedToolOutput" class="event-block markdown-body" v-html="renderedToolOutput"></div>
    <div
      v-else-if="eventExpanded && message.content && message.kind !== 'thinking' && !message.toolInput && !message.toolOutput"
      class="event-content markdown-body"
      v-html="renderedContent"
      @click="handleContentClick"
    ></div>
    <div
      v-else-if="message.kind === 'thinking' && hasExpandableThinking && thinkingExpanded && showThinkingBlock"
      class="event-content markdown-body"
      v-html="renderedThinking || renderedContent"
      @click="handleContentClick"
    ></div>
  </div>

  <div
    v-else-if="showMessageBubble"
    class="message-bubble"
    :class="[message.role, { 'git-diff-card': isGitDiffMessage, 'thinking-only-bubble': (message.thinking?.trim() && !message.content.trim()) || isThinkingTagOnly, 'thinking-header-only-bubble': isHeaderOnlyThinkingTag }]"
    :aria-label="imageMessageLabel || undefined"
  >
    <div class="message-actions">
      <button
        v-if="copyableText"
        class="copy-btn"
        :class="{ copied }"
        @click="copyContent"
        :title="copied ? t('components.messageBubble.copied') : t('components.messageBubble.copyMessage')"
        :aria-label="t('components.messageBubble.copyMessage')"
      >
        <PhCheck v-if="copied" :size="14" weight="bold" />
        <PhCopy v-else :size="14" />
      </button>
    </div>
    
    <!-- Thinking content (collapsible) -->
    <div 
      v-if="message.thinking && message.thinking.trim() && showThinkingBlock" 
      class="thinking-block compact-thinking"
    >
      <div class="thinking-header" @click="toggleThinkingExpanded">
        <PhLightbulb :size="16" weight="duotone" class="thinking-icon" />
        <span class="thinking-label">{{ thinkingTitle }}</span>
        <PhCaretDown v-if="hasExpandableThinking && thinkingExpanded" :size="14" class="thinking-toggle" />
        <PhCaretRight v-else-if="hasExpandableThinking" :size="14" class="thinking-toggle" />
      </div>
      <div 
        v-if="hasExpandableThinking && thinkingExpanded"
        class="thinking-content markdown-body"
        v-html="renderedThinking"
        @click="handleContentClick"
      ></div>
    </div>
    

    
    <div v-if="renderedImages.length" class="message-images">
      <div
        v-for="(image, index) in renderedImages"
        :key="`${image.mimeType}:${index}`"
        class="message-image-item"
      >
        <img
          class="message-image"
          :src="imageDataUrl(image)"
          :alt="imageAlt(image, index)"
          :title="t('components.messageBubble.doubleClickToEnlarge')"
          @dblclick="openImagePreview(image, index)"
        />
        <button
          v-if="image.path"
          type="button"
          class="message-image-annotate"
          :title="t('components.messageBubble.annotateImage')"
          :aria-label="t('components.messageBubble.annotateImage')"
          @click="emit('annotate', image)"
        >
          <PhPencilSimple :size="14" />
          {{ t('components.messageBubble.annotate') }}
        </button>
      </div>
    </div>

    <!-- Text content -->
    <div 
      v-if="message.content && message.content.trim() && renderedContent.trim()"
      class="message-content markdown-body" 
      v-html="renderedContent"
      @click="handleContentClick"
    ></div>

    <div v-if="memoryRecall" class="memory-recall">
      <button
        type="button"
        class="memory-recall-toggle"
        :title="memoryRecallTitle"
        @click="toggleMemoryExpanded"
      >
        <PhCaretDown v-if="memoryExpanded" :size="13" />
        <PhCaretRight v-else :size="13" />
        {{ memoryRecallLabel }}
      </button>
      <div v-if="memoryExpanded" class="memory-recall-panel">
        <div v-if="memoryRecall.memories.length" class="memory-recall-list">
          <div
            v-for="memory in memoryRecall.memories"
            :key="memory.id"
            class="memory-recall-item"
          >
            <div class="memory-recall-meta">
              <span>{{ memory.reason }}</span>
              <span>{{ memory.scope }}/{{ memory.category }}</span>
            </div>
            <div class="memory-recall-content">{{ memory.content }}</div>
          </div>
        </div>
        <div v-else class="memory-recall-empty">{{ memoryRecallEmptyText }}</div>
      </div>
    </div>

    <div v-if="usageSummary" class="token-usage" :title="usageTitle">
      {{ usageSummary }}
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="imagePreview"
      ref="imagePreviewEl"
      class="message-image-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="imagePreview.alt"
      @click.self="closeImagePreview"
      @wheel.prevent="handleImagePreviewWheel"
    >
      <button
        type="button"
        class="message-image-lightbox-close"
        :aria-label="t('components.messageBubble.closeImagePreview')"
        @click="closeImagePreview"
      >
        ×
      </button>
      <img
        ref="imagePreviewImageEl"
        class="message-image-lightbox-image"
        :class="{ 'can-pan': imagePreviewZoom > 1, 'is-dragging': imagePreviewDragging }"
        :src="imageDataUrl(imagePreview.image)"
        :alt="imagePreview.alt"
        :style="{ transform: `translate(${imagePreviewPan.x}px, ${imagePreviewPan.y}px) scale(${imagePreviewZoom})` }"
        draggable="false"
        @pointerdown="handleImagePreviewPointerDown"
        @pointermove="handleImagePreviewPointerMove"
        @pointerup="handleImagePreviewPointerEnd"
        @pointercancel="handleImagePreviewPointerEnd"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, ref, watch } from 'vue';
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import type { ChatImage, MessageMemoryRecall } from '../composables/useChat';
import { ansiToHtml, normalizeTerminalOutput } from '../utils/ansi';
import {
  PhCopy,
  PhCheck,
  PhLightbulb,
  PhWrench,
  PhCheckCircle,
  PhXCircle,
  PhInfo,
  PhCaretDown,
  PhCaretRight,
  PhPencilSimple,
} from '@phosphor-icons/vue';

const t = i18n.global.t;
const emit = defineEmits<{ annotate: [image: ChatImage] }>();

const props = withDefaults(defineProps<{
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinking?: string;
    kind?: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';
    status?: 'pending' | 'success' | 'failure' | 'info';
    title?: string;
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    provider?: string;
    model?: string;
    timestamp?: number;
    images?: ChatImage[];
    memory?: MessageMemoryRecall;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
      cost?: {
        total?: number;
      };
    };
  };
  hideThinkingBlock?: boolean;
  showHintInfo?: boolean;
  showCodeBlockLanguageHeaders?: boolean;
  expandThinkingByDefault?: boolean;
  showDetails?: boolean;
}>(), {
  showHintInfo: true,
  showCodeBlockLanguageHeaders: true,
  expandThinkingByDefault: false,
  showDetails: true,
});

const copied = ref(false);
const thinkingExpanded = ref(props.expandThinkingByDefault);
const eventExpanded = ref(true);
const memoryExpanded = ref(false);
const imagePreview = ref<{ image: ChatImage; alt: string } | null>(null);
const imagePreviewEl = ref<HTMLElement>();
const imagePreviewImageEl = ref<HTMLImageElement>();
const imagePreviewZoom = ref(1);
const imagePreviewPan = ref({ x: 0, y: 0 });
const imagePreviewDragging = ref(false);
const MIN_IMAGE_ZOOM = 0.25;
const MAX_IMAGE_ZOOM = 8;
const IMAGE_ZOOM_STEP = 0.25;
let imagePreviewDragStart: { pointerId: number; x: number; y: number; panX: number; panY: number } | undefined;

watch(() => props.expandThinkingByDefault, (expanded) => {
  thinkingExpanded.value = expanded;
});

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const isEventRow = computed(() => props.message.role === 'assistant' && !!props.message.kind && props.message.kind !== 'text');
const renderedImages = computed(() => props.message.images?.filter((image) => IMAGE_MIME_TYPES.has(image.mimeType)) || []);
const imageMessageLabel = computed(() => {
  const count = renderedImages.value.length;
  if (!count || props.message.role !== 'user' || props.message.content.trim()) return '';
  return t(count === 1 ? 'components.messageBubble.userMessageWithImage' : 'components.messageBubble.userMessageWithImages', { count });
});

function imageDataUrl(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function imageAlt(image: ChatImage, index: number): string {
  return image.name || t('components.messageBubble.attachedImage', { index: index + 1 });
}

function resetImagePreviewView(): void {
  imagePreviewZoom.value = 1;
  imagePreviewPan.value = { x: 0, y: 0 };
  imagePreviewDragging.value = false;
  imagePreviewDragStart = undefined;
}

function openImagePreview(image: ChatImage, index: number): void {
  resetImagePreviewView();
  imagePreview.value = { image, alt: imageAlt(image, index) };
}

function closeImagePreview(): void {
  imagePreview.value = null;
  resetImagePreviewView();
}

function clampImagePreviewPan(pan = imagePreviewPan.value): { x: number; y: number } {
  const viewport = imagePreviewEl.value;
  const image = imagePreviewImageEl.value;
  if (!viewport || !image) return pan;

  const maxX = Math.max(0, (image.offsetWidth * imagePreviewZoom.value - viewport.clientWidth) / 2);
  const maxY = Math.max(0, (image.offsetHeight * imagePreviewZoom.value - viewport.clientHeight) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

function handleImagePreviewWheel(event: WheelEvent): void {
  const previousZoom = imagePreviewZoom.value;
  const amount = event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP;
  const zoom = Math.max(MIN_IMAGE_ZOOM, Math.min(MAX_IMAGE_ZOOM, previousZoom + amount));
  if (zoom === previousZoom) return;

  const viewport = imagePreviewEl.value;
  if (viewport) {
    const bounds = viewport.getBoundingClientRect();
    const pointX = event.clientX - bounds.left - bounds.width / 2;
    const pointY = event.clientY - bounds.top - bounds.height / 2;
    const zoomRatio = zoom / previousZoom;
    // Adjust pan so the image point beneath the cursor stays fixed while zooming.
    imagePreviewPan.value = {
      x: pointX - (pointX - imagePreviewPan.value.x) * zoomRatio,
      y: pointY - (pointY - imagePreviewPan.value.y) * zoomRatio,
    };
  }

  imagePreviewZoom.value = zoom;
  imagePreviewPan.value = clampImagePreviewPan();
}

function handleImagePreviewPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || imagePreviewZoom.value <= 1) return;
  event.preventDefault();
  imagePreviewDragging.value = true;
  imagePreviewDragStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: imagePreviewPan.value.x,
    panY: imagePreviewPan.value.y,
  };
  (event.currentTarget as HTMLImageElement).setPointerCapture?.(event.pointerId);
}

function handleImagePreviewPointerMove(event: PointerEvent): void {
  if (!imagePreviewDragStart || imagePreviewDragStart.pointerId !== event.pointerId) return;
  imagePreviewPan.value = clampImagePreviewPan({
    x: imagePreviewDragStart.panX + event.clientX - imagePreviewDragStart.x,
    y: imagePreviewDragStart.panY + event.clientY - imagePreviewDragStart.y,
  });
}

function handleImagePreviewPointerEnd(event: PointerEvent): void {
  if (!imagePreviewDragStart || imagePreviewDragStart.pointerId !== event.pointerId) return;
  (event.currentTarget as HTMLImageElement).releasePointerCapture?.(event.pointerId);
  imagePreviewDragging.value = false;
  imagePreviewDragStart = undefined;
}

function toggleMemoryExpanded() {
  memoryExpanded.value = !memoryExpanded.value;
}

function handleImagePreviewKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeImagePreview();
}

watch(imagePreview, (preview, _previous, onCleanup) => {
  if (!preview) return;
  window.addEventListener('keydown', handleImagePreviewKeydown);
  onCleanup(() => window.removeEventListener('keydown', handleImagePreviewKeydown));
});

const showThinkingBlock = computed(() => !props.hideThinkingBlock || props.expandThinkingByDefault);
const isHiddenThinking = computed(() => props.message.kind === 'thinking' && !showThinkingBlock.value);
const showEventRow = computed(() => isEventRow.value && !isHiddenThinking.value);
const showMessageBubble = computed(() => (
  !isEventRow.value
  && !isHiddenThinking.value
  && (Boolean(renderedContent.value) || renderedImages.value.length > 0 || Boolean(props.message.memory) || Boolean(props.message.usage))
));
const eventIcon = computed(() => {
  if (props.message.status === 'failure') return PhXCircle;
  if (props.message.kind === 'thinking') return PhLightbulb;
  if (props.message.kind === 'tool_call') return PhWrench;
  if (props.message.status === 'success') return PhCheckCircle;
  return PhInfo;
});
const thinkingParts = computed(() => parseThinkingBlock(
  props.message.thinking || (props.message.kind === 'thinking' ? props.message.content : ''),
  props.message.title,
));
const thinkingTitle = computed(() => thinkingParts.value.title);
const thinkingBody = computed(() => thinkingParts.value.body);
const hasExpandableThinking = computed(() => {
  const summaryTitleCount = thinkingParts.value.summaryTitles?.length ?? 0;
  if (summaryTitleCount > 1) return true;
  const body = thinkingBody.value.trim();
  return Boolean(body) && body !== '<!-- -->';
});
const eventTitle = computed(() => props.message.kind === 'thinking' ? thinkingTitle.value : props.message.title || props.message.toolName || t('components.messageBubble.event'));
const eventPathLabel = computed(() => {
  if (props.message.kind !== 'tool_call' && props.message.kind !== 'tool_result') return '';
  const toolName = (props.message.toolName || '').toLowerCase();
  if (toolName === 'bash' || toolName === 'shell') return truncateMiddle(getToolInputCommand(), 120);
  if (!['edit', 'read', 'write'].includes(toolName)) return '';
  return getToolInputPath();
});
const eventPathTitle = computed(() => {
  const toolName = (props.message.toolName || '').toLowerCase();
  if (toolName === 'bash' || toolName === 'shell') return getToolInputCommand();
  return eventPathLabel.value;
});
const isCollapsibleEvent = computed(() => props.message.kind !== 'thinking' && (
  Boolean(renderedToolInput.value) ||
  Boolean(renderedToolOutput.value) ||
  Boolean(props.message.content && !props.message.toolInput && !props.message.toolOutput)
));
const copyableText = computed(() => props.message.toolOutput || props.message.toolInput || props.message.content || props.message.thinking || '');
const tokenFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat();
const memoryRecall = computed(() => props.message.memory);
const memoryRecallCount = computed(() => memoryRecall.value?.memories.length || 0);
const memoryRecallLabel = computed(() => {
  if (memoryRecallCount.value === 0) return t('components.messageBubble.noMemoryProvided');
  return t('components.messageBubble.memoryProvided', { count: memoryRecallCount.value });
});
const memoryRecallTitle = computed(() => {
  if (!memoryRecall.value) return '';
  const tokenLabel = t('components.messageBubble.memoryTokens', { count: integerFormatter.format(memoryRecall.value.tokenCount) });
  return memoryRecallCount.value ? tokenLabel : t('components.messageBubble.noMemoriesMatched', { tokens: tokenLabel });
});
const memoryRecallEmptyText = computed(() => {
  switch (memoryRecall.value?.diagnostics?.skipReason) {
    case 'not-substantive': return t('components.messageBubble.promptWasNotSubstantiveSoReferenceRecall');
    case 'no-confident-match': return t('components.messageBubble.noMemoryClearedTheRelevanceThresholdFor');
    case 'budget-exhausted': return t('components.messageBubble.applicableMemoryDidNotFitTheAdaptive');
    case 'recall-error': return t('components.messageBubble.memoryRecallFailedOpenTheChatRequest');
    default: return t('components.messageBubble.noMemoriesWereProvidedForThisTurn');
  }
});

const tokenTotal = computed(() => {
  const usage = props.message.usage;
  if (!usage) return 0;
  return usage.totalTokens ?? ((usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0));
});

const modelLabel = computed(() => {
  const { provider, model } = props.message;
  if (provider && model) return `${provider}/${model}`;
  return model || provider || '';
});

const usageSummary = computed(() => {
  if (props.showHintInfo === false || props.message.role !== 'assistant' || isEventRow.value || !props.message.usage || tokenTotal.value <= 0) return '';

  const parts = [];
  if (modelLabel.value) parts.push(modelLabel.value);
  parts.push(t('components.messageBubble.tokens', { count: tokenFormatter.format(tokenTotal.value).toLowerCase() }));
  const totalCost = props.message.usage.cost?.total;
  if (typeof totalCost === 'number' && totalCost > 0) parts.push(`$${totalCost.toFixed(4)}`);
  return parts.join(' | ');
});

const usageTitle = computed(() => {
  const usage = props.message.usage;
  if (!usageSummary.value || !usage) return '';
  const parts = [
    t('components.messageBubble.inputTokens', { count: integerFormatter.format(usage.input || 0) }),
    t('components.messageBubble.outputTokens', { count: integerFormatter.format(usage.output || 0) }),
  ];
  if (usage.cacheRead) parts.push(t('components.messageBubble.cacheReadTokens', { count: integerFormatter.format(usage.cacheRead) }));
  if (usage.cacheWrite) parts.push(t('components.messageBubble.cacheWriteTokens', { count: integerFormatter.format(usage.cacheWrite) }));
  return parts.join(' | ');
});

const isGitDiffMessage = computed(() => props.message.role === 'assistant' && props.message.content.trim().startsWith('### Git diff'));
const isThinkingTagOnly = computed(() => props.message.role === 'assistant' && /^\s*<thinking>[\s\S]*<\/thinking>\s*$/.test(props.message.content));
const isHeaderOnlyThinkingTag = computed(() => {
  if (!isThinkingTagOnly.value) return false;
  const match = props.message.content.match(/^\s*<thinking>([\s\S]*?)<\/thinking>\s*$/);
  return Boolean(match && !splitThinkingBlock(match[1]).content);
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLanguage(infostring: string | undefined) {
  return (infostring || '').trim().split(/\s+/)[0].toLowerCase();
}

const MAX_HIGHLIGHT_CHARS = 20000;
const MAX_EVENT_COMMAND_CHARS = 120;

const extensionLanguageMap: Record<string, string> = {
  cjs: 'javascript',
  css: 'css',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface ThinkingBlockParts {
  title: string;
  body: string;
  summaryTitles?: string[];
}

function parseThinkingBlock(text: string, fallbackTitle?: string): ThinkingBlockParts {
  const defaultTitle = fallbackTitle && fallbackTitle !== t('components.messageBubble.thinking') ? fallbackTitle : t('components.messageBubble.thinking');
  const trimmed = text.trim();
  if (!trimmed) return { title: defaultTitle, body: '' };

  const structured = parseJsonObject(trimmed);
  const structuredTitle = structured?.title;
  const structuredBody = structured?.body ?? structured?.content ?? structured?.text ?? structured?.thinking ?? structured?.reasoning;
  if (typeof structuredTitle === 'string' && typeof structuredBody === 'string') {
    return { title: structuredTitle.trim() || defaultTitle, body: structuredBody };
  }

  const lines = text.replace(/^\s+/, '').split(/\r?\n/);
  const firstLine = lines[0]?.trim();
  const secondLineIndex = lines.findIndex((line, index) => index > 0 && line.trim());
  if (firstLine === t('components.messageBubble.thinking') && secondLineIndex > 0) {
    return {
      title: lines[secondLineIndex].trim() || defaultTitle,
      body: lines.slice(secondLineIndex + 1).join('\n').trimStart(),
    };
  }

  const summaryOnlyPattern = /\*\*(.+?)\*\*(?:\s*<!--\s*-->)?/g;
  const summaryTitles = Array.from(trimmed.matchAll(summaryOnlyPattern), (match) => match[1].trim()).filter(Boolean);
  if (summaryTitles.length > 0 && !trimmed.replace(summaryOnlyPattern, '').trim()) {
    const [firstTitle, ...remainingTitles] = summaryTitles;
    return {
      title: remainingTitles.length > 0 ? t('components.messageBubble.moreItems', { title: firstTitle, count: remainingTitles.length }) : firstTitle,
      body: '',
      summaryTitles,
    };
  }

  const boldTitleMatch = trimmed.match(/^\*\*(.+?)\*\*\s*\n+([\s\S]+)$/);
  if (boldTitleMatch) {
    return { title: boldTitleMatch[1].trim() || defaultTitle, body: boldTitleMatch[2].trimStart() };
  }

  const headingMatch = trimmed.match(/^#{1,6}\s+(.+?)\s*\n+([\s\S]+)$/);
  if (headingMatch) {
    return { title: headingMatch[1].trim() || defaultTitle, body: headingMatch[2].trimStart() };
  }

  return { title: defaultTitle, body: text };
}

function languageFromPath(path: string): string {
  const cleanPath = path.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, '');
  const extension = cleanPath.match(/\.([A-Za-z0-9_-]+)$/)?.[1]?.toLowerCase();
  return extension ? extensionLanguageMap[extension] || extension : '';
}

function truncateMiddle(text: string, maxLength = MAX_EVENT_COMMAND_CHARS): string {
  if (text.length <= maxLength) return text;
  const marker = '...';
  const remaining = maxLength - marker.length;
  const startLength = Math.ceil(remaining * 0.6);
  const endLength = Math.floor(remaining * 0.4);
  return `${text.slice(0, startLength)}${marker}${text.slice(-endLength)}`;
}

function getToolInputPath(): string {
  const input = props.message.toolInput || '';
  const parsed = parseJsonObject(input);
  const candidate = parsed?.file_path || parsed?.filepath || parsed?.path || parsed?.file || parsed?.target;
  return typeof candidate === 'string' ? candidate : '';
}

function getToolInputCommand(): string {
  const input = props.message.toolInput || '';
  const parsed = parseJsonObject(input);
  return typeof parsed?.command === 'string' ? parsed.command : '';
}

function inferToolBlockLanguage(kind: 'input' | 'output'): string {
  const toolName = (props.message.toolName || '').toLowerCase();

  if (kind === 'input') {
    if (parseJsonObject(props.message.toolInput || '')) return 'json';
    if (toolName === 'bash' || toolName === 'shell') return 'bash';
    return '';
  }

  if (toolName === 'read') return languageFromPath(getToolInputPath());
  if (toolName === 'bash' || toolName === 'shell') return 'bash';
  return '';
}

function getEditDiffs() {
  const parsed = parseJsonObject(props.message.toolInput || '');
  if (!Array.isArray(parsed?.edits)) return [];
  return parsed.edits.filter((edit: unknown): edit is { oldText: string; newText: string } => {
    if (!edit || typeof edit !== 'object') return false;
    const candidate = edit as { oldText?: unknown; newText?: unknown };
    return typeof candidate.oldText === 'string' && typeof candidate.newText === 'string';
  });
}

function getWriteContent(): string | null {
  const parsed = parseJsonObject(props.message.toolInput || '');
  return typeof parsed?.content === 'string' ? parsed.content : null;
}

function diffLines(text: string) {
  return text.replace(/\n$/, '').split('\n');
}

function sanitizeHtmlFragment(html: string): string {
  // DOMPurify 3.4.13 can drop top-level structural wrappers under happy-dom.
  // A neutral wrapper preserves the intended sanitized fragment contents.
  return DOMPurify.sanitize(`<section>${html}</section>`);
}

function renderEditDiffLine(line: string, type: 'context' | 'removed' | 'added') {
  const mark = type === 'removed' ? '-' : type === 'added' ? '+' : ' ';
  return `<div class="edit-diff-line ${type}"><span class="edit-diff-mark">${mark}</span><code>${escapeHtml(line)}</code></div>`;
}

function renderEditDiff() {
  const edits = getEditDiffs();
  if (edits.length === 0) return '';

  const hunks = edits.map((edit, index) => {
    const oldLines = diffLines(edit.oldText);
    const newLines = diffLines(edit.newText);
    let prefixLength = 0;
    while (prefixLength < oldLines.length && prefixLength < newLines.length && oldLines[prefixLength] === newLines[prefixLength]) {
      prefixLength++;
    }

    let suffixLength = 0;
    while (
      suffixLength < oldLines.length - prefixLength
      && suffixLength < newLines.length - prefixLength
      && oldLines[oldLines.length - 1 - suffixLength] === newLines[newLines.length - 1 - suffixLength]
    ) {
      suffixLength++;
    }

    const lines = [
      ...oldLines.slice(0, prefixLength).map((line) => renderEditDiffLine(line, 'context')),
      ...oldLines.slice(prefixLength, oldLines.length - suffixLength).map((line) => renderEditDiffLine(line, 'removed')),
      ...newLines.slice(prefixLength, newLines.length - suffixLength).map((line) => renderEditDiffLine(line, 'added')),
      ...oldLines.slice(oldLines.length - suffixLength).map((line) => renderEditDiffLine(line, 'context')),
    ].join('');
    const hunkHeader = edits.length > 1
      ? `<div class="edit-diff-hunk-header">${t('components.messageBubble.editNumber', { number: index + 1 })}</div>`
      : '';
    return `<div class="edit-diff-hunk">${hunkHeader}${lines}</div>`;
  }).join('');

  return sanitizeHtmlFragment(`<div class="edit-diff">${hunks}</div>`);
}

function renderHighlightedCode(content: string, language: string) {
  const normalizedLanguage = normalizeLanguage(language);
  const canHighlight = normalizedLanguage && hljs.getLanguage(normalizedLanguage);
  const shouldHighlight = canHighlight && content.length <= MAX_HIGHLIGHT_CHARS;
  const highlighted = shouldHighlight
    ? hljs.highlight(content, { language: normalizedLanguage, ignoreIllegals: true }).value
    : escapeHtml(content);
  const languageLabel = normalizedLanguage || 'text';
  const languageClass = normalizedLanguage ? ` language-${escapeHtml(normalizedLanguage)}` : '';
  const header = props.showCodeBlockLanguageHeaders
    ? `<div class="code-block-header">${escapeHtml(languageLabel)}</div>`
    : '';

  return sanitizeHtmlFragment(`<div class="code-block">${header}<pre><code class="hljs${languageClass}">${highlighted}</code></pre></div>`);
}

function renderDiffCodeBlock(code: string, showLanguageHeaders: boolean) {
  const header = showLanguageHeaders
    ? '<div class="code-block-header">diff</div>'
    : '';
  const lines = code.replace(/\n$/, '').split('\n').map((line) => {
    const type = line.startsWith('@@')
      ? 'hunk'
      : line.startsWith('+') && !line.startsWith('+++')
        ? 'added'
        : line.startsWith('-') && !line.startsWith('---')
          ? 'removed'
          : line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
            ? 'meta'
            : 'context';
    return `<span class="diff-code-line diff-${type}">${escapeHtml(line) || ' '}</span>`;
  }).join('');

  return `<div class="code-block diff-code-block">${header}<pre><code class="hljs language-diff">${lines}</code></pre></div>`;
}

function createMarkdownRenderer(showLanguageHeaders: boolean) {
  const renderer = new Renderer();
  renderer.code = (code: string, infostring: string | undefined) => {
    const language = normalizeLanguage(infostring);
    if (language === 'diff') return renderDiffCodeBlock(code, showLanguageHeaders);

    const languageLabel = language || 'text';
    const highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value;
    const languageClass = language ? ` language-${escapeHtml(language)}` : '';
    const header = showLanguageHeaders
      ? `<div class="code-block-header">${escapeHtml(languageLabel)}</div>`
      : '';

    return `<div class="code-block">${header}<pre><code class="hljs${languageClass}">${highlighted}</code></pre></div>`;
  };
  return renderer;
}

marked.setOptions({
  breaks: true,
});

function isFilePath(text: string): boolean {
  if (text.length > 500) return false;
  if (/\s/.test(text)) return false;
  if (/^https?:\/\//.test(text)) return false;
  // SSH URLs (git@host:path) — reject, but allow file:line patterns like xxx.py:80
  if (/@.*:/.test(text)) return false;

  // Strip optional :line or :line:col suffix for validation
  const pathPart = text.replace(/:\d+(?::\d+)?$/, '');

  // Path with directory segments — must have a file extension
  if (/[\\/]/.test(pathPart)) return /\.\w{1,15}$/.test(pathPart);

  // Bare filename — has a dot and looks like a filename
  return /^[\w][\w.-]*\.\w{1,15}$/.test(pathPart);
}

function renderSkillReference(skillName: string, skillPath: string): string {
  return t('components.messageBubble.referencedSkill', {
    link: `<a href="#" class="file-link" data-path="${escapeHtml(skillPath)}" data-kind="path">${escapeHtml(skillName)}</a>`,
  });
}

function collapseExpandedSkillReference(content: string): string {
  if (props.message.role !== 'user') return content;

  const lines = content.split(/\r?\n/);
  const firstContentLine = lines.find((line) => line.trim())?.trim() || '';
  const skillTagMatch = firstContentLine.match(/^<skill\s+[^>]*name="([^"]+)"[^>]*location="([^"]+)"[^>]*>/);
  if (skillTagMatch) {
    return renderSkillReference(skillTagMatch[1], skillTagMatch[2]);
  }

  const referenceLine = lines.find((line) => line.trim().match(/^>?\s*References are relative to .+\.$/))?.trim() || '';
  const referenceMatch = referenceLine.match(/^>?\s*References are relative to (.+?)\.$/);
  if (!referenceMatch || !lines.some((line) => line.trim())) return content;

  const basePath = referenceMatch[1].trim().replace(/\/+$/, '');
  const skillPath = basePath.endsWith('/SKILL.md') ? basePath : `${basePath}/SKILL.md`;
  const skillName = basePath.split('/').filter(Boolean).at(-1) || 'skill';
  return renderSkillReference(skillName, skillPath);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function fileLinkAttributes(path: string): string {
  const escaped = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const kind = /[\\/]/.test(path) ? 'path' : 'filename';
  return `class="file-link" data-path="${escaped}" data-kind="${kind}"`;
}

function makeFilePathsClickable(html: string): string {
  const linkedFiles = html.replace(/<a href="([^"]+)"([^>]*)>/g, (match, href, attributes) => {
    const decoded = decodeHtmlEntities(href);
    if (!isFilePath(decoded)) return match;
    return `<a href="${href}"${attributes} ${fileLinkAttributes(decoded)}>`;
  });

  // Match inline <code> without class attributes (excludes code blocks which have class="hljs").
  return linkedFiles.replace(/<code>([^<]+)<\/code>/g, (match, content) => {
    const decoded = decodeHtmlEntities(content);
    if (!isFilePath(decoded)) return match;
    return `<code ${fileLinkAttributes(decoded)}>${content}</code>`;
  });
}

function renderObservation(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const results = Array.isArray(parsed.results) ? parsed.results : [parsed];
    const contents = results.map((item: unknown) => {
      if (item && typeof item === 'object' && 'content' in item && typeof (item as { content?: unknown }).content === 'string') {
        return (item as { content: string }).content;
      }
      return JSON.stringify(item, null, 2);
    }).join('\n\n');
    return `<pre><code>${escapeHtml(contents)}</code></pre>`;
  } catch {
    return `<pre><code>${escapeHtml(body)}</code></pre>`;
  }
}

function renderMarkdownFragment(content: string): string {
  const contentWithAnsi = ansiToHtml(content);
  const html = marked.parse(contentWithAnsi, {
    renderer: createMarkdownRenderer(props.showCodeBlockLanguageHeaders),
  }) as string;
  return makeFilePathsClickable(html);
}

function renderMarkdown(content: string) {
  return sanitizeHtmlFragment(renderMarkdownFragment(content));
}

function splitThinkingBlock(body: string): { title: string; content: string } {
  const trimmed = body.trim();
  const lines = trimmed.split(/\r?\n/);
  const headingMatch = lines[0]?.match(/^\*\*(.+?)\*\*\s*$/);
  if (headingMatch) return { title: headingMatch[1].trim(), content: lines.slice(1).join('\n').trim() };

  const sentenceMatch = trimmed.match(/^([\s\S]*?[.!?])(?:\s+([\s\S]*))?$/);
  if (sentenceMatch) return { title: sentenceMatch[1].trim(), content: (sentenceMatch[2] || '').trim() };

  const [title = t('components.messageBubble.thinking'), ...remainingLines] = lines;
  return { title: title.trim(), content: remainingLines.join('\n').trim() };
}

function renderAssistantContent(content: string) {
  const segments: Array<{ type: 'text'; content: string } | { type: 'internal'; kind: 'thinking' | 'tool-call' | 'observation'; html: string }> = [];
  const pattern = /^\s*<thinking>([\s\S]*?)<\/thinking>\s*$|^\s*<tool_call([^>]*)>([\s\S]*?)<\/tool_call>\s*$|^\s*<observation>([\s\S]*?)<\/observation>\s*$/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        segments.push({ type: 'text', content: text });
      }
    }

    if (typeof match[1] === 'string') {
      const body = match[1].replace(/^\n|\n$/g, '');
      const thinking = splitThinkingBlock(body);
      const header = `<span class="review-thinking-icon" aria-hidden="true"></span><span>${escapeHtml(thinking.title)}</span>`;
      segments.push({
        type: 'internal',
        kind: 'thinking',
        html: thinking.content
          ? `<details data-internal="thinking" class="review-internal-block"><summary class="review-internal-header">${header}</summary><div class="review-internal-body">${renderMarkdown(thinking.content)}</div></details>`
          : `<div data-internal="thinking" class="review-internal-header review-thinking-only">${header}</div>`,
      });
    } else if (typeof match[3] === 'string') {
      const attrs = match[2] || '';
      const body = match[3].replace(/^\n|\n$/g, '');
      segments.push({
        type: 'internal',
        kind: 'tool-call',
        html: `<div data-internal="tool-call"><pre><code>${escapeHtml(attrs.trim())}\n${escapeHtml(body)}</code></pre></div>`,
      });
    } else if (typeof match[4] === 'string') {
      const body = match[4].replace(/^\n|\n$/g, '');
      segments.push({
        type: 'internal',
        kind: 'observation',
        html: `<details data-internal="observation" class="review-internal-block"><summary class="review-internal-header">${escapeHtml(t('components.messageBubble.observation'))}</summary><div class="review-internal-body">${renderObservation(body)}</div></details>`,
      });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < content.length) {
    const tail = content.slice(lastIndex);
    if (tail.trim()) {
      segments.push({ type: 'text', content: tail });
    }
  }

  const fragment = segments
    .filter((segment) => (
      segment.type !== 'internal'
      || (segment.kind !== 'tool-call' && segment.kind !== 'observation')
      || props.showDetails
    ))
    .map((segment) => (
      segment.type === 'internal' ? segment.html : renderMarkdownFragment(collapseExpandedSkillReference(segment.content))
    ))
    .join('');

  if (!fragment.trim()) return '';
  return sanitizeHtmlFragment(fragment);
}

function handleContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const fileLink = target.closest('.file-link') as HTMLElement | null;
  if (fileLink?.dataset.path) {
    event.preventDefault();
    event.stopPropagation();
    const raw = fileLink.dataset.path;
    const lineMatch = raw.match(/^(.+?):(\d+)(?::(\d+))?$/);
    const path = lineMatch ? lineMatch[1] : raw;
    const line = lineMatch ? Number(lineMatch[2]) : undefined;
    const column = lineMatch?.[3] ? Number(lineMatch[3]) : undefined;
    window.dispatchEvent(new CustomEvent('open-file-in-editor', {
      detail: { path, kind: fileLink.dataset.kind || 'path', line, column },
    }));
  }
}

const renderedContent = computed(() => {
  if (!props.message.content) return '';
  if (props.message.role === 'assistant') {
    return renderAssistantContent(props.message.content);
  }
  return renderMarkdown(collapseExpandedSkillReference(props.message.content));
});

const renderedThinking = computed(() => {
  const summaryTitles = thinkingParts.value.summaryTitles;
  if (summaryTitles && summaryTitles.length > 1) return renderMarkdown(summaryTitles.map((title) => `- ${title}`).join('\n'));
  if (!thinkingBody.value) return '';
  return renderMarkdown(thinkingBody.value);
});

const renderedToolInput = computed(() => {
  if (props.message.kind !== 'tool_call') return '';
  const toolName = (props.message.toolName || '').toLowerCase();
  if (toolName === 'edit') return renderEditDiff();
  if (toolName === 'write') {
    const content = getWriteContent();
    if (content != null) return renderHighlightedCode(content, languageFromPath(getToolInputPath()));
  }
  if (toolName === 'read' && getToolInputPath()) return '';
  if (toolName === 'bash' || toolName === 'shell') {
    const command = getToolInputCommand();
    if (command) return renderHighlightedCode(command, 'bash');
  }
  if (!props.message.toolInput) return '';
  return renderHighlightedCode(props.message.toolInput, inferToolBlockLanguage('input'));
});

const renderedToolOutput = computed(() => {
  if (!props.message.toolOutput) return '';
  return renderHighlightedCode(normalizeTerminalOutput(props.message.toolOutput), inferToolBlockLanguage('output'));
});

function toggleThinkingExpanded() {
  thinkingExpanded.value = !thinkingExpanded.value;
}

function toggleEventExpanded() {
  if (props.message.kind === 'thinking') {
    toggleThinkingExpanded();
    return;
  }
  if (isCollapsibleEvent.value) {
    eventExpanded.value = !eventExpanded.value;
  }
}

async function copyContent() {
  const textToCopy = copyableText.value;
  if (!textToCopy) return;
  await navigator.clipboard.writeText(textToCopy);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>

<style scoped>
.markdown-body {
  --markdown-text: var(--text-primary);
  --markdown-muted: var(--text-secondary);
  --markdown-inline-code-text: #79c0ff;
  --markdown-inline-code-bg: none;
  --markdown-inline-code-border: none;
}

.chat-event-row {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin-bottom: 0.5rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: border-color var(--duration-fast) var(--ease-out);
}

.chat-event-row:hover {
  border-color: var(--border);
}

.status-failure {
  border-color: var(--error-muted);
  background: var(--error-muted);
}

.event-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  color: var(--text-primary);
}

.event-icon {
  flex: 0 0 auto;
  color: var(--text-secondary);
  line-height: 1;
}

.status-failure .event-icon {
  color: var(--error);
}

.event-title {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.event-path {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-family: 'Fira Code', 'Consolas', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

.event-path::before {
  content: '·';
  margin-right: 0.5rem;
  color: var(--text-tertiary);
}

.event-toggle {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.event-block {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0.5rem 0 0;
}

.event-block :deep(.code-block) {
  max-height: min(38vh, 420px);
  margin: 0;
}

.event-block :deep(.code-block pre) {
  max-height: calc(min(38vh, 420px) - 2rem);
}

.event-block :deep(.edit-diff) {
  max-height: min(38vh, 420px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}

.event-block :deep(.edit-diff-hunk + .edit-diff-hunk) {
  border-top: 1px solid var(--border);
}

.event-block :deep(.edit-diff-hunk-header) {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

.event-block :deep(.edit-diff-line) {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  min-width: max-content;
  font-family: 'Fira Code', 'Consolas', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
}

.event-block :deep(.edit-diff-line.removed) {
  background: var(--diff-removed-bg);
}

.event-block :deep(.edit-diff-line.added) {
  background: var(--diff-added-bg);
}

.event-block :deep(.edit-diff-line.context) {
  color: var(--text-secondary);
}

.event-block :deep(.edit-diff-mark) {
  padding: 0 0.4rem;
  user-select: none;
}

.event-block :deep(.edit-diff-line.removed .edit-diff-mark) {
  color: var(--diff-removed-text);
}

.event-block :deep(.edit-diff-line.added .edit-diff-mark) {
  color: var(--diff-added-text);
}

.event-block :deep(.edit-diff-line code) {
  display: block;
  padding-right: 1rem;
  color: var(--text-primary);
  background: transparent;
  white-space: pre;
}

.event-content {
  max-height: min(38vh, 420px);
  margin-top: 0.5rem;
  overflow: auto;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.event-content :deep(pre) {
  max-width: 100%;
  max-height: min(38vh, 420px);
  margin: 0.5rem 0;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  overflow-wrap: normal;
  word-break: normal;
}

.event-content :deep(code) {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.event-content :deep(pre code) {
  overflow-wrap: normal;
  word-break: normal;
}

.event-copy-btn {
  top: 0.35rem;
  right: 0.5rem;
}

.chat-event-row:hover .copy-btn,
.chat-event-row:focus-within .copy-btn {
  opacity: 1;
}

.event-block::-webkit-scrollbar,
.event-content::-webkit-scrollbar,
.event-content :deep(pre)::-webkit-scrollbar,
.message-content :deep(pre)::-webkit-scrollbar,
.thinking-content :deep(pre)::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.event-block::-webkit-scrollbar-track,
.event-content::-webkit-scrollbar-track,
.event-content :deep(pre)::-webkit-scrollbar-track,
.message-content :deep(pre)::-webkit-scrollbar-track,
.thinking-content :deep(pre)::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: 4px;
}

.event-block::-webkit-scrollbar-thumb,
.event-content::-webkit-scrollbar-thumb,
.event-content :deep(pre)::-webkit-scrollbar-thumb,
.message-content :deep(pre)::-webkit-scrollbar-thumb,
.thinking-content :deep(pre)::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.event-block::-webkit-scrollbar-thumb:hover,
.event-content::-webkit-scrollbar-thumb:hover,
.event-content :deep(pre)::-webkit-scrollbar-thumb:hover,
.message-content :deep(pre)::-webkit-scrollbar-thumb:hover,
.thinking-content :deep(pre)::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

.message-bubble {
  position: relative;
  min-width: 0;
  max-width: 100%;
  padding: 1rem;
  border-radius: var(--radius-lg);
  margin-bottom: 0.6rem;
  background: var(--bg-surface);
}

.message-bubble.assistant {
  border: 1px solid var(--border);
}

.message-bubble.user {
  width: fit-content;
  background: var(--user-message-bg);
  color: var(--user-message-text);
  border: 1px solid var(--user-message-border);
  box-shadow: var(--user-message-shadow);
  margin-left: auto;
  max-width: 75%;
  padding: 0.45rem 0.75rem;
}

.message-bubble.git-diff-card {
  padding: 0.65rem 0.75rem 0.75rem;
}

.message-bubble.thinking-only-bubble {
  padding: 0.55rem 0.75rem;
}

.message-bubble.thinking-header-only-bubble {
  padding: 0.25rem 0;
  border-color: transparent;
  background: transparent;
}

.message-actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.message-actions .copy-btn {
  position: relative;
  top: auto;
  right: auto;
}

.copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.copy-btn:hover,
.copy-btn:focus-visible {
  background: var(--bg-elevated);
  border-color: var(--text-tertiary);
  color: var(--text-primary);
  outline: none;
}

.copy-btn::after {
  content: attr(title);
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.4rem);
  padding: 0.25rem 0.45rem;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
  box-shadow: var(--shadow-md);
}

.copy-btn:hover::after,
.copy-btn:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.copy-btn:active {
  transform: scale(0.92);
}

.copy-btn.copied {
  background: var(--success-muted);
  border-color: var(--success);
  color: var(--success);
  opacity: 1;
}

.message-bubble:hover .copy-btn,
.message-bubble:focus-within .copy-btn {
  opacity: 1;
}

.message-bubble.user .copy-btn {
  background: rgba(0, 0, 0, 0.22);
  border-color: rgba(255, 255, 255, 0.42);
  color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

.message-bubble.user .copy-btn:hover,
.message-bubble.user .copy-btn:focus-visible {
  background: rgba(0, 0, 0, 0.34);
  border-color: rgba(255, 255, 255, 0.68);
  color: white;
}

.message-bubble.user .copy-btn::after {
  background: rgba(12, 18, 28, 0.96);
  color: white;
}

/* Thinking block styles */
.thinking-block {
  min-width: 0;
  max-width: 100%;
  margin-bottom: 0.75rem;
}

.compact-thinking {
  margin-bottom: 0;
}

.thinking-header {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.25rem 0;
  user-select: none;
  color: var(--thinking-text);
  transition: color var(--duration-fast) var(--ease-out);
}

.thinking-header:hover {
  color: var(--text-primary);
}

.thinking-icon {
  color: var(--warning);
  flex: 0 0 auto;
}

.thinking-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
}

.thinking-toggle {
  font-size: 0.75rem;
  margin-left: auto;
}

.thinking-content {
  margin-top: 0.5rem;
  color: var(--thinking-text);
  opacity: 0.85;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.thinking-content :deep(pre) {
  max-width: 100%;
  max-height: min(45vh, 520px);
  background: var(--bg-primary);
  padding: 1rem;
  border-radius: var(--radius-md);
  overflow: auto;
  margin: 0.5rem 0;
  overflow-wrap: normal;
  word-break: normal;
}

.thinking-content :deep(code) {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.thinking-content :deep(pre code) {
  overflow-wrap: normal;
  word-break: normal;
}

.thinking-content :deep(p) {
  margin-bottom: 0.5rem;
}

.thinking-content :deep(ul),
.thinking-content :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 0.5rem;
}



.message-images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 12rem));
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.message-images:last-child {
  margin-bottom: 0;
}

.message-image-item {
  position: relative;
}

.message-image {
  display: block;
  width: 100%;
  max-height: 15rem;
  object-fit: cover;
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  cursor: zoom-in;
}

.message-image-annotate {
  position: absolute;
  right: 0.4rem;
  bottom: 0.4rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: var(--radius-sm);
  color: #fff;
  background: rgba(0, 0, 0, 0.68);
  font-size: 0.75rem;
}

.message-image-annotate:hover {
  background: rgba(0, 0, 0, 0.86);
}

.message-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.82);
}

.message-image-lightbox-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xl);
  touch-action: none;
  user-select: none;
}

.message-image-lightbox-image.can-pan {
  cursor: grab;
}

.message-image-lightbox-image.is-dragging {
  cursor: grabbing;
}

.message-image-lightbox-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  color: #fff;
  background: rgba(0, 0, 0, 0.48);
  font-size: 1.75rem;
  line-height: 1;
}

.message-image-lightbox-close:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* Message content styles */
.message-content {
  min-width: 0;
  max-width: 100%;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-content :deep([data-internal]),
.event-content :deep([data-internal]) {
  display: block;
  margin: 0.5rem 0;
}

.message-content :deep([data-internal="thinking"]),
.event-content :deep([data-internal="thinking"]) {
  margin: 0.25rem 0;
  padding-left: 0;
}

.message-content :deep([data-internal="tool-call"]),
.event-content :deep([data-internal="tool-call"]) {
  opacity: 0.8;
}

.message-content :deep([data-internal="observation"]),
.event-content :deep([data-internal="observation"]) {
  border-left: 3px solid var(--text-tertiary);
  padding-left: 0.75rem;
}

.message-content :deep(.review-internal-header),
.event-content :deep(.review-internal-header) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  list-style: none;
  color: var(--thinking-text);
  font-size: 0.8125rem;
  font-weight: 600;
  user-select: none;
}

.message-content :deep(.review-internal-header:hover),
.event-content :deep(.review-internal-header:hover) {
  color: var(--text-primary);
}

.message-content :deep(.review-thinking-only),
.event-content :deep(.review-thinking-only) {
  cursor: default;
}

.message-content :deep(.review-thinking-only::after),
.event-content :deep(.review-thinking-only::after) {
  display: none;
}

.message-content :deep(.review-internal-header::after),
.event-content :deep(.review-internal-header::after) {
  content: '›';
  display: inline-block;
  width: 0.75rem;
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 1rem;
  line-height: 1;
  transition: transform var(--duration-fast) var(--ease-out);
}

.message-content :deep(.review-internal-block[open] > .review-internal-header::after),
.event-content :deep(.review-internal-block[open] > .review-internal-header::after) {
  transform: rotate(90deg);
}

.message-content :deep(.review-thinking-icon),
.event-content :deep(.review-thinking-icon) {
  flex: 0 0 auto;
  width: 1rem;
  color: var(--warning);
  font-size: 0.9rem;
  line-height: 1;
}

.message-content :deep(.review-thinking-icon::before),
.event-content :deep(.review-thinking-icon::before) {
  content: '💡';
}

.message-content :deep(.review-internal-header::-webkit-details-marker),
.event-content :deep(.review-internal-header::-webkit-details-marker) {
  display: none;
}

.message-content :deep(.review-internal-body),
.event-content :deep(.review-internal-body) {
  margin-top: 0.5rem;
  color: var(--thinking-text);
  opacity: 0.85;
}

.message-content :deep([data-internal="thinking"] > .review-internal-body),
.event-content :deep([data-internal="thinking"] > .review-internal-body) {
  margin-top: 0.25rem;
}

.message-content :deep([data-internal] pre),
.event-content :deep([data-internal] pre) {
  white-space: pre;
}

.git-diff-card .message-content :deep(h3:first-child) {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
}

.git-diff-card .message-content :deep(h3:first-child code) {
  color: var(--text-tertiary);
  font-size: 0.78em;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-diff-card .markdown-body :deep(.code-block) {
  max-height: min(58vh, 720px);
  margin: 0.45rem 0;
}

.git-diff-card .markdown-body :deep(.code-block-header) {
  padding: 0.3rem 0.6rem;
}

.git-diff-card .markdown-body :deep(.code-block pre) {
  max-height: calc(min(58vh, 720px) - 1.6rem);
}

.git-diff-card .markdown-body :deep(.code-block code.hljs) {
  padding: 0.65rem 0.75rem;
}

.git-diff-card .markdown-body :deep(.diff-code-block code.hljs) {
  padding: 0.45rem 0;
}

.git-diff-card .markdown-body :deep(.diff-code-line) {
  padding: 0 0.75rem;
}

.message-content :deep(pre) {
  max-width: 100%;
  max-height: min(45vh, 520px);
  background: var(--bg-primary);
  padding: 1rem;
  border-radius: var(--radius-md);
  overflow: auto;
  margin: 0.5rem 0;
  overflow-wrap: normal;
  word-break: normal;
}

.message-content :deep(code) {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-content :deep(pre code) {
  overflow-wrap: normal;
  word-break: normal;
}

.markdown-body :deep(a) {
  color: var(--markdown-accent);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid rgba(121, 192, 255, 0.35);
  transition: color 0.16s ease, border-color 0.16s ease;
}

.markdown-body :deep(a:hover),
.markdown-body :deep(a:focus-visible) {
  color: var(--markdown-accent-hover);
  border-bottom-color: var(--markdown-accent-hover);
  outline: none;
}

.message-bubble.user .markdown-body :deep(a) {
  color: var(--user-message-link);
  border-bottom-color: var(--user-message-link-underline);
}

.message-bubble.user .markdown-body :deep(a:hover),
.message-bubble.user .markdown-body :deep(a:focus-visible) {
  color: var(--user-message-link-hover);
  border-bottom-color: var(--user-message-link-hover);
}

.markdown-body :deep(strong) {
  color: var(--text-primary);
  font-weight: 700;
}

.markdown-body :deep(em) {
  color: var(--markdown-muted);
}

.markdown-body :deep(:not(pre) > code) {
  display: inline-block;
  max-width: 100%;
  padding: 0.08rem 0.38rem;
  border: 1px solid var(--markdown-inline-code-border);
  border-radius: 5px;
  background: var(--markdown-inline-code-bg);
  color: var(--markdown-inline-code-text);
  font-family: 'Fira Code', 'Consolas', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  font-style: normal;
  font-weight: 600;
  line-height: 1.45;
  vertical-align: baseline;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 0.45rem 0;
  color: var(--text-primary);
  font-weight: 750;
  line-height: 1.25;
}

.markdown-body :deep(h1) { font-size: 1.45rem; }
.markdown-body :deep(h2) { font-size: 1.25rem; }
.markdown-body :deep(h3) { font-size: 1.1rem; }
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) { font-size: 1rem; }

.markdown-body :deep(blockquote) {
  margin: 0.75rem 0;
  padding: 0.65rem 0.85rem;
  border-left: 3px solid var(--markdown-quote-border);
  border-radius: 0 8px 8px 0;
  background: var(--markdown-quote-bg);
  color: var(--markdown-muted);
}

.markdown-body :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.35rem;
}

.markdown-body :deep(li) {
  margin: 0.18rem 0;
  padding-left: 0.15rem;
}

.markdown-body :deep(li::marker) {
  color: var(--markdown-accent);
}

.markdown-body :deep(table) {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0.85rem 0;
  overflow: auto;
  border-collapse: collapse;
  color: var(--markdown-text);
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 0.48rem 0.65rem;
  border: 1px solid var(--markdown-table-border);
  text-align: left;
  vertical-align: top;
}

.markdown-body :deep(th) {
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 700;
}

.markdown-body :deep(tr:nth-child(even) td) {
  background: var(--markdown-table-row-bg);
}

.markdown-body :deep(hr) {
  height: 1px;
  margin: 1rem 0;
  border: 0;
  background: var(--border);
}

.markdown-body :deep(.code-block) {
  max-width: 100%;
  max-height: min(45vh, 520px);
  margin: 0.75rem 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}

.markdown-body :deep(.code-block-header) {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-tertiary);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.6875rem;
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

.markdown-body :deep(.code-block pre) {
  max-height: calc(min(45vh, 520px) - 2rem);
  margin: 0;
  padding: 0;
  overflow: auto;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.markdown-body :deep(.code-block code.hljs) {
  display: block;
  padding: 1rem;
  background: transparent;
  color: var(--code-text);
  overflow-wrap: normal;
  word-break: normal;
}

.markdown-body :deep(.diff-code-block code.hljs) {
  padding: 0.75rem 0;
}

.markdown-body :deep(.diff-code-line) {
  display: block;
  box-sizing: border-box;
  min-width: 100%;
  width: max-content;
  padding: 0 1rem;
  white-space: pre;
}

.markdown-body :deep(.diff-added) {
  background: var(--diff-added-bg);
  color: var(--diff-added-text);
}

.markdown-body :deep(.diff-removed) {
  background: var(--diff-removed-bg);
  color: var(--diff-removed-text);
}

.markdown-body :deep(.diff-hunk) {
  background: var(--diff-hunk-bg);
  color: var(--diff-hunk-text);
}

.markdown-body :deep(.diff-meta) {
  color: var(--diff-meta-text);
}

.markdown-body :deep(.hljs-keyword),
.markdown-body :deep(.hljs-selector-tag),
.markdown-body :deep(.hljs-subst) {
  color: var(--syntax-keyword);
}

.markdown-body :deep(.hljs-string),
.markdown-body :deep(.hljs-regexp),
.markdown-body :deep(.hljs-symbol),
.markdown-body :deep(.hljs-bullet) {
  color: var(--syntax-string);
}

.markdown-body :deep(.hljs-comment),
.markdown-body :deep(.hljs-quote) {
  color: var(--syntax-comment);
}

.markdown-body :deep(.hljs-title),
.markdown-body :deep(.hljs-section),
.markdown-body :deep(.hljs-name) {
  color: var(--syntax-title);
}

.markdown-body :deep(.hljs-attr),
.markdown-body :deep(.hljs-attribute),
.markdown-body :deep(.hljs-variable),
.markdown-body :deep(.hljs-template-variable) {
  color: var(--syntax-attr);
}

.markdown-body :deep(.hljs-number),
.markdown-body :deep(.hljs-literal) {
  color: var(--syntax-number);
}

.markdown-body :deep(.hljs-built_in),
.markdown-body :deep(.hljs-type),
.markdown-body :deep(.hljs-class) {
  color: var(--syntax-built-in);
}

.message-content :deep(p) {
  margin: 0 0 0.5rem;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 0.5rem;
}

:deep(.file-link) {
  cursor: pointer;
  color: var(--markdown-accent);
  text-decoration: none;
  transition: color 0.16s ease, text-decoration-color 0.16s ease;
}

:deep(.file-link:hover) {
  color: var(--markdown-accent-hover);
  text-decoration: underline;
  text-decoration-color: var(--markdown-accent-hover);
}

.memory-recall {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.memory-recall-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.memory-recall-toggle:hover {
  color: var(--text-secondary);
}

.memory-recall-panel {
  margin-top: 0.5rem;
  display: grid;
  gap: 0.5rem;
}

.memory-recall-item {
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-surface);
}

.memory-recall-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.25rem;
  color: var(--text-tertiary);
  font-size: 0.7rem;
}

.memory-recall-content,
.memory-recall-empty {
  color: var(--text-secondary);
  line-height: 1.4;
}

.token-usage {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
}
</style>
