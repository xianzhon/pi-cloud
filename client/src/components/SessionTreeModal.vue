<template>
  <Teleport to="body">
    <div class="tree-modal-backdrop">
      <div class="tree-modal" role="dialog" aria-modal="true" :aria-label="t('components.sessionTreeModal.sessionTree')">
        <header class="tree-modal-header">
          <div>
            <h3>{{ t('components.sessionTreeModal.sessionTree') }}</h3>
            <p>{{ t('components.sessionTreeModal.jumpToAnEarlierPointAndContinue') }}</p>
          </div>
          <DialogCloseButton :label="t('components.sessionTreeModal.cancel')" @click="emit('close')" />
        </header>

        <div v-if="isLoading" class="tree-modal-state">{{ t('components.sessionTreeModal.loadingSessionTree') }}</div>
        <div v-else-if="error" class="tree-modal-state error">{{ error }}</div>
        <div v-else-if="flatNodes.length === 0" class="tree-modal-state">{{ t('components.sessionTreeModal.noSessionEntriesYet') }}</div>
        <div v-else class="tree-list" role="listbox" :aria-label="t('components.sessionTreeModal.sessionTreeEntries')">
          <div
            v-for="node in flatNodes"
            :key="node.entry.id"
            class="tree-row"
            :class="{ selected: node.entry.id === selectedId, leaf: node.entry.id === leafId }"
            role="option"
            tabindex="0"
            :aria-selected="node.entry.id === selectedId"
            @click="selectedId = node.entry.id"
            @keydown.enter.prevent="selectedId = node.entry.id"
          >
            <span class="tree-prefix" aria-hidden="true">
              <span v-for="(isActiveGuide, level) in node.guides" :key="level" class="tree-guide">
                <span v-if="isActiveGuide" class="tree-guide-line"></span>
              </span>
              <span
                v-if="node.connector"
                class="tree-connector"
                :class="{ last: node.connector === '└' }"
              ></span>
            </span>
            <button
              v-if="node.isBranch"
              type="button"
              class="tree-branch-toggle"
              :aria-label="node.isCollapsed ? t('components.sessionTreeModal.expandBranch') : t('components.sessionTreeModal.collapseBranch')"
              @click.stop="toggleCollapsed(node.entry.id)"
            >
              {{ node.isCollapsed ? '⊞' : '⊟' }}
            </button>
            <span v-else class="tree-branch-spacer" aria-hidden="true"></span>
            <span class="tree-role-dot" :class="`role-${entryRole(node.entry)}`" aria-hidden="true"></span>
            <span class="tree-row-main">
              <span class="tree-row-title">
                <span class="tree-row-role" :class="`role-${entryRole(node.entry)}`">{{ entryRole(node.entry) }}:</span>
                <span class="tree-row-text">{{ entryText(node.entry) }}</span>
                <span v-if="node.label" class="tree-row-badge">{{ node.label }}</span>
                <span v-if="node.entry.id === leafId" class="tree-row-badge">{{ t('components.sessionTreeModal.current') }}</span>
              </span>
            </span>
          </div>
        </div>

        <footer class="tree-modal-footer">
          <label class="summary-toggle">
            <input v-model="summarize" type="checkbox" />
            {{ t('components.sessionTreeModal.summarizeAbandonedBranch') }}
          </label>
          <div class="tree-modal-actions">
            <button type="button" class="dialog-action secondary-btn" @click="emit('close')">{{ t('components.sessionTreeModal.cancel') }}</button>
            <button type="button" class="dialog-action primary-btn" :disabled="!selectedId || isNavigating" @click="navigate">
              {{ isNavigating ? t('components.sessionTreeModal.navigating') : t('components.sessionTreeModal.navigate') }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, onMounted, ref, watch } from 'vue';
import DialogCloseButton from './DialogCloseButton.vue';

const t = i18n.global.t;

interface SessionTreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  summary?: string;
  thinkingLevel?: string;
  provider?: string;
  modelId?: string;
  customType?: string;
}

interface SessionTreeNode {
  entry: SessionTreeEntry;
  children: SessionTreeNode[];
  label?: string;
}

interface FlatTreeNode extends SessionTreeNode {
  depth: number;
  guides: boolean[];
  connector: '├' | '└' | '';
  isBranch: boolean;
  isCollapsed: boolean;
}

const props = defineProps<{
  sessionId: string;
  clientId: string;
}>();

const emit = defineEmits<{
  close: [];
  navigated: [result: { editorText?: string }];
}>();

