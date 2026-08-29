<template>
  <Teleport to="body">
    <div v-if="visible" class="git-history-backdrop">
      <section class="git-history-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <header class="git-history-header">
          <div>
            <h2 :id="titleId"><PhGitCommit :size="20" weight="fill" /> {{ t('components.gitHistory.title') }}</h2>
            <p>{{ branch || 'HEAD' }} <span aria-hidden="true">·</span> {{ cwd }}</p>
          </div>
          <div class="git-history-header-actions">
            <button type="button" :aria-label="t('components.gitHistory.refresh')" :title="t('components.gitHistory.refresh')" :disabled="historyLoading" @click="refresh">
              <PhArrowClockwise :size="17" weight="bold" />
            </button>
            <button type="button" :aria-label="t('components.gitHistory.close')" :title="t('components.gitHistory.close')" @click="emit('close')">
              <PhX :size="17" weight="bold" />
            </button>
          </div>
        </header>

        <div class="git-history-body">
          <aside class="git-history-list-pane">
            <div v-if="historyLoading" class="git-history-state">{{ t('components.gitHistory.loadingHistory') }}</div>
            <div v-else-if="historyError" class="git-history-state is-error" role="alert">{{ historyError }}</div>
            <div v-else-if="commits.length === 0" class="git-history-state">{{ t('components.gitHistory.noCommits') }}</div>
            <div v-else class="git-history-commits" role="listbox" :aria-label="t('components.gitHistory.commits')">
              <button
                v-for="commit in commits"
                :key="commit.hash"
                type="button"
                class="git-history-commit"
                :class="{ 'is-selected': commit.hash === selectedCommit?.hash }"
                :aria-selected="commit.hash === selectedCommit?.hash"
                @click="selectCommit(commit)"
              >
                <span class="git-history-commit-subject">{{ commit.subject }}</span>
                <span class="git-history-commit-meta"><code>{{ commit.shortHash }}</code> · {{ commit.authorName }} · {{ formatDate(commit.authoredAt) }}</span>
              </button>
            </div>

            <footer class="git-history-pagination">
              <button class="git-history-previous" type="button" :disabled="historyLoading || !hasPrevious" @click="loadPage(page - 1)">
                <PhCaretLeft :size="15" weight="bold" /> {{ t('components.gitHistory.previous') }}
              </button>
              <span>{{ t('components.gitHistory.page', { page: page + 1 }) }}</span>
              <button class="git-history-next" type="button" :disabled="historyLoading || !hasNext" @click="loadPage(page + 1)">
                {{ t('components.gitHistory.next') }} <PhCaretRight :size="15" weight="bold" />
              </button>
            </footer>
          </aside>

          <main class="git-history-detail">
            <div v-if="!selectedCommit" class="git-history-state">{{ t('components.gitHistory.selectCommit') }}</div>
            <template v-else>
              <header class="git-history-detail-header">
                <h3>{{ selectedCommit.subject }}</h3>
                <p>
                  <strong>{{ selectedCommit.authorName }}</strong>
                  &lt;{{ selectedCommit.authorEmail }}&gt;
                  <span aria-hidden="true">·</span>
                  <time :datetime="selectedCommit.authoredAt">{{ formatDate(selectedCommit.authoredAt) }}</time>
                </p>
                <p class="git-history-hash"><code>{{ selectedCommit.hash }}</code></p>
                <p v-if="selectedCommit.body.trim()" class="git-history-message">{{ selectedCommit.body.trim() }}</p>
                <pre v-if="diffStat" class="git-history-stat">{{ diffStat }}</pre>
              </header>

              <div v-if="diffLoading" class="git-history-diff-state">{{ t('components.gitHistory.loadingDiff') }}</div>
              <div v-else-if="diffError" class="git-history-diff-state is-error" role="alert">{{ diffError }}</div>
              <div v-else-if="diffFiles.length === 0" class="git-history-diff-state">{{ t('components.gitHistory.noPatch') }}</div>
              <div v-else class="git-history-diff" :aria-label="t('components.gitHistory.commitDiff')">
                <div class="git-diff-toolbar">
                  <p class="git-diff-summary">
                    <span>{{ t(diffFiles.length === 1 ? 'components.chatPanel.fileChanged' : 'components.chatPanel.filesChanged', { count: diffFiles.length }) }}</span>
                    <span class="is-added">+{{ diffTotals.additions }}</span>
                    <span class="is-removed">-{{ diffTotals.deletions }}</span>
                  </p>
                  <div class="git-diff-actions">
                    <div class="git-diff-view-toggle" role="group" :aria-label="t('components.editorPanel.diffViewMode')">
                      <button type="button" :class="{ active: diffViewMode === 'unified' }" :aria-pressed="diffViewMode === 'unified'" @click="diffViewMode = 'unified'">
                        {{ t('components.editorPanel.unified') }}
                      </button>
                      <button type="button" :class="{ active: diffViewMode === 'split' }" :aria-pressed="diffViewMode === 'split'" @click="diffViewMode = 'split'">
                        {{ t('components.editorPanel.split') }}
                      </button>
                    </div>
                    <button type="button" class="git-diff-collapse-all" @click="toggleAllDiffFiles">
                      {{ t(allDiffFilesCollapsed ? 'components.chatPanel.expandAll' : 'components.chatPanel.collapseAll') }}
                    </button>
                  </div>
                </div>
                <section
                  v-for="(file, fileIndex) in diffFiles"
                  :id="diffFileId(fileIndex)"
                  :key="`${file.name}:${fileIndex}`"
                  class="git-diff-file"
                >
                  <h4>
                    <button
                      type="button"
                      :aria-expanded="!collapsedDiffFiles.has(file.name)"
                      :aria-controls="`${diffFileId(fileIndex)}-content`"
                      @click="toggleDiffFile(file.name)"
                    >
                      <span class="git-diff-file-title">
                        <PhCaretDown :size="14" weight="bold" aria-hidden="true" />
                        <span>{{ file.name }}</span>
                      </span>
                      <span class="git-diff-file-stats">
                        <span class="is-added">+{{ file.additions }}</span>
                        <span class="is-removed">-{{ file.deletions }}</span>
                      </span>
                    </button>
                  </h4>
                  <div v-show="!collapsedDiffFiles.has(file.name)" :id="`${diffFileId(fileIndex)}-content`" class="git-diff-content">
                    <pre v-if="diffViewMode === 'unified'"><span
                      v-for="(line, lineIndex) in file.lines"
                      :key="lineIndex"
                      class="git-diff-line"
                      :class="diffLineClass(line)"
                    >{{ line }}{{ '\n' }}</span></pre>
                    <div v-else class="git-split-diff">
                      <div v-for="(row, rowIndex) in pairDiffLines(file.lines)" :key="rowIndex" class="git-split-row">
                        <span class="git-diff-line" :class="row.left == null ? 'is-empty' : diffLineClass(row.left)">{{ row.left ?? '' }}</span>
                        <span class="git-diff-line" :class="row.right == null ? 'is-empty' : diffLineClass(row.right)">{{ row.right ?? '' }}</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </template>
          </main>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PhArrowClockwise, PhCaretDown, PhCaretLeft, PhCaretRight, PhGitCommit, PhX } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { createGitOperations } from '../services/gitOperations';

