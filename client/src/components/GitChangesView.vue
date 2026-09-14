<template>
  <Teleport to="body">
    <div v-if="visible" class="git-changes-backdrop">
      <section class="git-changes-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <header class="git-changes-header">
          <div>
            <h2 :id="titleId"><PhGitDiff :size="20" weight="fill" /> {{ t('components.gitChanges.title') }}</h2>
            <p>{{ branch || 'HEAD' }} <span aria-hidden="true">·</span> {{ cwd }}</p>
          </div>
          <div class="git-changes-header-actions">
            <button type="button" :aria-label="t('components.gitChanges.refresh')" :title="t('components.gitChanges.refresh')" :disabled="loading" @click="refresh()">
              <PhArrowClockwise :size="17" weight="bold" />
            </button>
            <button type="button" :aria-label="t('components.gitChanges.close')" :title="t('components.gitChanges.close')" @click="emit('close')">
              <PhX :size="17" weight="bold" />
            </button>
          </div>
        </header>

        <div class="git-changes-body">
          <aside class="git-changes-files">
            <div v-if="loading" class="git-changes-state">{{ t('components.gitChanges.loading') }}</div>
            <div v-else-if="statusError" class="git-changes-state is-error" role="alert">{{ statusError }}</div>
            <template v-else>
              <section class="git-change-group">
                <h3>{{ t('components.gitChanges.unstagedChanges') }} <span>{{ unstagedFiles.length }}</span></h3>
                <p v-if="!unstagedFiles.length" class="git-change-empty">{{ t('components.gitChanges.none') }}</p>
                <button
                  v-for="file in unstagedFiles"
                  :key="`unstaged:${file.path}`"
                  type="button"
                  class="git-change-file"
                  :class="{ 'is-selected': selected?.scope === 'unstaged' && selected.path === file.path }"
                  @click="selectFile(file.path, 'unstaged')"
                >
                  <span class="git-change-status">{{ file.status }}</span>
                  <span class="git-change-path">{{ file.path }}</span>
                  <span
                    class="git-change-file-action"
                    role="button"
                    tabindex="0"
                    :title="t('components.gitChanges.stageFile')"
                    :aria-label="t('components.gitChanges.stageFileNamed', { path: file.path })"
                    @click.stop="mutateFile(file.path, 'unstaged')"
                    @keydown.enter.stop="mutateFile(file.path, 'unstaged')"
                  ><PhPlus :size="15" weight="bold" /></span>
                </button>
              </section>

              <section class="git-change-group is-staged">
                <h3>{{ t('components.gitChanges.stagedChanges') }} <span>{{ stagedFiles.length }}</span></h3>
                <p v-if="!stagedFiles.length" class="git-change-empty">{{ t('components.gitChanges.none') }}</p>
                <button
                  v-for="file in stagedFiles"
                  :key="`staged:${file.path}`"
                  type="button"
                  class="git-change-file"
                  :class="{ 'is-selected': selected?.scope === 'staged' && selected.path === file.path }"
                  @click="selectFile(file.path, 'staged')"
                >
                  <span class="git-change-status">{{ file.status }}</span>
                  <span class="git-change-path">{{ file.path }}</span>
                  <span
                    class="git-change-file-action"
                    role="button"
                    tabindex="0"
                    :title="t('components.gitChanges.unstageFile')"
                    :aria-label="t('components.gitChanges.unstageFileNamed', { path: file.path })"
                    @click.stop="mutateFile(file.path, 'staged')"
                    @keydown.enter.stop="mutateFile(file.path, 'staged')"
                  ><PhMinus :size="15" weight="bold" /></span>
                </button>
              </section>
            </template>
          </aside>

          <main class="git-changes-detail">
            <div v-if="!selected" class="git-changes-state">{{ t('components.gitChanges.selectFile') }}</div>
            <template v-else>
              <header class="git-changes-detail-header">
                <div>
                  <strong>{{ selected.path }}</strong>
                  <span :class="selected.scope">{{ t(selected.scope === 'staged' ? 'components.gitChanges.staged' : 'components.gitChanges.unstaged') }}</span>
                </div>
                <button type="button" :disabled="updating" @click="mutateFile(selected.path, selected.scope)">
                  {{ t(selected.scope === 'staged' ? 'components.gitChanges.unstageFile' : 'components.gitChanges.stageFile') }}
                </button>
              </header>
              <div v-if="diffLoading" class="git-changes-state">{{ t('components.gitChanges.loadingDiff') }}</div>
              <div v-else-if="diffError" class="git-changes-state is-error" role="alert">{{ diffError }}</div>
              <div v-else-if="!renderLines.length" class="git-changes-state">{{ t('components.gitChanges.noPatch') }}</div>
              <div
                v-else
                ref="diffRoot"
                class="git-changes-diff"
                @contextmenu="closeContextMenu"
              >
                <pre><span
                  v-for="(line, index) in renderLines"
                  :key="index"
                  class="git-changes-line"
                  :class="diffLineClass(line.text)"
                  :data-hunk-index="line.hunkIndex"
                  :data-hunk-line-index="line.hunkLineIndex"
                  @contextmenu.stop.prevent="openContextMenu($event, line)"
                >{{ line.text }}{{ '\n' }}</span></pre>
              </div>
            </template>
          </main>
        </div>
      </section>

      <div
        v-if="contextMenu"
        class="git-changes-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        role="menu"
        @pointerdown.stop
      >
        <button v-if="contextMenu.selectedLines.length" type="button" role="menuitem" @click="mutateSelection('lines')">
          {{ t(selected?.scope === 'staged' ? 'components.gitChanges.unstageLines' : 'components.gitChanges.stageLines') }}
        </button>
        <button type="button" role="menuitem" @click="mutateSelection('hunk')">
          {{ t(selected?.scope === 'staged' ? 'components.gitChanges.unstageHunk' : 'components.gitChanges.stageHunk') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PhArrowClockwise, PhGitDiff, PhMinus, PhPlus, PhX } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { createGitOperations } from '../services/gitOperations';
import { diffLineClass } from '../utils/gitDiff';

type DiffScope = 'staged' | 'unstaged';

interface GitStatusFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
}

