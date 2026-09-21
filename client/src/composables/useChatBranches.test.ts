import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatBranches } from './useChatBranches';

const git = vi.hoisted(() => ({
  getBranches: vi.fn(),
  getStatus: vi.fn(),
  generateBranchName: vi.fn(),
  createBranch: vi.fn(),
  switchBranch: vi.fn(),
}));

vi.mock('../services/gitOperations', () => ({ createGitOperations: () => git }));

function setup() {
  const messages: any[] = [];
  const options = {
    projectPath: () => '/repo',
    sessionId: () => 'session-1',
    clientId: () => 'client-1',
    closeCommands: vi.fn(),
    clearComposer: vi.fn(),
    addLocalMessage: vi.fn((message: any) => { messages.push(message); return message; }),
    showToast: vi.fn(),
    refreshSessionStatus: vi.fn(),
    onBranchChanged: vi.fn(),
    t: (key: string) => key,
  };
  return { branches: useChatBranches(options), options, messages };
}

describe('useChatBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads branch choices and remembers a project-specific selection', async () => {
    git.getBranches.mockResolvedValue({ current: 'feature/old', branches: ['feature/old', 'main'] });
    git.getStatus.mockResolvedValue({ files: [] });
    const first = setup();

    await first.branches.openBranchDialog();
    first.branches.rememberBranchSelection('feature/old');
    const second = setup();
    await second.branches.openBranchDialog();

    expect(first.options.clearComposer).toHaveBeenCalledOnce();
    expect(second.branches.branchSwitchName.value).toBe('feature/old');
    expect(second.branches.branchBaseName.value).toBe('feature/old');
  });

  it('creates a named branch directly and reports the change', async () => {
    git.createBranch.mockResolvedValue({ cwd: '/repo', name: 'feature/new', baseBranch: 'main' });
    const { branches, options, messages } = setup();

    await branches.handleBranchCommand('/branch feature/new main');

    expect(git.createBranch).toHaveBeenCalledWith({ cwd: '/repo', name: 'feature/new', baseBranch: 'main' });
    expect(options.onBranchChanged).toHaveBeenCalledOnce();
    expect(options.refreshSessionStatus).toHaveBeenCalledOnce();
    expect(messages.at(-1).content).toContain('Git branch created');
  });
});
