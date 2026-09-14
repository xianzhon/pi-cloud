<template>
  <Teleport to="body">
    <div v-if="visible" class="git-changes-backdrop">
      <section ref="dialog" class="git-changes-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
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

        <div class="git-changes-content">
          <div class="git-changes-body" :style="{ gridTemplateColumns: `${filesWidth}px 5px minmax(0, 1fr)` }">
            <aside ref="filesPane" class="git-changes-files">
              <div v-if="loading" class="git-changes-state">{{ t('components.gitChanges.loading') }}</div>
              <div v-else-if="statusError" class="git-changes-state is-error" role="alert">{{ statusError }}</div>
              <template v-else>
                <section class="git-change-group" :style="{ height: `${unstagedHeight}px` }">
                  <h3>
                    <span>{{ t('components.gitChanges.unstagedChanges') }} <b>{{ unstagedFiles.length }}</b></span>
                    <button type="button" :disabled="updating || !unstagedFiles.length" @click="mutateAll('unstaged')">
                      {{ t('components.gitChanges.stageAll') }}
                    </button>
                  </h3>
                  <div class="git-change-list">
                    <button
                      v-for="file in unstagedFiles"
                      :key="`unstaged:${file.path}`"
                      type="button"
                      class="git-change-file"
                      :class="{ 'is-selected': selected?.scope === 'unstaged' && selected.path === file.path }"
                      @click="selectFile(file.path, 'unstaged')"
                    >
                      <span
                        class="git-change-status-icon"
                        role="img"
                        :class="fileStatusKind(file, 'unstaged')"
                        :title="fileStatusLabel(file, 'unstaged')"
                        :aria-label="fileStatusLabel(file, 'unstaged')"
                      >
                        <PhFile :size="19" weight="duotone" />
                        <span class="git-change-status-badge" aria-hidden="true">
                          <PhPencilSimple v-if="fileStatusKind(file, 'unstaged') === 'modified'" :size="10" weight="bold" />
                          <PhQuestion v-else-if="fileStatusKind(file, 'unstaged') === 'untracked'" :size="10" weight="bold" />
                          <PhX v-else :size="10" weight="bold" />
                        </span>
                      </span>
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
                  </div>
                </section>

                <div
                  class="git-changes-resizer is-horizontal"
                  role="separator"
                  aria-orientation="horizontal"
                  :aria-label="t('components.gitChanges.resizeLists')"
                  @pointerdown="startResize($event, 'lists')"
                ></div>

                <section class="git-change-group is-staged">
                  <h3>
                    <span>{{ t('components.gitChanges.stagedChanges') }} <b>{{ stagedFiles.length }}</b></span>
                    <button type="button" :disabled="updating || !stagedFiles.length" @click="mutateAll('staged')">
                      {{ t('components.gitChanges.unstageAll') }}
                    </button>
                  </h3>
                  <div class="git-change-list">
                    <button
                      v-for="file in stagedFiles"
                      :key="`staged:${file.path}`"
                      type="button"
                      class="git-change-file"
                      :class="{ 'is-selected': selected?.scope === 'staged' && selected.path === file.path }"
                      @click="selectFile(file.path, 'staged')"
                    >
                      <span
                        class="git-change-status-icon staged"
                        role="img"
                        :title="fileStatusLabel(file, 'staged')"
                        :aria-label="fileStatusLabel(file, 'staged')"
                      >
                        <PhFile :size="19" weight="duotone" />
                        <span class="git-change-status-badge" aria-hidden="true"><PhCheck :size="10" weight="bold" /></span>
                      </span>
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
                  </div>
                </section>
              </template>
            </aside>

            <div
              class="git-changes-resizer is-vertical"
              role="separator"
              aria-orientation="vertical"
              :aria-label="t('components.gitChanges.resizePanes')"
              @pointerdown="startResize($event, 'panes')"
            ></div>

            <main class="git-changes-detail">
              <div v-if="!selected" class="git-changes-state">{{ t('components.gitChanges.selectFile') }}</div>
              <template v-else>
                <header class="git-changes-detail-header">
                  <div>
                    <strong :title="selected.path">{{ selected.path }}</strong>
                    <span class="git-change-detail-status" :class="selectedStatusKind">{{ selectedStatusLabel }}</span>
                  </div>
                  <button type="button" :disabled="updating" @click="mutateFile(selected.path, selected.scope)">
                    {{ t(selected.scope === 'staged' ? 'components.gitChanges.unstageFile' : 'components.gitChanges.stageFile') }}
                  </button>
                </header>
                <div v-if="diffLoading" class="git-changes-state">{{ t('components.gitChanges.loadingDiff') }}</div>
                <div v-else-if="diffError" class="git-changes-state is-error" role="alert">{{ diffError }}</div>
                <div v-else-if="!renderLines.length" class="git-changes-state">{{ t('components.gitChanges.noPatch') }}</div>
                <div v-else ref="diffRoot" class="git-changes-diff" @contextmenu="closeContextMenu">
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

          <footer class="git-commit-panel">
            <label class="git-amend-option">
              <input v-model="amend" type="checkbox" :disabled="committing" @change="toggleAmend" />
              <span>{{ t('components.gitChanges.amendLastCommit') }}</span>
            </label>
            <label for="git-changes-commit-message">{{ t('components.gitChanges.commitMessage') }}</label>
            <div class="git-commit-controls">
              <textarea id="git-changes-commit-message" v-model="commitMessage" rows="3" :disabled="committing"></textarea>
              <button type="button" :disabled="committing || !commitMessage.trim() || (!amend && !stagedFiles.length)" @click="commitChanges">
                {{ commitButtonLabel }}
              </button>
            </div>
            <p v-if="commitError" class="git-commit-result is-error" role="alert">{{ commitError }}</p>
            <p v-else-if="commitResult" class="git-commit-result" role="status">{{ commitResult }}</p>
          </footer>
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
import { PhArrowClockwise, PhCheck, PhFile, PhGitDiff, PhMinus, PhPencilSimple, PhPlus, PhQuestion, PhX } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { createGitOperations } from '../services/gitOperations';
import { diffLineClass } from '../utils/gitDiff';