interface SelectedFile {
  path: string;
  scope: DiffScope;
}

interface RenderLine {
  text: string;
  hunkIndex?: number;
  hunkLineIndex?: number;
}

interface DiffHunk {
  header: string;
  lines: string[];
}

const props = defineProps<{ visible: boolean; cwd: string }>();
const emit = defineEmits<{ close: [] }>();
const t = i18n.global.t;
const gitOperations = createGitOperations();
const titleId = 'git-changes-title';
const files = ref<GitStatusFile[]>([]);
const branch = ref('');
const selected = ref<SelectedFile>();
const diffContent = ref('');
const loading = ref(false);
const diffLoading = ref(false);
const updating = ref(false);
const statusError = ref('');
const diffError = ref('');
const diffRoot = ref<HTMLElement>();
const contextMenu = ref<{ x: number; y: number; hunkIndex: number; selectedLines: number[] }>();
let requestId = 0;
let diffRequestId = 0;

const unstagedFiles = computed(() => files.value.filter(file => file.unstaged));
const stagedFiles = computed(() => files.value.filter(file => file.staged));
const parsedDiff = computed(() => parseDiff(diffContent.value));
const renderLines = computed(() => parsedDiff.value.lines);

function parseDiff(content: string): { lines: RenderLine[]; hunks: DiffHunk[] } {
  const lines: RenderLine[] = [];
  const hunks: DiffHunk[] = [];
  let hunkIndex: number | undefined;
  for (const text of content.split('\n')) {
    if (text.startsWith('@@ ')) {
      hunkIndex = hunks.length;
      hunks.push({ header: text, lines: [] });
      lines.push({ text, hunkIndex });
    } else if (hunkIndex !== undefined) {
      const hunk = hunks[hunkIndex];
      const hunkLineIndex = hunk.lines.length;
      hunk.lines.push(text);
      lines.push({ text, hunkIndex, hunkLineIndex });
    } else {
      lines.push({ text });
    }
  }
  return { lines, hunks };
}

function expectedHunk(hunk: DiffHunk): string {
  return [hunk.header, ...hunk.lines].join('\n').replace(/\n+$/, '');
}

function isChangedLine(line: RenderLine): boolean {
  return line.hunkLineIndex !== undefined
    && ((line.text.startsWith('+') && !line.text.startsWith('+++'))
      || (line.text.startsWith('-') && !line.text.startsWith('---')));
}

async function loadDiff(): Promise<void> {
  if (!selected.value) return;
  const current = { ...selected.value };
  const currentRequestId = ++diffRequestId;
  diffLoading.value = true;
  diffError.value = '';
  contextMenu.value = undefined;
  try {
    const result = await gitOperations.getDiff({
      cwd: props.cwd,
      path: current.path,
      scope: current.scope,
      includeUntracked: current.scope === 'unstaged',
    });
    if (currentRequestId !== diffRequestId) return;
    diffContent.value = typeof result.diff === 'string' ? result.diff : '';
  } catch (cause) {
    if (currentRequestId === diffRequestId) diffError.value = cause instanceof Error ? cause.message : t('components.gitChanges.diffFailed');
  } finally {
    if (currentRequestId === diffRequestId) diffLoading.value = false;
  }
}