interface GitCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
}

interface DiffFile {
  name: string;
  lines: string[];
  additions: number;
  deletions: number;
}

interface SplitDiffRow {
  left: string | null;
  right: string | null;
}

const props = defineProps<{ visible: boolean; cwd: string }>();
const emit = defineEmits<{ close: [] }>();
const t = i18n.global.t;
const gitOperations = createGitOperations();
const titleId = 'git-history-title';
const branch = ref('');
const page = ref(0);
const hasPrevious = ref(false);
const hasNext = ref(false);
const commits = ref<GitCommit[]>([]);
const selectedCommit = ref<GitCommit>();
const historyLoading = ref(false);
const historyError = ref('');
const diffLoading = ref(false);
const diffError = ref('');
const diffStat = ref('');
const diffContent = ref('');
const collapsedDiffFiles = ref(new Set<string>());
const diffViewMode = ref<'unified' | 'split'>('unified');
let historyRequestId = 0;
let diffRequestId = 0;

const diffFiles = computed(() => parseDiffFiles(diffContent.value));
const diffTotals = computed(() => diffFiles.value.reduce((totals, file) => ({
  additions: totals.additions + file.additions,
  deletions: totals.deletions + file.deletions,
}), { additions: 0, deletions: 0 }));
const allDiffFilesCollapsed = computed(() => diffFiles.value.length > 0
  && diffFiles.value.every((file) => collapsedDiffFiles.value.has(file.name)));

function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      const name = line.match(/ b\/(.+)$/)?.[1]
        || line.replace(/^diff --(?:cc|combined) /, '')
        || t('components.gitHistory.changes');
      current = { name, lines: [line], additions: 0, deletions: 0 };
      files.push(current);
    } else if (current) {
      current.lines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
    }
  }
  return files;
}

