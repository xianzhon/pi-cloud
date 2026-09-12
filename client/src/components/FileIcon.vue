<template>
  <span class="file-icon" :class="`icon-${icon.color}`" aria-hidden="true">
    <component :is="icon.component" :size="size" :weight="icon.weight" />
  </span>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
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
  PhPackage,
} from '@phosphor-icons/vue';

const props = withDefaults(defineProps<{
  name: string;
  size?: number;
}>(), {
  size: 15,
});

type IconColor = 'default' | 'typescript' | 'javascript' | 'vue' | 'web' | 'data' | 'docs' | 'image' | 'archive' | 'config' | 'warning';

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
  if (packageFiles.has(lowerName)) return { component: PhPackage, color: 'archive', weight: 'fill' };
  if (lowerName === 'dockerfile' || lowerName === 'makefile') return { component: PhFileCode, color: 'web' };
  if (lowerName.startsWith('.git') || lowerName.startsWith('tsconfig')) return { component: PhFileIni, color: 'config' };

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

const icon = computed<IconDefinition>(() => resolveFileIcon(props.name));
</script>

<style scoped>
.file-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  color: var(--text-secondary);
}

.file-icon.icon-javascript,
.file-icon.icon-image {
  color: #e7b84b;
}

.file-icon.icon-typescript,
.file-icon.icon-docs {
  color: #4d9bd8;
}

.file-icon.icon-vue {
  color: #42b883;
}

.file-icon.icon-web,
.file-icon.icon-warning {
  color: #e06c75;
}

.file-icon.icon-data {
  color: #a78bfa;
}

.file-icon.icon-archive,
.file-icon.icon-config {
  color: #9aa4b2;
}
</style>