function selectFile(path: string, scope: DiffScope): void {
  selected.value = { path, scope };
  diffContent.value = '';
  void loadDiff();
}

async function refresh(preferred = selected.value): Promise<void> {
  const currentRequestId = ++requestId;
  loading.value = true;
  statusError.value = '';
  try {
    const [status, branches] = await Promise.all([
      gitOperations.getStatus({ cwd: props.cwd }),
      gitOperations.getBranches(props.cwd),
    ]);
    if (currentRequestId !== requestId) return;
    files.value = Array.isArray(status.files) ? status.files as GitStatusFile[] : [];
    branch.value = typeof branches.current === 'string' ? branches.current : 'HEAD';
    const available = (candidate: SelectedFile | undefined) => candidate && files.value.some(file =>
      file.path === candidate.path && file[candidate.scope]);
    if (available(preferred)) selected.value = preferred;
    else if (preferred && available({ path: preferred.path, scope: preferred.scope === 'staged' ? 'unstaged' : 'staged' })) {
      selected.value = { path: preferred.path, scope: preferred.scope === 'staged' ? 'unstaged' : 'staged' };
    } else if (unstagedFiles.value[0]) selected.value = { path: unstagedFiles.value[0].path, scope: 'unstaged' };
    else if (stagedFiles.value[0]) selected.value = { path: stagedFiles.value[0].path, scope: 'staged' };
    else selected.value = undefined;
    diffContent.value = '';
    if (selected.value) await loadDiff();
  } catch (cause) {
    if (currentRequestId === requestId) statusError.value = cause instanceof Error ? cause.message : t('components.gitChanges.loadFailed');
  } finally {
    if (currentRequestId === requestId) loading.value = false;
  }
}

async function updateIndex(options: Parameters<ReturnType<typeof createGitOperations>['updateIndex']>[0]): Promise<void> {
  updating.value = true;
  diffError.value = '';
  try {
    await gitOperations.updateIndex(options);
    window.dispatchEvent(new CustomEvent('refresh-git-status'));
    await refresh({ path: options.path, scope: options.scope });
  } catch (cause) {
    diffError.value = cause instanceof Error ? cause.message : t('components.gitChanges.updateFailed');
  } finally {
    updating.value = false;
  }
}

function mutateFile(path: string, scope: DiffScope): void {
  if (updating.value) return;
  void updateIndex({ cwd: props.cwd, path, scope, mode: 'file' });
}

function selectedLineIndexes(clicked: RenderLine): number[] {
  if (clicked.hunkIndex === undefined) return [];
  const selection = window.getSelection();
  const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : undefined;
  const indexes = Array.from(diffRoot.value?.querySelectorAll<HTMLElement>('.git-changes-line') || [])
    .filter((element) => {
      if (!range || Number(element.dataset.hunkIndex) !== clicked.hunkIndex) return false;
      try { return range.intersectsNode(element); } catch { return false; }
    })
    .map(element => Number(element.dataset.hunkLineIndex))
    .filter(index => Number.isInteger(index) && isChangedLine(parsedDiff.value.lines.find(line =>
      line.hunkIndex === clicked.hunkIndex && line.hunkLineIndex === index) || { text: '' }));
  return indexes.length ? Array.from(new Set(indexes)) : isChangedLine(clicked) ? [clicked.hunkLineIndex as number] : [];
}

function openContextMenu(event: MouseEvent, line: RenderLine): void {
  if (line.hunkIndex === undefined || updating.value) return;
  contextMenu.value = {
    x: Math.min(event.clientX, window.innerWidth - 230),
    y: Math.min(event.clientY, window.innerHeight - 110),
    hunkIndex: line.hunkIndex,
    selectedLines: selectedLineIndexes(line),
  };
}

function closeContextMenu(): void {
  contextMenu.value = undefined;
}