function diffFileId(index: number): string {
  return `git-history-diff-file-${index}`;
}

function toggleDiffFile(name: string): void {
  const collapsed = new Set(collapsedDiffFiles.value);
  if (collapsed.has(name)) collapsed.delete(name);
  else collapsed.add(name);
  collapsedDiffFiles.value = collapsed;
}

function toggleAllDiffFiles(): void {
  collapsedDiffFiles.value = allDiffFilesCollapsed.value
    ? new Set()
    : new Set(diffFiles.value.map((file) => file.name));
}

function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'is-hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'is-added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'is-removed';
  if (line.startsWith('diff --') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'is-metadata';
  return '';
}

// Pair each contiguous removal/addition block so corresponding edits share a split row.
function pairDiffLines(lines: string[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const isRemoval = line.startsWith('-') && !line.startsWith('---');
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    if (!isRemoval && !isAddition) {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }

    const removals: string[] = [];
    const additions: string[] = [];
    while (index < lines.length && lines[index].startsWith('-') && !lines[index].startsWith('---')) removals.push(lines[index++]);
    while (index < lines.length && lines[index].startsWith('+') && !lines[index].startsWith('+++')) additions.push(lines[index++]);
    const rowCount = Math.max(removals.length, additions.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      rows.push({ left: removals[rowIndex] ?? null, right: additions[rowIndex] ?? null });
    }
  }
  return rows;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(String(i18n.global.locale.value), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function loadDiff(commit: GitCommit): Promise<void> {
  const requestId = ++diffRequestId;
  diffLoading.value = true;
  diffError.value = '';
  diffStat.value = '';
  diffContent.value = '';
  collapsedDiffFiles.value = new Set();
  try {
    const result = await gitOperations.getDiff({ cwd: props.cwd, commit: commit.hash });
    if (requestId !== diffRequestId) return;
    if (result.oversized) {
      diffError.value = String(result.message || t('components.gitHistory.diffFailed'));
      return;
    }
    diffStat.value = typeof result.stat === 'string' ? result.stat : '';
    diffContent.value = typeof result.diff === 'string' ? result.diff : '';
  } catch (cause) {
    if (requestId === diffRequestId) diffError.value = cause instanceof Error ? cause.message : t('components.gitHistory.diffFailed');
  } finally {
    if (requestId === diffRequestId) diffLoading.value = false;
  }
}

function selectCommit(commit: GitCommit): void {
  selectedCommit.value = commit;
  void loadDiff(commit);
}

async function loadPage(nextPage: number): Promise<void> {
  if (!props.cwd || nextPage < 0) return;
  const requestId = ++historyRequestId;
  ++diffRequestId;
  historyLoading.value = true;
  historyError.value = '';
  try {
    const result = await gitOperations.getHistory({ cwd: props.cwd, page: nextPage });
    if (requestId !== historyRequestId) return;
    branch.value = typeof result.branch === 'string' ? result.branch : 'HEAD';
    page.value = typeof result.page === 'number' ? result.page : nextPage;
    hasPrevious.value = result.hasPrevious === true;
    hasNext.value = result.hasNext === true;
    commits.value = Array.isArray(result.commits) ? result.commits as GitCommit[] : [];
    selectedCommit.value = undefined;
    diffStat.value = '';
    diffContent.value = '';
    diffError.value = '';
    if (commits.value[0]) selectCommit(commits.value[0]);
  } catch (cause) {
    if (requestId !== historyRequestId) return;
    commits.value = [];
    selectedCommit.value = undefined;
    historyError.value = cause instanceof Error ? cause.message : t('components.gitHistory.historyFailed');
  } finally {
    if (requestId === historyRequestId) historyLoading.value = false;
  }
}

function refresh(): void {
  void loadPage(0);
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.visible && event.key === 'Escape') emit('close');
}

watch(() => [props.visible, props.cwd] as const, ([visible]) => {
  if (visible) void loadPage(0);
  else {
    ++historyRequestId;
    ++diffRequestId;
  }
}, { immediate: true });

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));
</script>

<style scoped>
.git-history-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  padding: 3vh 3vw;
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
  backdrop-filter: blur(6px);
}

.git-history-dialog {
  width: min(1400px, 96vw);
  height: min(900px, 94vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
}

.git-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}

.git-history-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 17px;
}

.git-history-header p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.git-history-header-actions {
  display: flex;
  gap: 6px;
}

.git-history-header-actions button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.git-history-header-actions button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.git-history-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(240px, 24%) minmax(0, 1fr);
}

