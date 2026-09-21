import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatCommits } from './useChatCommits';

const git = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  getAmendStatus: vi.fn(),
  generateCommitMessage: vi.fn(),
  saveCommit: vi.fn(),
}));

vi.mock('../services/gitOperations', () => ({ createGitOperations: () => git }));

function setup() {
  const messages: any[] = [];
  const options = {
    projectPath: () => '/repo',
    sessionId: () => 'session-1',
    clientId: () => 'client-1',
    sessionTitle: () => 'Session title',
    closeCommands: vi.fn(),
    clearComposer: vi.fn(),
    addLocalMessage: vi.fn((message: any) => { messages.push(message); return message; }),
    showToast: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) => params?.count === undefined ? key : `${key}:${params.count}`,
  };
  return { commits: useChatCommits(options), options, messages };
}

describe('useChatCommits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prepares a commit preview and loads its diff', async () => {
    git.getStatus.mockResolvedValue({ cwd: '/repo', message: 'Session title', files: [{ status: 'M', path: 'app.ts' }] });
    git.getDiff.mockResolvedValue({ diff: 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n-old\n+new' });
    const { commits, options } = setup();

    await commits.handleCommitCommand('/commit');
    await commits.loadCommitDiff();

    expect(options.closeCommands).toHaveBeenCalledOnce();
    expect(options.clearComposer).toHaveBeenCalledOnce();
    expect(commits.commitPreview.value).toMatchObject({ message: 'Session title', mode: 'commit' });
    expect(commits.commitDiffFiles.value).toHaveLength(1);
    expect(commits.commitDiffSummary.value).toContain('components.chatPanel.fileChanged:1');
  });

  it('commits the edited preview and emits refresh events', async () => {
    git.getStatus.mockResolvedValue({ cwd: '/repo', message: 'Initial', files: [{ status: 'M', path: 'app.ts' }] });
    git.saveCommit.mockResolvedValue({ cwd: '/repo', message: 'Edited', commit: 'abcdef123' });
    const refresh = vi.fn();
    window.addEventListener('refresh-git-status', refresh);
    const { commits } = setup();

    await commits.handleCommitCommand('/commit');
    commits.commitPreview.value!.message = 'Edited';
    await commits.confirmCommit();

    expect(git.saveCommit).toHaveBeenCalledWith('commit', expect.objectContaining({ message: 'Edited', sessionId: 'session-1' }));
    expect(refresh).toHaveBeenCalledOnce();
    window.removeEventListener('refresh-git-status', refresh);
  });
});
