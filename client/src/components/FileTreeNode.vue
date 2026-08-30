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
      <span class="node-icon" :class="`icon-${nodeIcon.color}`">
        <component :is="nodeIcon.component" :size="15" :weight="nodeIcon.weight" />
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
import { computed, type Component } from 'vue';
import {
  PhCaretDown,
  PhCaretRight,
  PhFile,
  PhFileArchive,
  PhFileAudio,
  PhFileC,
  PhFileCode,
  PhFileCpp,
  PhFileCSharp,
  PhFileCss,
  PhFileCsv,
  PhFileHtml,
  PhFileImage,
  PhFileIni,
  PhFileJs,
  PhFileJsx,
  PhFileMd,
  PhFilePdf,
  PhFilePy,
  PhFileRs,
  PhFileSql,
  PhFileSvg,
  PhFileText,
  PhFileTs,
  PhFileTsx,
  PhFileVideo,
  PhFileVue,
  PhFolder,
  PhFolderOpen,
  PhLink,
  PhPackage,
  PhWarning,
} from '@phosphor-icons/vue';

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

type IconColor = 'default' | 'folder' | 'typescript' | 'javascript' | 'vue' | 'web' | 'data' | 'docs' | 'image' | 'archive' | 'config' | 'warning';

type IconDefinition = {
  component: Component;
  color: IconColor;
  weight?: 'regular' | 'fill';
};

const fileIcons: Record<string, IconDefinition> = {
  c: { component: PhFileC, color: 'typescript' },
  cc: { component: PhFileCpp, color: 'typescript' },
  cpp: { component: PhFileCpp, color: 'typescript' },
  cs: { component: PhFileCSharp, color: 'vue' },
  css: { component: PhFileCss, color: 'web' },
  less: { component: PhFileCss, color: 'web' },
  sass: { component: PhFileCss, color: 'web' },
  scss: { component: PhFileCss, color: 'web' },
  csv: { component: PhFileCsv, color: 'data' },
  h: { component: PhFileC, color: 'typescript' },
  hpp: { component: PhFileCpp, color: 'typescript' },
  htm: { component: PhFileHtml, color: 'web' },
  html: { component: PhFileHtml, color: 'web' },
  js: { component: PhFileJs, color: 'javascript' },
  cjs: { component: PhFileJs, color: 'javascript' },
  mjs: { component: PhFileJs, color: 'javascript' },
  jsx: { component: PhFileJsx, color: 'javascript' },
  json: { component: PhFileCode, color: 'data' },
  jsonc: { component: PhFileCode, color: 'data' },
  md: { component: PhFileMd, color: 'docs' },
  mdx: { component: PhFileMd, color: 'docs' },
  pdf: { component: PhFilePdf, color: 'warning' },
  py: { component: PhFilePy, color: 'javascript' },
  rs: { component: PhFileRs, color: 'archive' },
  sql: { component: PhFileSql, color: 'data' },
  svg: { component: PhFileSvg, color: 'javascript' },
  ts: { component: PhFileTs, color: 'typescript' },
  tsx: { component: PhFileTsx, color: 'typescript' },
  vue: { component: PhFileVue, color: 'vue' },
};

const imageExtensions = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'webp']);
const archiveExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'tgz', 'zip']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const videoExtensions = new Set(['avi', 'mkv', 'mov', 'mp4', 'webm']);
const configExtensions = new Set(['conf', 'env', 'ini', 'toml', 'yaml', 'yml']);
const textExtensions = new Set(['log', 'text', 'txt']);
const packageFiles = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-lock.yml', 'yarn.lock']);

function resolveFileIcon(name: string): IconDefinition {
  const lowerName = name.toLowerCase();
  if (packageFiles.has(lowerName)) {
    return { component: PhPackage, color: 'archive', weight: 'fill' };
  }
  if (lowerName === 'dockerfile' || lowerName === 'makefile') {
    return { component: PhFileCode, color: 'web' };
  }
  if (lowerName.startsWith('.git') || lowerName.startsWith('tsconfig')) {
    return { component: PhFileIni, color: 'config' };
  }

  const extension = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : '';
  if (fileIcons[extension]) return fileIcons[extension];
  if (imageExtensions.has(extension)) return { component: PhFileImage, color: 'image' };
  if (archiveExtensions.has(extension)) return { component: PhFileArchive, color: 'archive' };
  if (audioExtensions.has(extension)) return { component: PhFileAudio, color: 'vue' };
  if (videoExtensions.has(extension)) return { component: PhFileVideo, color: 'warning' };
  if (configExtensions.has(extension)) return { component: PhFileIni, color: 'config' };
  if (textExtensions.has(extension)) return { component: PhFileText, color: 'docs' };
  return { component: PhFile, color: 'default' };
}

const isExpanded = computed(() => props.expandedPaths.has(props.node.path));
const nodeIcon = computed<IconDefinition>(() => {
  if (props.node.type === 'directory') {
    return {
      component: isExpanded.value ? PhFolderOpen : PhFolder,
      color: 'folder',
      weight: 'fill',
    };
  }
  if (!props.node.isSymlink) return resolveFileIcon(props.node.name);
  if (props.node.targetType === 'missing') return { component: PhWarning, color: 'warning', weight: 'fill' };
  return { component: PhLink, color: 'default' };
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

.node-icon.icon-folder,
.node-icon.icon-javascript,
.node-icon.icon-image {
  color: #e7b84b;
}

.node-icon.icon-typescript,
.node-icon.icon-docs {
  color: #4d9bd8;
}

.node-icon.icon-vue {
  color: #42b883;
}

.node-icon.icon-web,
.node-icon.icon-warning {
  color: #e06c75;
}

.node-icon.icon-data {
  color: #a78bfa;
}

.node-icon.icon-archive,
.node-icon.icon-config {
  color: #9aa4b2;
}

.node-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}
</style>
