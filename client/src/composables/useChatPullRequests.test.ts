import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useChatPullRequests } from './useChatPullRequests';

const hosting = vi.hoisted(() => ({
  previewPr: vi.fn(),
  generatePrContent: vi.fn(),
  createPr: vi.fn(),
}));

vi.mock('./useGitHosting', () => ({ useGitHosting: () => hosting }));

const preview = (overrides = {}) => ({
  cwd: '/repo', provider: 'github' as const, owner: 'acme', repo: 'app', targetBranch: 'main',
  sourceBranch: 'feature', generatedBranch: false, hasChanges: true,
  files: [{ status: 'M', path: 'src/app.ts' }], commitMessage: 'change', title: 'Title', body: 'Body', stateToken: 'token',
  ...overrides,
});

function setup(overrides: Record<string, unknown> = {}) {
  const messages: any[] = [];
  const options = {
    projectPath: () => '/repo', sessionId: () => 'session-1', clientId: () => 'client-1',
    branchOptions: ref(['develop', 'main']), closeCommands: vi.fn(), clearComposer: vi.fn(),
    addLocalMessage: vi.fn((message: any) => { messages.push(message); return message; }),
    showToast: vi.fn(),
    t: (key: string) => key,
    ...overrides,
  };
  return { pr: useChatPullRequests(options as any), options, messages };
}

describe('useChatPullRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ branches: ['release'] }), { status: 200 })));
  });

  it('previews a PR command and builds unique branch choices', async () => {
    hosting.previewPr.mockResolvedValue(preview());
    const { pr, options, messages } = setup();
    await pr.handlePrCommand('/pr develop');

    expect(hosting.previewPr).toHaveBeenCalledWith('/repo', 'develop');
    expect(options.closeCommands).toHaveBeenCalled();
    expect(options.clearComposer).toHaveBeenCalled();
    expect(messages.at(-1).content).toContain('Proposed GitHub PR');
    expect(pr.prTargetBranchOptions.value.map((item) => item.value)).toEqual(['main', 'release']);
  });

  it('uses defaults, handles empty files, and records preview failures', async () => {
    hosting.previewPr.mockResolvedValueOnce(preview({ provider: 'gitea', files: [] }));
    const first = setup({ projectPath: () => undefined });
    await first.pr.handlePrCommand('/pr');
    expect(hosting.previewPr).toHaveBeenCalledWith('~', 'main');
    expect(first.messages.at(-1).content).toContain('Proposed Gitea PR');
    expect(first.messages.at(-1).content).toContain('noUncommittedFiles');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'branches failed' }), { status: 500 })));
    hosting.previewPr.mockRejectedValueOnce(new Error('preview failed'));
    const second = setup();
    await second.pr.handlePrCommand('/pr main');
    expect(second.options.branchOptions.value).toEqual([]);
    expect(second.messages.at(-1)).toMatchObject({ status: 'failure', content: 'preview failed' });
  });

  it('keeps PRs opened from the Git panel out of chat history and toasts preview failures', async () => {
    hosting.previewPr.mockResolvedValueOnce(preview());
    const { pr, options, messages } = setup();

    await pr.handlePrCommand('/pr main', false);
    pr.cancelPr();
    hosting.previewPr.mockRejectedValueOnce(new Error('Current branch matches target branch and there is nothing to PR'));
    await pr.handlePrCommand('/pr main', false);

    expect(messages).toEqual([]);
    expect(options.showToast).toHaveBeenCalledWith(
      'Current branch matches target branch and there is nothing to PR',
      'error',
    );
  });

  it('cancels and updates target branches while preserving edited content', async () => {
    hosting.previewPr.mockResolvedValue(preview());
    const { pr, messages } = setup();
    await pr.handlePrCommand('/pr main');
    pr.prPreview.value!.title = 'Edited';
    pr.prPreview.value!.body = 'Edited body';
    hosting.previewPr.mockResolvedValue(preview({ targetBranch: 'release', title: 'generated', body: 'generated' }));
    await pr.updatePrTargetBranch('release');
    expect(pr.prPreview.value).toMatchObject({ targetBranch: 'release', title: 'Edited', body: 'Edited body' });
    expect(messages.at(-1).content).toContain('release');

    hosting.previewPr.mockRejectedValueOnce('bad');
    await pr.updatePrTargetBranch('main');
    expect(pr.prGenerationError.value).toBe('components.chatPanel.failedToUpdatePrTargetBranch');
    await pr.updatePrTargetBranch('');
    pr.cancelPr();
    expect(messages.at(-1).content).toContain('cancelled');
    expect(pr.prPreview.value).toBeNull();
    pr.cancelPr();
  });

  it('generates PR content and validates generation prerequisites', async () => {
    hosting.previewPr.mockResolvedValue(preview());
    hosting.generatePrContent.mockResolvedValue({ title: 'AI title', body: 'AI body' });
    const { pr } = setup();
    await pr.generatePrContent();
    await pr.handlePrCommand('/pr main');
    await pr.generatePrContent();
    expect(pr.prPreview.value).toMatchObject({ title: 'AI title', body: 'AI body' });

    hosting.generatePrContent.mockRejectedValueOnce('bad');
    await pr.generatePrContent();
    expect(pr.prGenerationError.value).toBe('components.chatPanel.failedToGeneratePrContent');

    const noClient = setup({ clientId: () => undefined });
    hosting.previewPr.mockResolvedValue(preview());
    await noClient.pr.handlePrCommand('/pr main');
    await noClient.pr.generatePrContent();
    expect(noClient.pr.prGenerationError.value).toContain('clientId is required');
  });

  it('creates PRs, dispatches refresh, and reports creation errors', async () => {
    hosting.previewPr.mockResolvedValue(preview());
    hosting.createPr.mockResolvedValue({ pullRequest: { number: 42, url: 'https://example.test/pr/42' } });
    const refresh = vi.fn();
    window.addEventListener('refresh-file-tree', refresh);
    const { pr, messages } = setup();
    await pr.confirmPr();
    await pr.handlePrCommand('/pr main');
    await pr.confirmPr();
    expect(messages.at(-1).content).toContain('#42');
    expect(refresh).toHaveBeenCalled();

    hosting.previewPr.mockResolvedValue(preview({ provider: 'gitea' }));
    hosting.createPr.mockRejectedValueOnce('bad');
    const failed = setup();
    await failed.pr.handlePrCommand('/pr main');
    await failed.pr.confirmPr();
    expect(failed.messages.at(-1)).toMatchObject({ status: 'failure', content: 'components.chatPanel.failedToCreatePullRequest' });

    hosting.previewPr.mockResolvedValue(preview());
    hosting.createPr.mockResolvedValueOnce({ pullRequest: { number: 43, url: 'https://example.test/pr/43' } });
    const hidden = setup();
    await hidden.pr.handlePrCommand('/pr main', false);
    await hidden.pr.confirmPr();
    expect(hidden.options.showToast).toHaveBeenCalledWith('GitHub PR #43 created.', 'success');
  });
});