type DiffScope = 'staged' | 'unstaged';
type FileStatusKind = 'modified' | 'untracked' | 'missing' | 'staged';

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

const props = defineProps<{ visible: boolean; cwd: string; sessionId?: string }>();
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
const dialog = ref<HTMLElement>();
const diffRoot = ref<HTMLElement>();
const filesPane = ref<HTMLElement>();
const contextMenu = ref<{ x: number; y: number; hunkIndex: number; selectedLines: number[] }>();
const filesWidth = ref(360);
const unstagedHeight = ref(320);
const amend = ref(false);
const commitMessage = ref('');
const normalCommitMessage = ref('');
const committing = ref(false);
const commitError = ref('');
const commitResult = ref('');
let requestId = 0;
let diffRequestId = 0;
let resizeMode: 'panes' | 'lists' | undefined;

const unstagedFiles = computed(() => files.value.filter(file => file.unstaged));
const stagedFiles = computed(() => files.value.filter(file => file.staged));
const parsedDiff = computed(() => parseDiff(diffContent.value));
const renderLines = computed(() => parsedDiff.value.lines);
const selectedFile = computed(() => files.value.find(file => file.path === selected.value?.path));
const selectedStatusKind = computed(() => selectedFile.value && selected.value
  ? fileStatusKind(selectedFile.value, selected.value.scope)
  : 'modified');
const selectedStatusLabel = computed(() => selectedFile.value && selected.value
  ? fileStatusLabel(selectedFile.value, selected.value.scope)
  : '');
const commitButtonLabel = computed(() => {
  if (committing.value) return t('components.gitChanges.committing');
  return t(amend.value ? 'components.gitChanges.amend' : 'components.gitChanges.commit');
});

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
    await refresh(options.path ? { path: options.path, scope: options.scope } : selected.value);
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

function mutateAll(scope: DiffScope): void {
  if (updating.value) return;
  void updateIndex({ cwd: props.cwd, scope, mode: 'all' });
}

function startResize(event: PointerEvent, mode: 'panes' | 'lists'): void {
  event.preventDefault();
  resizeMode = mode;
  document.body.classList.add(mode === 'panes' ? 'is-resizing-columns' : 'is-resizing-rows');
}

function resize(event: PointerEvent): void {
  if (resizeMode === 'panes') {
    if (!dialog.value) return;
    filesWidth.value = Math.max(220, Math.min(
      event.clientX - dialog.value.getBoundingClientRect().left,
      dialog.value.clientWidth - 320,
    ));
  } else if (resizeMode === 'lists' && filesPane.value) {
    const top = filesPane.value.getBoundingClientRect().top;
    unstagedHeight.value = Math.max(110, Math.min(event.clientY - top, filesPane.value.clientHeight - 115));
  }
}

function stopResize(): void {
  resizeMode = undefined;
  document.body.classList.remove('is-resizing-columns', 'is-resizing-rows');
}

async function toggleAmend(): Promise<void> {
  commitError.value = '';
  commitResult.value = '';
  if (!amend.value) {
    commitMessage.value = normalCommitMessage.value;
    return;
  }
  normalCommitMessage.value = commitMessage.value;
  try {
    const result = await gitOperations.getAmendStatus({ cwd: props.cwd });
    if (amend.value) commitMessage.value = typeof result.message === 'string' ? result.message : '';
  } catch (cause) {
    amend.value = false;
    commitError.value = cause instanceof Error ? cause.message : t('components.gitChanges.amendFailed');
  }
}

async function commitChanges(): Promise<void> {
  if (committing.value || !commitMessage.value.trim()) return;
  committing.value = true;
  commitError.value = '';
  commitResult.value = '';
  try {
    const result = await gitOperations.saveCommit(amend.value ? 'amend' : 'commit', {
      cwd: props.cwd,
      message: commitMessage.value,
      sessionId: props.sessionId,
      stagedOnly: true,
    });
    const successKey = amend.value ? 'components.gitChanges.amendSucceeded' : 'components.gitChanges.commitSucceeded';
    commitResult.value = t(successKey, {
      commit: typeof result.commit === 'string' ? result.commit.slice(0, 7) : '',
    });
    commitMessage.value = '';
    normalCommitMessage.value = '';
    amend.value = false;
    window.dispatchEvent(new CustomEvent('refresh-git-status'));
    await refresh();
  } catch (cause) {
    commitError.value = cause instanceof Error ? cause.message : t('components.gitChanges.commitFailed');
  } finally {
    committing.value = false;
  }
}

