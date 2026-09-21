import { computed, ref } from 'vue';
import { createGitOperations } from '../services/gitOperations';

interface ChatLocalMessage {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';
  status?: 'pending' | 'success' | 'failure' | 'info';
  title?: string;
}

type BranchDialogMode = 'switch' | 'changes' | 'base';

interface BranchOptions {
  projectPath: () => string | undefined;
  sessionId: () => string | undefined;
  clientId: () => string | undefined;
  closeCommands: () => void;
  clearComposer: () => void;
  addLocalMessage: (message: ChatLocalMessage, sessionId?: string) => ChatLocalMessage;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => unknown;
  refreshSessionStatus: () => Promise<unknown> | unknown;
  onBranchChanged: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

const BRANCH_SELECTION_STORAGE_KEY = 'pi-cloud:last-branch-selection';

export function useChatBranches(options: BranchOptions) {
  const gitOperations = createGitOperations();
  const branchOptions = ref<string[]>([]);
  const branchDialogOpen = ref(false);
  const branchDialogMode = ref<BranchDialogMode>('switch');
  const branchDialogLoading = ref(false);
  const branchDialogSubmitting = ref(false);
  const branchCommandShowsUserMessage = ref(true);
  const branchGeneratingName = ref(false);
  const branchDialogError = ref('');
  const branchHasChanges = ref(false);
  const branchSwitchName = ref('');
  const branchBaseName = ref('');
  const branchNewName = ref('');
  const branchPullAfterSwitch = ref(false);
  const branchDeleteOriginal = ref(true);

  const branchDialogActionLabel = computed(() => branchDialogMode.value === 'switch'
    ? options.t('components.chatPanel.switchBranch')
    : options.t('components.chatPanel.createBranch'));
  const branchSelectOptions = computed(() => branchOptions.value.map((branch) => ({ value: branch, label: branch })));

  function createResponseMessage(message: ChatLocalMessage, showMessage: boolean): ChatLocalMessage {
    return showMessage ? options.addLocalMessage(message, options.sessionId()) : { ...message };
  }

  function branchSelectionStorageKey(): string {
    return `${BRANCH_SELECTION_STORAGE_KEY}:${options.projectPath() || '~'}`;
  }

  function defaultMainBranch() {
    return branchOptions.value.find((branch) => branch === 'main') || branchOptions.value[0] || '';
  }

  function rememberBranchSelection(branch: string): void {
    if (branch) localStorage.setItem(branchSelectionStorageKey(), branch);
  }

  function formatBranchSuccess(data: { cwd?: string; name?: string; baseBranch?: string; output?: string }) {
    const output = data.output?.trim() || options.t('components.chatPanel.switchedToNewBranch', { name: data.name || '' });
    const base = data.baseBranch ? `\n\nBase: \`${data.baseBranch}\`` : '';
    return `### Git branch created\n\n\`${data.cwd || options.projectPath()}\`\n\nBranch: \`${data.name || ''}\`${base}\n\n\`\`\`text\n${output}\n\`\`\``;
  }

  function formatBranchSwitchSuccess(data: { cwd?: string; name?: string; pulled?: boolean; deletedBranch?: { name?: string; commit?: string }; output?: string }) {
    const output = data.output?.trim() || options.t('components.chatPanel.switchedToBranch', { name: data.name || '' });
    const pulled = data.pulled ? '\n\nPulled: `git pull --ff-only`' : '';
    const deleted = data.deletedBranch
      ? `\n\nDeleted original branch: \`${data.deletedBranch.name || ''}\` (last commit \`${data.deletedBranch.commit || ''}\`)`
      : '';
    return `### Git branch switched\n\n\`${data.cwd || options.projectPath()}\`\n\nBranch: \`${data.name || ''}\`${pulled}${deleted}\n\n\`\`\`text\n${output}\n\`\`\``;
  }

  async function loadBranchOptions() {
    branchDialogLoading.value = true;
    branchDialogError.value = '';
    branchHasChanges.value = false;
    try {
      const [branchesData, statusData] = await Promise.all([
        gitOperations.getBranches(options.projectPath() || '~'),
        gitOperations.getStatus({ cwd: options.projectPath() || '~' }),
      ]);
      branchOptions.value = Array.isArray(branchesData.branches) ? branchesData.branches : [];
      branchHasChanges.value = Array.isArray(statusData.files) && statusData.files.length > 0;
      const savedBranch = localStorage.getItem(branchSelectionStorageKey()) || '';
      const rememberedBranch = branchOptions.value.includes(savedBranch) ? savedBranch : '';
      // Reuse one saved choice for both branch selectors while it remains valid.
      branchSwitchName.value = rememberedBranch || defaultMainBranch();
      branchBaseName.value = rememberedBranch || branchesData.current || defaultMainBranch();
    } catch (error) {
      branchDialogError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToLoadGitBranches');
    } finally {
      branchDialogLoading.value = false;
    }
  }

  function closeBranchDialog() {
    branchDialogOpen.value = false;
    branchDialogError.value = '';
  }

  async function openBranchDialog() {
    options.closeCommands();
    options.clearComposer();
    branchDialogMode.value = 'switch';
    branchNewName.value = '';
    branchPullAfterSwitch.value = true;
    branchDeleteOriginal.value = true;
    branchDialogOpen.value = true;
    await loadBranchOptions();
  }

  async function generateBranchDialogName() {
    const clientId = options.clientId();
    if (!clientId) {
      branchDialogError.value = 'clientId is required to generate a branch name with AI';
      return;
    }
    branchGeneratingName.value = true;
    branchDialogError.value = '';
    try {
      const data = await gitOperations.generateBranchName({ cwd: options.projectPath() || '~', clientId });
      branchNewName.value = data.name || '';
    } catch (error) {
      branchDialogError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToGenerateBranchName');
    } finally {
      branchGeneratingName.value = false;
    }
  }

  async function runBranchCreate(name: string, baseBranch: string | undefined, userText: string, showUserMessage = true) {
    if (showUserMessage) options.addLocalMessage({ role: 'user', content: userText, kind: 'text' }, options.sessionId());
    const responseMessage = createResponseMessage({
      role: 'assistant',
      content: options.t('components.chatPanel.creatingGitBranch'),
      kind: 'status',
      status: 'pending',
      title: options.t('components.chatPanel.gitBranch'),
    }, showUserMessage);

    try {
      const data = await gitOperations.createBranch({ cwd: options.projectPath() || '~', name, baseBranch });
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = formatBranchSuccess(data);
      if (!showUserMessage) options.showToast(options.t('components.chatPanel.switchedToNewBranch', { name: data.name || name }), 'success');
      options.onBranchChanged();
      void options.refreshSessionStatus();
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = options.t('components.chatPanel.gitBranchFailed');
      responseMessage.content = error instanceof Error ? error.message : options.t('components.chatPanel.failedToCreateGitBranch');
      if (!showUserMessage) options.showToast(responseMessage.content, 'error');
      throw error;
    }
  }

  async function runBranchSwitch(name: string, pull: boolean, deleteOriginal: boolean, userText: string, showUserMessage = true) {
    if (showUserMessage) options.addLocalMessage({ role: 'user', content: userText, kind: 'text' }, options.sessionId());
    const responseMessage = createResponseMessage({
      role: 'assistant',
      content: options.t('components.chatPanel.switchingGitBranch'),
      kind: 'status',
      status: 'pending',
      title: options.t('components.chatPanel.gitBranch'),
    }, showUserMessage);

    try {
      const data = await gitOperations.switchBranch({
        cwd: options.projectPath() || '~',
        name,
        pull,
        deleteOriginal,
        sessionId: options.sessionId(),
      });
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = formatBranchSwitchSuccess(data);
      if (!showUserMessage) options.showToast(options.t('components.chatPanel.switchedToBranch', { name: data.name || name }), 'success');
      options.onBranchChanged();
      void options.refreshSessionStatus();
    } catch (error) {
      responseMessage.status = 'failure';
      responseMessage.title = options.t('components.chatPanel.gitBranchFailed');
      responseMessage.content = error instanceof Error ? error.message : options.t('components.chatPanel.failedToSwitchGitBranch');
      if (!showUserMessage) options.showToast(responseMessage.content, 'error');
      throw error;
    }
  }

  async function submitBranchDialog() {
    branchDialogSubmitting.value = true;
    branchDialogError.value = '';
    try {
      if (branchDialogMode.value === 'switch') {
        const name = branchSwitchName.value.trim();
        if (!name) throw new Error(options.t('components.chatPanel.selectABranchToSwitchTo'));
        await runBranchSwitch(name, branchPullAfterSwitch.value, branchDeleteOriginal.value, '/branch', branchCommandShowsUserMessage.value);
      } else {
        const name = branchNewName.value.trim();
        const baseBranch = branchDialogMode.value === 'base' ? branchBaseName.value.trim() : undefined;
        if (!name) throw new Error(options.t('components.chatPanel.branchNameIsRequired'));
        if (branchDialogMode.value === 'base' && !baseBranch) throw new Error(options.t('components.chatPanel.selectABaseBranch'));
        await runBranchCreate(name, baseBranch, '/branch', branchCommandShowsUserMessage.value);
      }
      closeBranchDialog();
    } catch (error) {
      branchDialogError.value = error instanceof Error ? error.message : options.t('components.chatPanel.gitBranchOperationFailed');
    } finally {
      branchDialogSubmitting.value = false;
    }
  }

  async function handleBranchCommand(text: string, showUserMessage = true) {
    const [name, baseBranch] = text.trim().replace(/^\/branch(?:\s+|$)/i, '').trim().split(/\s+/).filter(Boolean);
    if (!name) {
      branchCommandShowsUserMessage.value = showUserMessage;
      await openBranchDialog();
      return;
    }

    options.closeCommands();
    options.clearComposer();
    await runBranchCreate(name, baseBranch, text, showUserMessage);
  }

  return {
    branchOptions,
    branchDialogOpen,
    branchDialogMode,
    branchDialogLoading,
    branchDialogSubmitting,
    branchGeneratingName,
    branchDialogError,
    branchHasChanges,
    branchSwitchName,
    branchBaseName,
    branchNewName,
    branchPullAfterSwitch,
    branchDeleteOriginal,
    branchDialogActionLabel,
    branchSelectOptions,
    rememberBranchSelection,
    closeBranchDialog,
    openBranchDialog,
    generateBranchDialogName,
    submitBranchDialog,
    handleBranchCommand,
  };
}
