import { computed, ref } from 'vue';
import { createGitOperations } from '../services/gitOperations';
import { parseDiffFiles, shouldHideDiffHeaderLine } from '../utils/gitDiff';

interface ChatLocalMessage {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';
  status?: 'pending' | 'success' | 'failure' | 'info';
  title?: string;
}

interface CommitStatusFile {
  path: string;
  status: string;
}

interface CommitPreview {
  cwd: string;
  message: string;
  files: CommitStatusFile[];
  mode: 'commit' | 'amend';
}

interface CommitOptions {
  projectPath: () => string | undefined;
  sessionId: () => string | undefined;
  clientId: () => string | undefined;
  sessionTitle: () => string | undefined;
  closeCommands: () => void;
  clearComposer: () => void;
  addLocalMessage: (message: ChatLocalMessage, sessionId?: string) => ChatLocalMessage;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => unknown;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export function useChatCommits(options: CommitOptions) {
  const gitOperations = createGitOperations();
  const commitPreview = ref<CommitPreview | null>(null);
  const commitStatusMessage = ref<ChatLocalMessage | null>(null);
  const commitGeneratingMessage = ref(false);
  const commitGenerationError = ref('');
  const commitStagedOnly = ref(false);
  const commitDiffLoading = ref(false);
  const commitDiffError = ref('');
  const commitDiffContent = ref('');
  const collapsedCommitDiffFiles = ref(new Set<string>());
  const commitDiffViewMode = ref<'unified' | 'split'>('unified');
  const commitCommandShowsUserMessage = ref(true);
  let commitDiffRequestId = 0;

  const commitDialogTitle = computed(() => commitPreview.value?.mode === 'amend'
    ? options.t('components.chatPanel.amendPreviousCommit')
    : options.t('components.chatPanel.commitChanges'));
  const commitDialogConfirmText = computed(() => commitPreview.value?.mode === 'amend'
    ? options.t('components.chatPanel.amend')
    : options.t('components.chatPanel.commit'));
  const commitDiffFiles = computed(() => parseDiffFiles(
    commitDiffContent.value,
    options.t('components.gitHistory.changes'),
    { mergeByName: true },
  ).map(file => ({ ...file, lines: file.lines.filter(line => !shouldHideDiffHeaderLine(line)) })));
  const allCommitDiffFilesCollapsed = computed(() => commitDiffFiles.value.length > 0
    && commitDiffFiles.value.every((file) => collapsedCommitDiffFiles.value.has(file.name)));
  const commitDiffSummary = computed(() => {
    const totals = commitDiffFiles.value.reduce((sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }), { additions: 0, deletions: 0 });
    const files = commitDiffFiles.value.length;
    return [
      options.t(files === 1 ? 'components.chatPanel.fileChanged' : 'components.chatPanel.filesChanged', { count: files }),
      options.t(totals.additions === 1 ? 'components.chatPanel.insertion' : 'components.chatPanel.insertions', { count: totals.additions }),
      options.t(totals.deletions === 1 ? 'components.chatPanel.deletion' : 'components.chatPanel.deletions', { count: totals.deletions }),
    ].join(', ');
  });

  function createResponseMessage(message: ChatLocalMessage, showMessage: boolean): ChatLocalMessage {
    return showMessage ? options.addLocalMessage(message, options.sessionId()) : { ...message };
  }

  function parseCommitMessageOverride(text: string) {
    return text.trim().replace(/^\/commit(?:\s+|$)/i, '').trim();
  }

  function getCommitMessage(text: string) {
    return parseCommitMessageOverride(text) || options.sessionTitle()?.trim() || options.t('components.chatPanel.updateChanges');
  }

  function formatCommitPreview(preview: CommitPreview) {
    const files = preview.files.length
      ? preview.files.map((file) => `- ${file.status.padEnd(2, ' ')} ${file.path}`).join('\n')
      : options.t('components.chatPanel.noWorkingTreeChanges');
    const action = preview.mode === 'amend' ? 'amend the previous commit' : 'create this commit';
    const heading = preview.mode === 'amend' ? '### Proposed git amend' : '### Proposed git commit';
    return `${heading}\n\nMessage:\n\n\`${preview.message}\`\n\nFiles:\n\n\`\`\`text\n${files}\n\`\`\`\n\nConfirm in the dialog to ${action}, or cancel to do nothing.`;
  }

  function formatCommitSuccess(data: { cwd?: string; message?: string; commit?: string; output?: string }, mode: 'commit' | 'amend') {
    const output = data.output?.trim() || (mode === 'amend' ? options.t('components.chatPanel.commitAmended') : options.t('components.chatPanel.commitCreated'));
    const heading = mode === 'amend' ? '### Git commit amended' : '### Git commit created';
    const commit = data.commit ? `\n\nCommit: \`${data.commit.slice(0, 7)}\`` : '';
    return `${heading}\n\n\`${data.cwd || options.projectPath()}\`\n\nMessage: \`${data.message || commitPreview.value?.message || ''}\`${commit}\n\n\`\`\`text\n${output}\n\`\`\``;
  }