function mutateSelection(mode: 'hunk' | 'lines'): void {
  if (!selected.value || !contextMenu.value) return;
  const hunk = parsedDiff.value.hunks[contextMenu.value.hunkIndex];
  const options = {
    cwd: props.cwd,
    path: selected.value.path,
    scope: selected.value.scope,
    mode,
    hunkIndex: contextMenu.value.hunkIndex,
    expectedHunk: expectedHunk(hunk),
    ...(mode === 'lines' ? { selectedLines: contextMenu.value.selectedLines } : {}),
  } as const;
  closeContextMenu();
  void updateIndex(options);
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.visible) return;
  if (event.key === 'Escape' && contextMenu.value) closeContextMenu();
  else if (event.key === 'Escape') emit('close');
}

watch(() => [props.visible, props.cwd] as const, ([visible]) => {
  if (visible) void refresh();
  else {
    ++requestId;
    ++diffRequestId;
  }
}, { immediate: true });

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('pointerdown', closeContextMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('pointerdown', closeContextMenu);
});
</script>

<style scoped>
.git-changes-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3vh 3vw;
  background: rgba(0, 0, 0, 0.55);
}

.git-changes-dialog {
  width: min(1500px, 94vw);
  height: 94vh;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  box-shadow: var(--shadow-lg);
}

.git-changes-header,
.git-changes-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}

.git-changes-header {
  height: 68px;
  padding: 0 18px;
}

.git-changes-header h2,
.git-changes-header p {
  margin: 0;
}

.git-changes-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.05rem;
}

.git-changes-header p {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.git-changes-header-actions {
  display: flex;
  gap: 6px;
}

.git-changes-header-actions button,
.git-changes-detail-header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.git-changes-header-actions button {
  width: 32px;
  padding: 0;
}

.git-changes-header-actions button:hover:not(:disabled),
.git-changes-detail-header button:hover:not(:disabled) {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.git-changes-body {
  display: grid;
  grid-template-columns: minmax(240px, 24%) 1fr;
  height: calc(100% - 68px);
}

.git-changes-files {
  overflow: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
}

.git-change-group h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--git-deleted) 15%, var(--bg-elevated));
  font-size: 0.78rem;
  text-transform: uppercase;
}

.git-change-group.is-staged h3 {
  background: color-mix(in srgb, var(--git-added) 15%, var(--bg-elevated));
}

.git-change-empty {
  margin: 0;
  padding: 12px;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.git-change-file {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.76rem;
  text-align: left;
}

.git-change-file:hover,
.git-change-file.is-selected {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.git-change-file.is-selected {
  box-shadow: inset 3px 0 var(--accent);
}

.git-change-status {
  width: 1.5rem;
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 700;
}

.git-change-path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-change-file-action {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.git-change-file-action:hover {
  background: var(--bg-elevated);
  color: var(--accent);
}

.git-changes-detail {
  min-width: 0;
  overflow: hidden;
}

.git-changes-detail-header {
  height: 48px;
  padding: 0 12px;
  background: var(--bg-secondary);
}

.git-changes-detail-header > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.git-changes-detail-header strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-changes-detail-header span {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 0.7rem;
}

.git-changes-detail-header span.unstaged {
  color: var(--git-deleted);
  background: color-mix(in srgb, var(--git-deleted) 12%, transparent);
}

.git-changes-detail-header span.staged {
  color: var(--git-added);
  background: color-mix(in srgb, var(--git-added) 12%, transparent);
}

.git-changes-diff {
  height: calc(100% - 49px);
  overflow: auto;
  background: var(--bg-primary);
}

.git-changes-diff pre {
  min-width: max-content;
  margin: 0;
  padding: 8px 0 30vh;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.55;
  user-select: text;
}

.git-changes-line {
  display: block;
  min-height: 1.55em;
  padding: 0 14px;
  white-space: pre;
}

.git-changes-line.is-added {
  color: var(--git-added);
  background: color-mix(in srgb, var(--git-added) 12%, transparent);
}

.git-changes-line.is-removed {
  color: var(--git-deleted);
  background: color-mix(in srgb, var(--git-deleted) 12%, transparent);
}

.git-changes-line.is-hunk {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.git-changes-line.is-metadata {
  color: var(--text-muted);
}

.git-changes-state {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--text-muted);
  text-align: center;
}

.git-changes-state.is-error {
  color: var(--error);
}

.git-changes-context-menu {
  position: fixed;
  z-index: 1300;
  display: flex;
  min-width: 210px;
  flex-direction: column;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.git-changes-context-menu button {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
}

.git-changes-context-menu button:hover {
  background: var(--bg-surface);
}

@media (max-width: 768px) {
  .git-changes-backdrop {
    padding: 0;
  }

  .git-changes-dialog {
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .git-changes-body {
    grid-template-columns: minmax(150px, 38%) 1fr;
  }
}
</style>