const tree = ref<SessionTreeNode[]>([]);
const leafId = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const collapsedIds = ref<Set<string>>(new Set());
const summarize = ref(false);
const isLoading = ref(false);
const isNavigating = ref(false);
const error = ref('');

const flatNodes = computed(() => flattenTree(tree.value));

onMounted(loadTree);
watch(() => props.sessionId, loadTree);

function isVisibleEntry(entry: SessionTreeEntry) {
  if (entry.type !== 'message') return false;
  if (entry.message?.role !== 'user' && entry.message?.role !== 'assistant') return false;
  return stringifyContent(entry.message.content).trim().length > 0;
}

function visibleChildrenFor(node: SessionTreeNode): SessionTreeNode[] {
  return (node.children || []).flatMap((child) => (
    isVisibleEntry(child.entry) ? [child] : visibleChildrenFor(child)
  ));
}

function visibleRoots(nodes: SessionTreeNode[]): SessionTreeNode[] {
  return nodes.flatMap((node) => (
    isVisibleEntry(node.entry) ? [node] : visibleChildrenFor(node)
  ));
}

function flattenNode(
  node: SessionTreeNode,
  guides: boolean[],
  connector: FlatTreeNode['connector'],
): FlatTreeNode[] {
  const children = visibleChildrenFor(node);
  const isBranch = children.length > 1;
  const isCollapsed = collapsedIds.value.has(node.entry.id);
  const row: FlatTreeNode = {
    ...node,
    depth: guides.length,
    guides,
    connector,
    isBranch,
    isCollapsed,
  };
  if (isCollapsed) return [row];

  const childGuides = connector ? [...guides, connector === '├'] : guides;

  if (!isBranch) {
    return [
      row,
      ...children.flatMap((child) => flattenNode(child, childGuides, '')),
    ];
  }

  return [
    row,
    ...children.flatMap((child, index) => flattenNode(
      child,
      childGuides,
      isBranch ? (index === children.length - 1 ? '└' : '├') : '',
    )),
  ];
}

function flattenTree(nodes: SessionTreeNode[]): FlatTreeNode[] {
  return visibleRoots(nodes).flatMap((node) => flattenNode(node, [], ''));
}

function toggleCollapsed(entryId: string) {
  const next = new Set(collapsedIds.value);
  if (next.has(entryId)) {
    next.delete(entryId);
  } else {
    next.add(entryId);
  }
  collapsedIds.value = next;
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item: any) => item?.text || item?.content || '').filter(Boolean).join(' ');
  }
  if (content == null) return '';
  return String(content);
}

function entryRole(entry: SessionTreeEntry) {
  return entry.message?.role || entry.type;
}

function entryText(entry: SessionTreeEntry) {
  if (entry.type === 'message') {
    return stringifyContent(entry.message?.content).replace(/\s+/g, ' ').trim() || '(empty)';
  }

  if (entry.type === 'branch_summary' || entry.type === 'compaction') {
    return (entry.summary || '').replace(/\s+/g, ' ').slice(0, 120);
  }

  if (entry.type === 'model_change') return `${entry.provider || ''}/${entry.modelId || ''}`;
  if (entry.type === 'thinking_level_change') return entry.thinkingLevel || '';
  if (entry.type === 'custom' || entry.type === 'custom_message') return entry.customType || '';
  return entry.type;
}

async function loadTree() {
  isLoading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ clientId: props.clientId });
    const response = await fetch(`/api/sessions/${props.sessionId}/tree?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.oversized) throw new Error(data.message || t('components.sessionTreeModal.thisSessionTreeIsTooLargeTo'));
    tree.value = Array.isArray(data.tree) ? data.tree : [];
    leafId.value = data.leafId || null;
    selectedId.value = flatNodes.value.some((node) => node.entry.id === leafId.value)
      ? leafId.value
      : flatNodes.value[0]?.entry.id || null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('components.sessionTreeModal.failedToLoadSessionTree');
  } finally {
    isLoading.value = false;
  }
}

async function navigate() {
  if (!selectedId.value) return;
  isNavigating.value = true;
  error.value = '';
  try {
    const response = await fetch(`/api/sessions/${props.sessionId}/tree/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: props.clientId,
        targetId: selectedId.value,
        summarize: summarize.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (!data.cancelled) emit('navigated', { editorText: data.editorText });
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('components.sessionTreeModal.failedToNavigateSessionTree');
  } finally {
    isNavigating.value = false;
  }
}
</script>

<style scoped>
.tree-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
}