  function resetCommitDiff() {
    ++commitDiffRequestId;
    commitDiffLoading.value = false;
    commitDiffError.value = '';
    commitDiffContent.value = '';
    collapsedCommitDiffFiles.value = new Set();
    commitDiffViewMode.value = 'unified';
  }

  async function loadCommitDiff() {
    const preview = commitPreview.value;
    if (!preview) return;

    const requestId = ++commitDiffRequestId;
    commitDiffLoading.value = true;
    commitDiffError.value = '';
    commitDiffContent.value = '';
    collapsedCommitDiffFiles.value = new Set();
    try {
      const scope = preview.mode === 'commit' && commitStagedOnly.value ? 'staged' : 'all';
      const data = await gitOperations.getDiff({ cwd: preview.cwd, scope, includeUntracked: scope === 'all' });
      if (requestId !== commitDiffRequestId) return;
      if (data.oversized) {
        commitDiffError.value = String(data.message || options.t('components.gitHistory.diffFailed'));
        return;
      }
      commitDiffContent.value = typeof data.diff === 'string' ? data.diff : '';
    } catch (error) {
      if (requestId === commitDiffRequestId) {
        commitDiffError.value = error instanceof Error ? error.message : options.t('components.gitHistory.diffFailed');
      }
    } finally {
      if (requestId === commitDiffRequestId) commitDiffLoading.value = false;
    }
  }

  async function handleCommitCommand(text: string, showUserMessage = true) {
    options.closeCommands();
    commitCommandShowsUserMessage.value = showUserMessage;
    if (showUserMessage) options.addLocalMessage({ role: 'user', content: text, kind: 'text' }, options.sessionId());
    const responseMessage = createResponseMessage({
      role: 'assistant',
      content: options.t('components.chatPanel.preparingGitCommitPreview'),
      kind: 'status',
      status: 'pending',
      title: options.t('components.chatPanel.gitCommit'),
    }, showUserMessage);
    options.clearComposer();

    try {
      const commitMessage = getCommitMessage(text);
      const data = await gitOperations.getStatus({ cwd: options.projectPath() || '~', message: commitMessage });
      if (!Array.isArray(data.files) || data.files.length === 0) {
        responseMessage.kind = 'text';
        responseMessage.status = undefined;
        responseMessage.title = undefined;
        responseMessage.content = `### Git commit\n\nNo changes to commit in \`${data.cwd || options.projectPath()}\`.`;
        if (!showUserMessage) options.showToast(options.t('components.chatPanel.noWorkingTreeChanges'));
        return;
      }

      const preview: CommitPreview = {
        cwd: data.cwd || options.projectPath() || '~',
        message: data.message || commitMessage,
        files: data.files,
        mode: 'commit',
      };
      commitGenerationError.value = '';
      commitStagedOnly.value = false;
      resetCommitDiff();
      commitPreview.value = preview;
      commitStatusMessage.value = responseMessage;
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = formatCommitPreview(preview);
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = options.t('components.chatPanel.gitCommitFailed');
      responseMessage.content = error instanceof Error ? error.message : options.t('components.chatPanel.failedToPrepareGitCommit');
      if (!showUserMessage) options.showToast(responseMessage.content, 'error');
    }
  }

  async function handleAmendCommand(text: string) {
    options.closeCommands();
    options.addLocalMessage({ role: 'user', content: text, kind: 'text' }, options.sessionId());
    const responseMessage = options.addLocalMessage({
      role: 'assistant',
      content: options.t('components.chatPanel.preparingGitAmendPreview'),
      kind: 'status',
      status: 'pending',
      title: options.t('components.chatPanel.gitAmend'),
    }, options.sessionId());
    options.clearComposer();

    try {
      const amendMessage = text.trim().replace(/^\/amend(?:\s+|$)/i, '').trim();
      const data = await gitOperations.getAmendStatus({ cwd: options.projectPath() || '~', message: amendMessage || undefined });
      const preview: CommitPreview = {
        cwd: data.cwd || options.projectPath() || '~',
        message: data.message || amendMessage,
        files: Array.isArray(data.files) ? data.files : [],
        mode: 'amend',
      };
      commitGenerationError.value = '';
      resetCommitDiff();
      commitPreview.value = preview;
      commitStatusMessage.value = responseMessage;
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = formatCommitPreview(preview);
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = options.t('components.chatPanel.gitAmendFailed');
      responseMessage.content = error instanceof Error ? error.message : options.t('components.chatPanel.failedToPrepareGitAmend');
    }
  }