function fileStatusKind(file: GitStatusFile, scope: DiffScope): FileStatusKind {
  if (scope === 'staged') return 'staged';
  if (file.status === '??') return 'untracked';
  if (file.status.endsWith('D')) return 'missing';
  return 'modified';
}

function fileStatusLabel(file: GitStatusFile, scope: DiffScope): string {
  const key: Record<FileStatusKind, string> = {
    modified: 'modifiedNotStaged',
    untracked: 'untrackedNotStaged',
    missing: 'missing',
    staged: 'stagedForCommit',
  };
  return t(`components.gitChanges.${key[fileStatusKind(file, scope)]}`);
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
  window.addEventListener('pointermove', resize);
  window.addEventListener('pointerup', stopResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('pointerdown', closeContextMenu);
  window.removeEventListener('pointermove', resize);
  window.removeEventListener('pointerup', stopResize);
  stopResize();
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
  display: flex;
  width: min(1500px, 94vw);
  height: 94vh;
  flex-direction: column;
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

.git-changes-content {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.git-changes-body {
  display: grid;
  min-height: 220px;
  flex: 1;
}

.git-changes-files {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary);
}

.git-change-group {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.git-change-group:first-child {
  flex: 0 0 auto;
}

.git-change-group h3 {
  display: flex;
  min-height: 38px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 5px 8px 5px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--git-deleted) 15%, var(--bg-elevated));
  font-size: 0.78rem;
}

.git-change-group h3 b {
  display: inline-flex;
  min-width: 2em;
  height: 2em;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  padding: 0 0.35em;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface) 55%, transparent);
  font-size: 0.85em;
  font-weight: 600;
  line-height: 1;
}

.git-change-group h3 button {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.68rem;
  text-transform: none;
}

.git-change-group h3 button:hover:not(:disabled) {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.git-change-group.is-staged h3 {
  background: color-mix(in srgb, var(--git-added) 15%, var(--bg-elevated));
}

.git-change-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.git-change-empty {
  margin: 0;
  padding: 12px;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.git-change-file {
  display: flex;
  width: max-content;
  min-width: 100%;
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

.git-change-status-icon {
  position: relative;
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.git-change-status-icon.untracked {
  color: var(--warning);
}

.git-change-status-icon.missing {
  color: var(--git-deleted);
}

.git-change-status-icon.staged {
  color: var(--git-added);
}

.git-change-status-badge {
  position: absolute;
  right: -2px;
  bottom: -1px;
  display: inline-flex;
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bg-secondary);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: currentColor;
}

.git-change-path {
  flex: 1 0 auto;
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

.git-changes-resizer {
  position: relative;
  z-index: 2;
  flex: 0 0 5px;
  background: var(--border);
  touch-action: none;
}

.git-changes-resizer::after {
  position: absolute;
  border-radius: 2px;
  background: var(--text-muted);
  content: '';
  opacity: 0;
  transition: opacity 120ms ease;
}

.git-changes-resizer:hover::after {
  opacity: 0.75;
}

.git-changes-resizer.is-vertical {
  cursor: col-resize;
}

.git-changes-resizer.is-vertical::after {
  inset: 35% 1px;
}

.git-changes-resizer.is-horizontal {
  width: 100%;
  cursor: row-resize;
}

.git-changes-resizer.is-horizontal::after {
  inset: 1px 35%;
}

:global(body.is-resizing-columns),
:global(body.is-resizing-columns *) {
  cursor: col-resize !important;
  user-select: none !important;
}

:global(body.is-resizing-rows),
:global(body.is-resizing-rows *) {
  cursor: row-resize !important;
  user-select: none !important;
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

.git-change-detail-status.modified {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.git-change-detail-status.untracked {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.git-change-detail-status.missing {
  color: var(--git-deleted);
  background: color-mix(in srgb, var(--git-deleted) 12%, transparent);
}

.git-change-detail-status.staged {
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

.git-commit-panel {
  flex: 0 0 auto;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

.git-commit-panel > label:not(.git-amend-option) {
  display: block;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.git-amend-option {
  display: flex;
  float: right;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.git-commit-controls {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.git-commit-controls textarea {
  min-height: 66px;
  flex: 1;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
}

.git-commit-controls button {
  min-width: 100px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: white;
  font-weight: 600;
}

.git-commit-result {
  margin: 7px 0 0;
  color: var(--git-added);
  font-size: 0.75rem;
}

.git-commit-result.is-error {
  color: var(--error);
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
    grid-template-columns: minmax(150px, 38%) 5px minmax(0, 1fr) !important;
  }

  .git-commit-controls button {
    min-width: 78px;
  }
}
</style>
