import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const completeSimpleMock = vi.hoisted(() => vi.fn());
const ORIGINAL_ALLOWED_ROOTS = process.env.PI_WEBUI_ALLOWED_ROOTS;

const modelRegistryFindMock = vi.hoisted(() => vi.fn(() => ({ provider: 'mock', id: 'automation-model', api: 'mock-api' })));
const modelRegistryGetAvailableMock = vi.hoisted(() => vi.fn(() => [{ provider: 'fallback', id: 'first-model', api: 'mock-api' }]));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  completeSimple: completeSimpleMock,
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: { create: vi.fn(() => ({})) },
  ModelRegistry: {
    create: vi.fn(() => ({
      refresh: vi.fn(),
      find: modelRegistryFindMock,
      getAvailable: modelRegistryGetAvailableMock,
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: 'key' })),
    })),
  },
}));

vi.mock('../services/session-manager.js', () => ({
  sessionService: {
    getClientAgentDirForRoutes: vi.fn(async () => '/tmp/pi-agent'),
    getClientAgentProfile: vi.fn(async () => ({ defaultProvider: 'chat', defaultModel: 'chat-model', automationProvider: 'mock', automationModel: 'automation-model' })),
    runForegroundWithClientProfileProxy: vi.fn(async (_clientId: string, fn: () => Promise<unknown>) => fn()),
  },
}));

import { DEFAULT_COMMIT_MESSAGE_PROMPTS } from '../services/commit-message-prompt-store';
import { gitRoutes, type GitRouteOptions } from './git';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createRepo() {
  const cwd = await mkdtemp(join(tmpdir(), 'piui-git-route-'));
  await git(cwd, 'init');
  await git(cwd, 'config', 'user.email', 'test@example.com');
  await git(cwd, 'config', 'user.name', 'Test User');
  await writeFile(join(cwd, 'README.md'), 'initial\n');
  await git(cwd, 'add', 'README.md');
  await git(cwd, 'commit', '-m', 'Initial commit');
  return cwd;
}

async function buildApp(options: GitRouteOptions = {}) {
  const app = Fastify();
  await app.register(gitRoutes, { prefix: '/api/git', ...options });
  return app;
}

beforeEach(() => {
  process.env.PI_WEBUI_ALLOWED_ROOTS = tmpdir();
});

afterEach(() => {
  if (ORIGINAL_ALLOWED_ROOTS === undefined) {
    delete process.env.PI_WEBUI_ALLOWED_ROOTS;
  } else {
    process.env.PI_WEBUI_ALLOWED_ROOTS = ORIGINAL_ALLOWED_ROOTS;
  }
});