  function commitDiffFileId(index: number): string {
    return `commit-diff-file-${index}`;
  }

  function toggleCommitDiffFile(name: string): void {
    const collapsed = new Set(collapsedCommitDiffFiles.value);
    if (collapsed.has(name)) collapsed.delete(name);
    else collapsed.add(name);
    collapsedCommitDiffFiles.value = collapsed;
  }

  function toggleAllCommitDiffFiles(): void {
    collapsedCommitDiffFiles.value = allCommitDiffFilesCollapsed.value
      ? new Set()
      : new Set(commitDiffFiles.value.map((file) => file.name));
  }

  async function refreshCommitFiles() {
    const preview = commitPreview.value;
    if (!preview || preview.mode !== 'commit') return;
    commitGenerationError.value = '';
    try {
      const data = await gitOperations.getStatus({ cwd: preview.cwd, stagedOnly: commitStagedOnly.value });
      preview.files = Array.isArray(data.files) ? data.files : [];
      await loadCommitDiff();
    } catch (error) {
      commitGenerationError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToPrepareGitCommit');
    }
  }

  async function generateCommitMessage() {
    const preview = commitPreview.value;
    if (!preview) return;
    const clientId = options.clientId();
    if (!clientId) {
      commitGenerationError.value = 'clientId is required to generate a commit message with AI';
      return;
    }
    if (preview.mode === 'amend' && preview.files.length === 0) {
      commitGenerationError.value = options.t('components.chatPanel.noWorkingTreeChangesToGenerateA');
      return;
    }

    commitGeneratingMessage.value = true;
    commitGenerationError.value = '';
    try {
      const data = await gitOperations.generateCommitMessage({
        cwd: preview.cwd,
        clientId,
        stagedOnly: preview.mode === 'commit' && commitStagedOnly.value,
      });
      preview.message = data.message || preview.message;
    } catch (error) {
      commitGenerationError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToGenerateCommitMessage');
    } finally {
      commitGeneratingMessage.value = false;
    }
  }

  function cancelCommit() {
    if (commitStatusMessage.value) commitStatusMessage.value.content += '\n\nCommit cancelled.';
    resetCommitDiff();
    commitPreview.value = null;
    commitStatusMessage.value = null;
    commitGenerationError.value = '';
  }

  async function confirmCommit() {
    const preview = commitPreview.value;
    const responseMessage = commitStatusMessage.value;
    if (!preview || !responseMessage) return;

    resetCommitDiff();
    commitPreview.value = null;
    commitGenerationError.value = '';
    responseMessage.kind = 'status';
    responseMessage.status = 'pending';
    responseMessage.title = preview.mode === 'amend' ? options.t('components.chatPanel.gitAmend') : options.t('components.chatPanel.gitCommit');
    responseMessage.content = preview.mode === 'amend' ? options.t('components.chatPanel.amendingGitCommit') : options.t('components.chatPanel.creatingGitCommit');

    try {
      const data = await gitOperations.saveCommit(preview.mode, {
        cwd: preview.cwd,
        message: preview.message,
        sessionId: options.sessionId(),
        stagedOnly: preview.mode === 'commit' && commitStagedOnly.value,
      });
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = formatCommitSuccess(data, preview.mode);
      if (!commitCommandShowsUserMessage.value) {
        options.showToast(preview.mode === 'amend' ? options.t('components.chatPanel.commitAmended') : options.t('components.chatPanel.commitCreated'), 'success');
      }
      window.dispatchEvent(new CustomEvent('refresh-file-tree'));
      window.dispatchEvent(new CustomEvent('refresh-git-status'));
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = preview.mode === 'amend' ? options.t('components.chatPanel.gitAmendFailed') : options.t('components.chatPanel.gitCommitFailed');
      responseMessage.content = error instanceof Error ? error.message : preview.mode === 'amend'
        ? options.t('components.chatPanel.failedToAmendGitCommit')
        : options.t('components.chatPanel.failedToCreateGitCommit');
      if (!commitCommandShowsUserMessage.value) options.showToast(responseMessage.content, 'error');
    } finally {
      commitStatusMessage.value = null;
    }
  }

  return {
    commitPreview,
    commitGeneratingMessage,
    commitGenerationError,
    commitStagedOnly,
    commitDiffLoading,
    commitDiffError,
    collapsedCommitDiffFiles,
    commitDiffViewMode,
    commitDialogTitle,
    commitDialogConfirmText,
    commitDiffFiles,
    allCommitDiffFilesCollapsed,
    commitDiffSummary,
    handleCommitCommand,
    handleAmendCommand,
    commitDiffFileId,
    toggleCommitDiffFile,
    toggleAllCommitDiffFiles,
    loadCommitDiff,
    refreshCommitFiles,
    generateCommitMessage,
    cancelCommit,
    confirmCommit,
  };
}