.tree-modal {
  width: min(1040px, 96vw);
  max-height: min(760px, 92vh);
  display: flex;
  flex-direction: column;
  background: #070d14;
  border: 1px solid color-mix(in srgb, var(--border) 72%, #6e8cff 28%);
  border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  color: #e6e0f6;
  overflow: hidden;
}

.tree-modal-header,
.tree-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid rgba(126, 139, 166, 0.28);
  background: #0b0c12;
}

.tree-modal-footer {
  border-top: 1px solid rgba(126, 139, 166, 0.28);
  border-bottom: 0;
  background: #0b0c12;
}

.tree-modal-header h3 {
  margin: 0 0 0.25rem;
  color: #f1eefc;
  font-size: 1.15rem;
  letter-spacing: 0;
}

.tree-modal-header p,
.tree-modal-state {
  color: #818b9b;
}

.tree-modal-header p {
  margin: 0;
  font-size: 0.86rem;
}

.tree-modal-state {
  padding: 2rem;
  text-align: center;
}

.tree-modal-state.error {
  color: var(--danger, #ef4444);
}

.tree-list {
  overflow: auto;
  padding: 0.65rem 0.75rem 0.85rem;
  background: #06111b;
  scrollbar-color: rgba(126, 139, 166, 0.45) transparent;
}

.tree-row {
  width: 100%;
  display: flex;
  align-items: center;
  min-height: 1.5rem;
  padding: 0 0.25rem;
  color: #e6e0f6;
  background: transparent;
  border: 0;
  border-radius: 3px;
  font-family: "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace;
  font-size: 0.95rem;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.tree-row:hover,
.tree-row.selected {
  background: rgba(91, 119, 179, 0.26);
}

.tree-row.leaf {
  background: rgba(93, 118, 163, 0.18);
}

.tree-prefix {
  flex: 0 0 auto;
  display: inline-flex;
  min-width: 0;
  margin-right: 0;
  line-height: inherit;
  white-space: pre;
}

.tree-guide {
  display: inline-block;
  width: 1.42rem;
  text-align: left;
}

.tree-guide {
  position: relative;
  height: 1.5rem;
}

.tree-guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0.28rem;
  border-left: 1px solid #6b8cff;
}

.tree-connector {
  display: inline-block;
  width: 1.42rem;
  height: 1.5rem;
  position: relative;
}

.tree-connector::before,
.tree-connector::after {
  content: "";
  position: absolute;
  background: #6b8cff;
}

.tree-connector::before {
  top: 0;
  bottom: 0;
  left: 0.28rem;
  width: 1px;
}

.tree-connector.last::before {
  bottom: 50%;
}

.tree-connector::after {
  top: 50%;
  left: 0.28rem;
  right: 0;
  height: 1px;
}

.tree-branch-toggle,
.tree-branch-spacer {
  flex: 0 0 1.12rem;
  width: 1.12rem;
  height: 1.5rem;
  margin: 0 0.12rem 0 0;
}

.tree-branch-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px 0 0;
  color: #6b8cff;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}

.tree-branch-toggle:hover {
  color: #6b8cff;
}

.tree-role-dot {
  flex: 0 0 auto;
  width: 0.3rem;
  height: 0.3rem;
  margin: 0 0.5rem 0 0;
  border-radius: 999px;
}

.tree-role-dot.role-user {
  background: #2f8cff;
}

.tree-role-dot.role-assistant {
  background: #34d267;
}

.tree-row-main {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.tree-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.5;
}

.tree-row-role {
  margin-right: 0.42rem;
  font-weight: 600;
}

.tree-row-role.role-user {
  color: #2f8cff;
}

.tree-row-role.role-assistant {
  color: #34d267;
}

.tree-row-text {
  color: #e6e0f6;
}

.tree-row-badge {
  margin-left: 0.5rem;
  color: #818b9b;
  font-size: 0.78rem;
}

.summary-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #a3a6b7;
  font-size: 0.88rem;
}

.summary-toggle input {
  width: 1rem;
  height: 1rem;
  accent-color: #6b8cff;
}

.tree-modal-actions {
  display: flex;
  gap: 0.5rem;
}

.primary-btn,
.secondary-btn {
  cursor: pointer;
}

.primary-btn {
  color: white;
  background: #6b8cff;
  border: 1px solid #6b8cff;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  color: #e6e0f6;
  background: #1a1b25;
  border: 1px solid rgba(126, 139, 166, 0.32);
}

@media (max-width: 640px) {
  .tree-modal {
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }

  .tree-modal-backdrop {
    padding: 0;
  }

  .tree-row {
    font-size: 0.86rem;
  }

  .tree-guide,
  .tree-connector {
    width: 1rem;
  }

  .tree-modal-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .tree-modal-actions {
    justify-content: flex-end;
  }
}
</style>