describe('gitRoutes status and diff', () => {
  it('rejects git operations outside configured allowed roots', async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), 'piui-git-allowed-'));
    const cwd = await createRepo();
    const app = await buildApp();
    process.env.PI_WEBUI_ALLOWED_ROOTS = allowedRoot;

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/git/status?cwd=${encodeURIComponent(cwd)}`,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().message).toContain('Path is outside the configured allowed roots');
    } finally {
      await app.close();
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('reports staged-only files in git status for commit previews', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'staged change\n');
      await git(cwd, 'add', 'README.md');

      const response = await app.inject({
        method: 'GET',
        url: `/api/git/status?cwd=${encodeURIComponent(cwd)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().files).toEqual([{ path: 'README.md', status: 'M' }]);
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('commits staged-only changes', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'staged change\n');
      await git(cwd, 'add', 'README.md');

      const response = await app.inject({
        method: 'POST',
        url: '/api/git/commit',
        payload: { cwd, message: 'Commit staged change' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().files).toEqual([{ path: 'README.md', status: 'M' }]);
      expect(await git(cwd, 'log', '-1', '--pretty=%s')).toBe('Commit staged change');
      expect(await git(cwd, 'status', '--porcelain')).toBe('');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('includes staged-only content in git diff output by default', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'staged change\n');
      await git(cwd, 'add', 'README.md');

      const response = await app.inject({
        method: 'GET',
        url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ scope: 'all' });
      expect(response.json().stat).toContain('README.md');
      expect(response.json().diff).toContain('+staged change');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns the change introduced by a specific abbreviated commit ID', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'committed change\n');
      await git(cwd, 'add', 'README.md');
      await git(cwd, 'commit', '-m', 'Change readme');
      const commit = (await git(cwd, 'rev-parse', '--short=7', 'HEAD')).trim();

      const response = await app.inject({
        method: 'GET',
        url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}&commit=${commit}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ commit, scope: `commit-${commit}` });
      expect(response.json().stat).toContain('README.md');
      expect(response.json().diff).toContain('+committed change');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns a small, user-friendly fallback instead of an oversized diff', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), `${'large change '.repeat(30_000)}\n`);

      const response = await app.inject({
        method: 'GET',
        url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}`,
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(response.body.length).toBeLessThan(2_000);
      expect(body).toMatchObject({ oversized: true, maxBytes: 256 * 1024 });
      expect(body).not.toHaveProperty('diff');
      expect(body.message).toContain('too large to show safely');
      expect(body.message).toContain('terminal or another Git client');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('enforces the diff limit cumulatively across staged and unstaged output', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'SECOND.md'), 'initial\n');
      await git(cwd, 'add', 'SECOND.md');
      await git(cwd, 'commit', '-m', 'Add second file');
      await writeFile(join(cwd, 'README.md'), 'staged line\n'.repeat(11_000));
      await git(cwd, 'add', 'README.md');
      await writeFile(join(cwd, 'SECOND.md'), 'worktree line\n'.repeat(11_000));

      const stagedResponse = await app.inject({ method: 'GET', url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}&scope=staged` });
      const unstagedResponse = await app.inject({ method: 'GET', url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}&scope=unstaged` });
      const combinedResponse = await app.inject({ method: 'GET', url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}` });

      expect(stagedResponse.json().oversized).toBeUndefined();
      expect(unstagedResponse.json().oversized).toBeUndefined();
      expect(combinedResponse.json()).toMatchObject({ oversized: true, maxBytes: 256 * 1024 });
      expect(combinedResponse.json()).not.toHaveProperty('diff');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('filters git diff output to staged or unstaged changes when requested', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'staged change\n');
      await git(cwd, 'add', 'README.md');
      await writeFile(join(cwd, 'README.md'), 'unstaged change\n');

      const stagedResponse = await app.inject({
        method: 'GET',
        url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}&scope=staged`,
      });
      const unstagedResponse = await app.inject({
        method: 'GET',
        url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}&scope=unstaged`,
      });
      const combinedResponse = await app.inject({
        method: 'GET',
        url: `/api/git/diff?cwd=${encodeURIComponent(cwd)}`,
      });

      expect(stagedResponse.statusCode).toBe(200);
      expect(stagedResponse.json().diff).toContain('+staged change');
      expect(stagedResponse.json().diff).not.toContain('+unstaged change');
      expect(unstagedResponse.statusCode).toBe(200);
      expect(unstagedResponse.json().diff).toContain('+unstaged change');
      expect(unstagedResponse.json().diff).not.toContain('+staged change');
      expect(combinedResponse.statusCode).toBe(200);
      expect(combinedResponse.json().diff).toContain('+staged change');
      expect(combinedResponse.json().diff).toContain('+unstaged change');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('includes staged-only content in editor changed ranges', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await mkdir(join(cwd, 'src'));
      await writeFile(join(cwd, 'src', 'new.ts'), 'const value = 1;\n');
      await git(cwd, 'add', 'src/new.ts');

      const response = await app.inject({
        method: 'GET',
        url: `/api/git/changes?cwd=${encodeURIComponent(cwd)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().changes['src/new.ts']).toEqual([{ start: 1, end: 1, type: 'added' }]);
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('gitRoutes branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelRegistryFindMock.mockReturnValue({ provider: 'mock', id: 'automation-model', api: 'mock-api' });
    modelRegistryGetAvailableMock.mockReturnValue([{ provider: 'fallback', id: 'first-model', api: 'mock-api' }]);
    completeSimpleMock.mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'feature/ai-branch-name' }],
      stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: 'mock-api',
      provider: 'mock',
      model: 'model',
      timestamp: Date.now(),
    });
  });

  it('rejects /branch without a name when there are no git changes', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/git/branch',
        payload: { cwd },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('No git changes');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('creates a suggested branch from working tree changes', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'changed\n');
      const response = await app.inject({
        method: 'POST',
        url: '/api/git/branch',
        payload: { cwd },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('update-readme.md');
      expect(await git(cwd, 'branch', '--show-current')).toBe('update-readme.md');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('generates a branch name with AI from working tree changes', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'changed\n');
      const response = await app.inject({
        method: 'GET',
        url: `/api/git/branch-name?cwd=${encodeURIComponent(cwd)}&clientId=client-1`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('feature/ai-branch-name');
      expect(completeSimpleMock).toHaveBeenCalledOnce();
      expect(modelRegistryFindMock).toHaveBeenCalledWith('mock', 'automation-model');
      expect(completeSimpleMock.mock.calls[0][0]).toMatchObject({ provider: 'mock', id: 'automation-model' });
      expect(completeSimpleMock.mock.calls[0][2]).not.toHaveProperty('temperature');
      expect(completeSimpleMock.mock.calls[0][2].sessionId).toMatch(/^branch-name:[a-f0-9]{32}$/);
      expect(completeSimpleMock.mock.calls[0][2].sessionId.length).toBeLessThanOrEqual(64);
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('falls back to the first available model when automation model is unavailable', async () => {
    modelRegistryFindMock.mockReturnValueOnce(undefined as any);
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'changed\n');
      const response = await app.inject({
        method: 'GET',
        url: `/api/git/branch-name?cwd=${encodeURIComponent(cwd)}&clientId=client-1`,
      });

      expect(response.statusCode).toBe(200);
      expect(modelRegistryGetAvailableMock).toHaveBeenCalled();
      expect(completeSimpleMock.mock.calls[0][0]).toMatchObject({ provider: 'fallback', id: 'first-model' });
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects system-only commit prompt customization', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/git/commit-message-prompts',
        payload: { scope: 'global', systemPrompt: 'Custom system prompt' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'userPrompt must be provided' });
    } finally {
      await app.close();
    }
  });

  it('uses the project user prompt when generating with AI', async () => {
    completeSimpleMock.mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'feat: customize commits' }],
      stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: 'mock-api', provider: 'mock', model: 'model', timestamp: Date.now(),
    });
    const cwd = await createRepo();
    const prompts = {
      get: vi.fn(() => ({ global: {}, project: {}, effective: { systemPrompt: DEFAULT_COMMIT_MESSAGE_PROMPTS.systemPrompt, userPrompt: 'Write a commit title only.' } })),
      save: vi.fn(),
    };
    const app = await buildApp({ commitMessagePrompts: prompts });
    try {
      await writeFile(join(cwd, 'README.md'), 'changed\n');
      const response = await app.inject({
        method: 'GET',
        url: `/api/git/commit-message?cwd=${encodeURIComponent(cwd)}&clientId=client-1`,
      });

      expect(response.statusCode).toBe(200);
      expect(prompts.get).toHaveBeenCalledWith(cwd);
      expect(completeSimpleMock.mock.calls[0][1].systemPrompt).toBe(DEFAULT_COMMIT_MESSAGE_PROMPTS.systemPrompt);
      expect(completeSimpleMock.mock.calls[0][1].messages[0].content).toContain('Write a commit title only.');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('generates a commit message with AI from staged and unstaged changes', async () => {
    completeSimpleMock.mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'Update README content' }],
      stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: 'mock-api',
      provider: 'mock',
      model: 'model',
      timestamp: Date.now(),
    });
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      await writeFile(join(cwd, 'README.md'), 'staged change\n');
      await git(cwd, 'add', 'README.md');
      await writeFile(join(cwd, 'README.md'), 'unstaged change\n');

      const response = await app.inject({
        method: 'GET',
        url: `/api/git/commit-message?cwd=${encodeURIComponent(cwd)}&clientId=client-1`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Update README content');
      expect(modelRegistryFindMock).toHaveBeenCalledWith('mock', 'automation-model');
      const request = completeSimpleMock.mock.calls[0][1];
      expect(request.systemPrompt).toContain('accurate Conventional Commit messages');
      const prompt = request.messages[0].content;
      expect(prompt).toContain('Generate one Conventional Commit message');
      expect(prompt).toContain('--- BEGIN GIT STATUS ---');
      expect(prompt).toContain('+staged change');
      expect(prompt).toContain('+unstaged change');
      expect(prompt).toContain('--- END GIT DIFF ---');
      expect(completeSimpleMock.mock.calls[0][2]).not.toHaveProperty('temperature');
      expect(completeSimpleMock.mock.calls[0][2].maxTokens).toBe(220);
      expect(completeSimpleMock.mock.calls[0][2].sessionId).toMatch(/^commit-message:[a-f0-9]{32}$/);
      expect(completeSimpleMock.mock.calls[0][2].sessionId.length).toBeLessThanOrEqual(64);
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('deletes the original branch after switching by default and records its tip', async () => {
    const cwd = await createRepo();
    const recordBranchDeleted = vi.fn();
    const app = await buildApp({ activityStore: { recordCommit: vi.fn(), recordBranchDeleted } });
    try {
      const originalBranch = await git(cwd, 'branch', '--show-current');
      const originalCommit = await git(cwd, 'rev-parse', 'HEAD');
      await git(cwd, 'checkout', '-b', 'target');
      await git(cwd, 'checkout', originalBranch);

      const response = await app.inject({
        method: 'POST',
        url: '/api/git/switch-branch',
        payload: { cwd, name: 'target', sessionId: 'session-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().deletedBranch).toEqual({ name: originalBranch, commit: originalCommit });
      expect(await git(cwd, 'branch', '--show-current')).toBe('target');
      expect((await git(cwd, 'branch', '--format=%(refname:short)')).split('\n')).not.toContain(originalBranch);
      expect(recordBranchDeleted).toHaveBeenCalledWith({
        sessionId: 'session-1',
        cwd,
        branch: originalBranch,
        commit: originalCommit,
      });
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('keeps the original branch when deletion is disabled', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      const originalBranch = await git(cwd, 'branch', '--show-current');
      await git(cwd, 'checkout', '-b', 'target');
      await git(cwd, 'checkout', originalBranch);

      const response = await app.inject({
        method: 'POST',
        url: '/api/git/switch-branch',
        payload: { cwd, name: 'target', deleteOriginal: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().deletedBranch).toBeUndefined();
      expect((await git(cwd, 'branch', '--format=%(refname:short)')).split('\n')).toContain(originalBranch);
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('creates a named branch from an explicit base branch', async () => {
    const cwd = await createRepo();
    const app = await buildApp();
    try {
      const currentBranch = await git(cwd, 'branch', '--show-current');
      await git(cwd, 'checkout', '-b', 'develop');
      await git(cwd, 'checkout', currentBranch);
      const response = await app.inject({
        method: 'POST',
        url: '/api/git/branch',
        payload: { cwd, name: 'feature/new-name', baseBranch: 'develop' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ name: 'feature/new-name', baseBranch: 'develop' });
      expect(await git(cwd, 'branch', '--show-current')).toBe('feature/new-name');
    } finally {
      await app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
