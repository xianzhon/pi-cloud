import { computed, ref, type Ref } from 'vue';
import { useGitHosting, type GitHostingPrPreview } from './useGitHosting';

interface ChatLocalMessage {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';
  status?: 'pending' | 'success' | 'failure' | 'info';
  title?: string;
}

interface PullRequestOptions {
  projectPath: () => string | undefined;
  sessionId: () => string | undefined;
  clientId: () => string | undefined;
  branchOptions: Ref<string[]>;
  closeCommands: () => void;
  clearComposer: () => void;
  addLocalMessage: (message: ChatLocalMessage, sessionId?: string) => ChatLocalMessage;
  t: (key: string, params?: Record<string, unknown>) => string;
}

function parsePrTarget(text: string) {
  return text.trim().replace(/^\/pr(?:\s+|$)/i, '').trim().split(/\s+/)[0] || 'main';
}

export function useChatPullRequests(options: PullRequestOptions) {
  const gitHosting = useGitHosting();
  const prPreview = ref<GitHostingPrPreview | null>(null);
  const prStatusMessage = ref<ChatLocalMessage | null>(null);
  const prGeneratingContent = ref(false);
  const prUpdatingTargetBranch = ref(false);
  const prGenerationError = ref('');

  const prTargetBranchOptions = computed(() => {
    const targetBranch = prPreview.value?.targetBranch || 'main';
    return Array.from(new Set([targetBranch, 'main', ...options.branchOptions.value]))
      .filter(Boolean)
      .map((branch) => ({ value: branch, label: branch }));
  });

  function formatPrPreview(preview: GitHostingPrPreview) {
    const files = preview.files.length
      ? preview.files.map((file) => `- ${file.status.padEnd(2, ' ')} ${file.path}`).join('\n')
      : options.t('components.chatPanel.noUncommittedFiles');
    const provider = preview.provider === 'github' ? 'GitHub' : 'Gitea';
    return `### Proposed ${provider} PR\n\nRepository: \`${preview.owner}/${preview.repo}\`\n\nSource: \`${preview.sourceBranch}\`\nTarget: \`${preview.targetBranch}\`\n\nTitle: \`${preview.title}\`\n\nFiles:\n\n\`\`\`text\n${files}\n\`\`\`\n\nConfirm in the dialog to commit if needed, push, and create the PR.`;
  }

  async function loadPrBranchOptions() {
    try {
      const params = new URLSearchParams({ cwd: options.projectPath() || '~' });
      const response = await fetch(`/api/git/branches?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      options.branchOptions.value = Array.isArray(data.branches) ? data.branches : [];
    } catch {
      options.branchOptions.value = [];
    }
  }

  async function handlePrCommand(text: string, showUserMessage = true) {
    options.closeCommands();
    const sessionId = options.sessionId();
    if (showUserMessage) options.addLocalMessage({ role: 'user', content: text, kind: 'text' }, sessionId);
    const responseMessage = options.addLocalMessage({
      role: 'assistant',
      content: options.t('components.chatPanel.preparingPrPreview'),
      kind: 'status',
      status: 'pending',
      title: options.t('components.chatPanel.pullRequest'),
    }, sessionId);
    options.clearComposer();

    try {
      await loadPrBranchOptions();
      const preview = await gitHosting.previewPr(options.projectPath() || '~', parsePrTarget(text));
      prPreview.value = preview;
      prGenerationError.value = '';
      prStatusMessage.value = responseMessage;
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = formatPrPreview(preview);
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = options.t('components.chatPanel.pullRequestFailed');
      responseMessage.content = error instanceof Error ? error.message : options.t('components.chatPanel.failedToPreparePullRequest');
    }
  }

  function cancelPr() {
    if (prStatusMessage.value) prStatusMessage.value.content += '\n\nPR creation cancelled.';
    prPreview.value = null;
    prStatusMessage.value = null;
    prGenerationError.value = '';
  }

  async function updatePrTargetBranch(targetBranch: string) {
    const preview = prPreview.value;
    if (!preview || !targetBranch) return;
    const previousTitle = preview.title;
    const previousBody = preview.body;
    prUpdatingTargetBranch.value = true;
    prGenerationError.value = '';
    try {
      const updatedPreview = await gitHosting.previewPr(options.projectPath() || '~', targetBranch);
      updatedPreview.title = previousTitle;
      updatedPreview.body = previousBody;
      prPreview.value = updatedPreview;
      if (prStatusMessage.value) prStatusMessage.value.content = formatPrPreview(updatedPreview);
    } catch (error) {
      prGenerationError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToUpdatePrTargetBranch');
    } finally {
      prUpdatingTargetBranch.value = false;
    }
  }

  async function generatePrContent() {
    const preview = prPreview.value;
    if (!preview) return;
    if (prUpdatingTargetBranch.value) {
      prGenerationError.value = options.t('components.chatPanel.waitForTheTargetBranchPreviewTo');
      return;
    }
    const clientId = options.clientId();
    if (!clientId) {
      prGenerationError.value = 'clientId is required to generate PR content with AI';
      return;
    }
    prGeneratingContent.value = true;
    prGenerationError.value = '';
    try {
      const content = await gitHosting.generatePrContent(clientId, preview, options.sessionId());
      preview.title = content.title;
      preview.body = content.body;
    } catch (error) {
      prGenerationError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToGeneratePrContent');
    } finally {
      prGeneratingContent.value = false;
    }
  }

  async function confirmPr() {
    const preview = prPreview.value;
    const responseMessage = prStatusMessage.value;
    if (!preview || !responseMessage) return;
    if (prUpdatingTargetBranch.value) {
      prGenerationError.value = options.t('components.chatPanel.waitForTheTargetBranchPreviewTo');
      return;
    }
    prPreview.value = null;
    prGenerationError.value = '';
    responseMessage.kind = 'status';
    responseMessage.status = 'pending';
    responseMessage.title = options.t('components.chatPanel.pullRequest');
    responseMessage.content = options.t('components.chatPanel.creatingPullRequest');
    try {
      const result = await gitHosting.createPr({
        preview,
        title: preview.title,
        body: preview.body,
        commitMessage: preview.commitMessage,
        sessionId: options.sessionId(),
      });
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      const provider = preview.provider === 'github' ? 'GitHub' : 'Gitea';
      responseMessage.content = `### ${provider} PR created\n\n#${result.pullRequest.number}: ${result.pullRequest.url}`;
      window.dispatchEvent(new CustomEvent('refresh-file-tree'));
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = options.t('components.chatPanel.pullRequestFailed');
      responseMessage.content = error instanceof Error ? error.message : options.t('components.chatPanel.failedToCreatePullRequest');
    } finally {
      prStatusMessage.value = null;
    }
  }

  return {
    prPreview,
    prGeneratingContent,
    prUpdatingTargetBranch,
    prGenerationError,
    prTargetBranchOptions,
    handlePrCommand,
    cancelPr,
    updatePrTargetBranch,
    generatePrContent,
    confirmPr,
  };
}