.git-history-list-pane,
.git-history-detail {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.git-history-list-pane {
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
}

.git-history-commits,
.git-history-diff {
  min-height: 0;
  overflow: auto;
}

.git-history-commits {
  flex: 1;
  padding: 8px;
}

.git-history-commit {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px;
  text-align: left;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.git-history-commit:hover,
.git-history-commit.is-selected {
  background: var(--bg-surface);
}

.git-history-commit.is-selected {
  box-shadow: inset 3px 0 var(--accent);
}

.git-history-commit-subject {
  font-weight: 600;
  overflow-wrap: anywhere;
  white-space: normal;
}

.git-history-commit-meta {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-history-commit-meta code,
.git-history-hash code {
  color: var(--accent);
}

.git-history-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
}

.git-history-pagination button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  background: var(--bg-surface);
}

.git-history-pagination button:disabled {
  opacity: 0.4;
}

.git-history-detail {
  overflow: hidden;
  background: var(--bg-primary);
}

.git-history-detail-header {
  flex: 0 0 auto;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.git-history-detail-header h3 {
  margin: 0 0 7px;
  font-size: 18px;
}

.git-history-detail-header p {
  margin: 4px 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.git-history-message {
  white-space: pre-wrap;
  color: var(--text-primary) !important;
}

.git-history-stat {
  max-height: 100px;
  margin: 10px 0 0;
  overflow: auto;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: pre-wrap;
}

.git-history-diff {
  flex: 1;
  padding: 12px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.git-diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.git-diff-summary,
.git-diff-file-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-diff-summary {
  margin: 0;
  color: var(--text-secondary);
}

.git-diff-summary .is-added,
.git-diff-file-stats .is-added {
  color: var(--success, #4ade80);
}

.git-diff-summary .is-removed,
.git-diff-file-stats .is-removed {
  color: var(--danger, #f87171);
}

.git-diff-actions,
.git-diff-view-toggle {
  display: flex;
  align-items: center;
}

.git-diff-actions {
  flex: 0 0 auto;
  gap: 8px;
}

.git-diff-view-toggle {
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.git-diff-view-toggle button,
.git-diff-collapse-all {
  padding: 4px 8px;
  border: 0;
  border-radius: 3px;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
}

.git-diff-view-toggle button.active {
  color: var(--text-primary);
  background: var(--bg-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.git-diff-collapse-all {
  border: 1px solid var(--border);
}

.git-diff-view-toggle button:hover,
.git-diff-collapse-all:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.git-diff-file {
  margin-bottom: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.git-diff-file h4 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  background: var(--bg-secondary);
  font-family: inherit;
}

.git-diff-file h4 button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 10px;
  border: 0;
  color: inherit;
  background: none;
  font: inherit;
  font-weight: inherit;
  text-align: left;
}

.git-diff-file h4 button:hover,
.git-diff-file h4 button:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.git-diff-file-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-wrap: anywhere;
}

.git-diff-file h4 button svg {
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}

.git-diff-file h4 button[aria-expanded="false"] svg {
  transform: rotate(-90deg);
}

.git-diff-file-stats {
  flex: 0 0 auto;
}

.git-diff-content {
  border-top: 1px solid var(--border);
  overflow-x: auto;
}

.git-diff-file pre {
  margin: 0;
  padding: 8px 0;
}

.git-split-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
  min-width: 768px;
  padding: 8px 0;
}

.git-split-row {
  display: contents;
}

.git-split-row > .git-diff-line {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.git-split-row > :first-child {
  border-right: 1px solid var(--border);
}

.git-diff-line {
  display: block;
  min-height: 18px;
  padding: 0 10px;
  white-space: pre;
}

.git-diff-line.is-added {
  color: var(--success, #4ade80);
  background: rgba(34, 197, 94, 0.1);
}

.git-diff-line.is-removed {
  color: var(--danger, #f87171);
  background: rgba(239, 68, 68, 0.1);
}

.git-diff-line.is-hunk {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.git-diff-line.is-metadata {
  color: var(--text-secondary);
}

.git-diff-line.is-empty {
  background: var(--bg-secondary);
}

.git-history-state,
.git-history-diff-state {
  margin: auto;
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}

.is-error {
  color: var(--danger, #f87171);
}

@media (max-width: 760px) {
  .git-history-backdrop {
    padding: 0;
  }

  .git-history-dialog {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  .git-history-body {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .git-history-list-pane {
    min-height: 45vh;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .git-history-detail {
    min-height: 65vh;
  }
}
</style>
