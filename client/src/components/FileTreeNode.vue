<template>
  <div>
    <div
      class="tree-node"
      :class="{
        directory: node.type === 'directory',
        active: node.path === activePath,
        selected: node.type === 'directory' && node.path === selectedDirectoryPath,
      }"
      :data-tree-current="node.path === activePath ? 'true' : undefined"
      :style="{ paddingLeft: `${0.5 + level * 1}rem` }"
      @click="handleClick"
      @contextmenu.prevent.stop="handleContextMenu"
    >
      <span class="node-toggle">
        <PhCaretDown v-if="node.type === 'directory' && isExpanded" :size="12" />
        <PhCaretRight v-else-if="node.type === 'directory'" :size="12" />
      </span>
      <span class="node-icon">
        <PhFolder v-if="nodeIcon === 'folder'" :size="14" weight="fill" />
        <PhFile v-else-if="nodeIcon === 'file'" :size="14" />
        <PhLink v-else-if="nodeIcon === 'link'" :size="14" />
        <PhWarning v-else-if="nodeIcon === 'link-warning'" :size="14" weight="fill" />
      </span>
      <span class="node-name" :title="nodeTitle">{{ node.name }}</span>
    </div>

    <FileTreeNode
      v-if="node.type === 'directory' && isExpanded"
      v-for="child in node.children || []"
      :key="child.path"
      :node="child"
      :level="level + 1"
      :expanded-paths="expandedPaths"
      :active-path="activePath"
      :selected-directory-path="selectedDirectoryPath"
      @open="$emit('open', $event)"
      @toggle="$emit('toggle', $event)"
      @select-dir="$emit('selectDir', $event)"
      @context-menu="(...args) => $emit('contextMenu', ...args)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { PhFolder, PhFile, PhLink, PhWarning, PhCaretDown, PhCaretRight } from '@phosphor-icons/vue';

export interface TreeNodeData {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isSymlink?: boolean;
  linkTarget?: string;
  targetType?: 'file' | 'directory' | 'missing' | 'other';
  children?: TreeNodeData[];
}

const props = defineProps<{
  node: TreeNodeData;
  level: number;
  expandedPaths: Set<string>;
  activePath?: string;
  selectedDirectoryPath?: string;
}>();

const emit = defineEmits<{
  open: [path: string];
  toggle: [node: TreeNodeData];
  selectDir: [path: string];
  contextMenu: [event: MouseEvent, node: TreeNodeData];
}>();

const isExpanded = computed(() => props.expandedPaths.has(props.node.path));
const nodeIcon = computed(() => {
  if (props.node.type === 'directory') return 'folder';
  if (!props.node.isSymlink) return 'file';
  if (props.node.targetType === 'missing') return 'link-warning';
  return 'link';
});
const nodeTitle = computed(() => {
  if (!props.node.isSymlink || !props.node.linkTarget) return props.node.path;
  return `${props.node.path} → ${props.node.linkTarget}`;
});
const toggleIcon = computed(() => {
  if (props.node.type !== 'directory') return '';
  return isExpanded.value ? '▾' : '▸';
});

function handleClick() {
  if (props.node.type === 'directory') {
    emit('selectDir', props.node.path);
    emit('toggle', props.node);
  } else {
    emit('open', props.node.path);
  }
}

function handleContextMenu(event: MouseEvent) {
  if (props.node.type === 'directory') {
    emit('selectDir', props.node.path);
  }
  emit('contextMenu', event, props.node);
}
</script>

<style scoped>
.tree-node {
  padding: 0.25rem 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out);
}

.tree-node:hover {
  background: var(--bg-surface);
}

.tree-node.active,
.tree-node.selected {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-primary);
}

.tree-node.active .node-icon,
.tree-node.active .node-toggle,
.tree-node.selected .node-icon,
.tree-node.selected .node-toggle {
  color: var(--accent);
}

.node-toggle {
  width: 0.75rem;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.node-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  color: var(--text-secondary);
}

.node-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}
</style>
