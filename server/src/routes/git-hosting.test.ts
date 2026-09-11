import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitHostingRoutes } from './git-hosting';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: Function) => callback(null, '', '')),
}));

function app() {
  const handlers: Record<string, Function> = {};
  return {
    handlers,
    app: {
      get: vi.fn((path, handler) => { handlers[`GET ${path}`] = handler; }),
      post: vi.fn((path, handler) => { handlers[`POST ${path}`] = handler; }),
      delete: vi.fn((path, handler) => { handlers[`DELETE ${path}`] = handler; }),
    },
  };
}

function routeOptions(overrides: Record<string, unknown>) {
  return {
    settings: { getSanitized: vi.fn().mockReturnValue({ serverUrl: '', tokenConfigured: false }), get: vi.fn().mockReturnValue({ serverUrl: '', token: '' }) },
    githubSettings: { getSanitized: vi.fn().mockReturnValue({ serverUrl: 'https://github.com', tokenConfigured: false }), get: vi.fn().mockReturnValue({ serverUrl: 'https://github.com', token: '' }) },
    tasks: {},
    git: {},
    createClient: vi.fn(),
    createGithubClient: vi.fn(),
    ...overrides,
  };
}

const execFileMock = vi.mocked(execFile);

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockImplementation(((_file: string, _args: string[], _options: unknown, callback: Function) => callback(null, '', '')) as any);
});

describe('git hosting routes', () => {
  it('returns sanitized settings after saving', async () => {
    const api = app();
    const settings = { save: vi.fn(), get: vi.fn(), getSanitized: vi.fn().mockReturnValue({ serverUrl: 'https://git.example.com', tokenConfigured: true }), clear: vi.fn() };
    await gitHostingRoutes(api.app as any, routeOptions({ settings }) as any);

    const result = await api.handlers['POST /settings']({ body: { serverUrl: 'https://git.example.com', token: 'secret' } }, {});
    expect(settings.save).toHaveBeenCalledWith({ serverUrl: 'https://git.example.com', token: 'secret' });
    expect(result).toEqual({ settings: { serverUrl: 'https://git.example.com', tokenConfigured: true }, githubSettings: { serverUrl: 'https://github.com', tokenConfigured: false } });
  });

  it('tests a draft Gitea connection without saving it', async () => {
    const api = app();
    const testConnection = vi.fn().mockResolvedValue(undefined);
    const createClient = vi.fn().mockReturnValue({ testConnection });
    const settings = { get: vi.fn().mockReturnValue({ serverUrl: 'https://saved.example.com', token: 'saved-token' }), getSanitized: vi.fn() };
    await gitHostingRoutes(api.app as any, routeOptions({ settings, createClient }) as any);

    const result = await api.handlers['POST /test']({ body: { serverUrl: 'https://draft.example.com' } }, {});

    expect(createClient).toHaveBeenCalledWith({ serverUrl: 'https://draft.example.com', token: 'saved-token' });
    expect(settings.get).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('tests GitHub connectivity directly when no proxy is set', async () => {
    const api = app();
    const originalHttpProxy = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://server-proxy';
    execFileMock.mockImplementation(((_file: string, args: string[], _options: unknown, callback: Function) => {
      callback(null, args.includes('https://ipinfo.io/country') ? 'ca\n' : '', '');
    }) as any);
    await gitHostingRoutes(api.app as any, routeOptions({}) as any);

    try {
      const result = await api.handlers['POST /github/proxy/test']({ body: { proxyUrl: '' } }, {});

      expect(result).toEqual({ ok: true, country: 'CA' });
      expect(execFileMock).toHaveBeenCalledWith('curl', expect.any(Array), expect.objectContaining({ timeout: 12_000 }), expect.any(Function));
      const options = execFileMock.mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
      expect(options.env.HTTP_PROXY).toBeUndefined();
    } finally {
      if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = originalHttpProxy;
    }
  });

  it('keeps successful GitHub connectivity when the country lookup fails', async () => {
    const api = app();
    execFileMock.mockImplementation(((_file: string, args: string[], _options: unknown, callback: Function) => {
      if (args.includes('https://ipinfo.io/country')) callback(new Error('country lookup failed'), '', '');
      else callback(null, '', '');
    }) as any);
    await gitHostingRoutes(api.app as any, routeOptions({}) as any);

    const result = await api.handlers['POST /github/proxy/test']({ body: { proxyUrl: '' } }, {});

    expect(result).toEqual({ ok: true });
  });

  it('tests GitHub connectivity through a draft proxy', async () => {
    const api = app();
    await gitHostingRoutes(api.app as any, routeOptions({}) as any);

    const result = await api.handlers['POST /github/proxy/test']({ body: { proxyUrl: 'http://proxy.example' } }, {});

    expect(result).toEqual({ ok: true });
    const options = execFileMock.mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
    expect(options.env.HTTPS_PROXY).toBe('http://proxy.example');
  });

  it('returns the GitHub API status when issue creation is rejected', async () => {
    const api = app();
    const error = Object.assign(new Error('Resource not accessible by personal access token'), { statusCode: 403 });
    const createIssue = vi.fn().mockRejectedValue(error);
    const createGithubClient = vi.fn().mockReturnValue({ createIssue });
    const tasks = { get: vi.fn().mockReturnValue({ id: 'task-1', giteaIssue: null }), attachGiteaIssue: vi.fn() };
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn((payload) => payload) };
    await gitHostingRoutes(api.app as any, routeOptions({ tasks, createGithubClient }) as any);

    const result = await api.handlers['POST /tasks/:id/issue']({
      params: { id: 'task-1' },
      body: { provider: 'github', owner: 'owner', repo: 'repo', title: 'Title', body: 'Body' },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(result).toEqual({ error: 'Resource not accessible by personal access token' });
    expect(tasks.attachGiteaIssue).not.toHaveBeenCalled();
  });

  it('requires a client id to generate issue content with AI', async () => {
    const api = app();
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn((payload) => payload) };
    await gitHostingRoutes(api.app as any, routeOptions({}) as any);

    const result = await api.handlers['POST /tasks/:id/issue/generate']({ body: { preview: {} } }, reply);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: 'clientId is required to generate issue content with AI' });
  });

  it('requires a client id to generate PR content with AI', async () => {
    const api = app();
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn((payload) => payload) };
    await gitHostingRoutes(api.app as any, routeOptions({}) as any);

    const result = await api.handlers['POST /pr/generate']({ body: { preview: {} } }, reply);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: 'clientId is required to generate PR content with AI' });
  });

  it('appends a closing issue line when creating a PR for a session task with a Gitea issue', async () => {
    const api = app();
    const createPr = vi.fn().mockResolvedValue({ number: 3, url: 'https://git.example.com/owner/repo/pulls/3' });
    const settings = { get: vi.fn().mockReturnValue({ serverUrl: 'https://git.example.com', token: 'secret' }) };
    const tasks = {
      list: vi.fn().mockReturnValue([
        { sessionId: 'session-1', giteaIssue: { number: 12 } },
      ]),
    };
    await gitHostingRoutes(api.app as any, routeOptions({ settings, tasks, git: { createPr }, createClient: vi.fn() }) as any);

    const result = await api.handlers['POST /pr/create']({
      body: { preview: {}, title: 'Add feature', body: 'AI generated body', commitMessage: 'Add feature', sessionId: 'session-1' },
    }, {});

    expect(createPr).toHaveBeenCalledWith(expect.objectContaining({ body: 'AI generated body\n\nClose #12' }));
    expect(result).toEqual({ pullRequest: { number: 3, url: 'https://git.example.com/owner/repo/pulls/3' } });
  });

  it('handles settings lifecycle and provider connection errors', async () => {
    const api = app();
    const settings = { get: vi.fn(() => ({ serverUrl: 'https://gitea', token: 'old' })), getSanitized: vi.fn(() => ({ serverUrl: 'https://gitea', tokenConfigured: true })), save: vi.fn(), clear: vi.fn() };
    const githubSettings = { get: vi.fn(() => ({ serverUrl: 'https://github.com', token: 'gh', proxyUrl: '' })), getSanitized: vi.fn(() => ({ serverUrl: 'https://github.com', tokenConfigured: true })), save: vi.fn(), clear: vi.fn(), saveProxyUrl: vi.fn() };
    const createClient = vi.fn(() => ({ testConnection: vi.fn().mockRejectedValue(new Error('gitea down')) }));
    const createGithubClient = vi.fn(() => ({ testConnection: vi.fn().mockResolvedValue(undefined) }));
    await gitHostingRoutes(api.app as any, routeOptions({ settings, githubSettings, createClient, createGithubClient }) as any);
    const successReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };

    expect(await api.handlers['GET /settings']()).toEqual({
      settings: { serverUrl: 'https://gitea', tokenConfigured: true },
      githubSettings: { serverUrl: 'https://github.com', tokenConfigured: true },
    });
    await api.handlers['DELETE /settings']();
    await api.handlers['POST /github/settings']({ body: { token: 'new' } }, successReply);
    await api.handlers['DELETE /github/settings']();
    await api.handlers['POST /github/proxy']({ body: { proxyUrl: 'http://proxy' } }, successReply);
    expect(await api.handlers['POST /github/test']({ body: {} }, successReply)).toEqual({ success: true });
    expect(settings.clear).toHaveBeenCalledTimes(1);
    expect(githubSettings.clear).toHaveBeenCalledTimes(1);
    expect(githubSettings.save).toHaveBeenCalledWith({ serverUrl: 'https://github.com', token: 'new' });
    expect(githubSettings.saveProxyUrl).toHaveBeenCalledWith('http://proxy');

    const failureReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /test']({ body: {} }, failureReply);
    expect(failureReply.status).toHaveBeenCalledWith(400);
    expect(failureReply.send).toHaveBeenCalledWith({ error: 'gitea down' });
  });

  it('previews and creates issues for both providers and validates task state', async () => {
    const api = app();
    const tasks = { get: vi.fn(), attachGiteaIssue: vi.fn((_id, issue) => ({ id: 'task', giteaIssue: issue })) };
    const git = { previewIssue: vi.fn().mockResolvedValue({ owner: 'o', repo: 'r' }) };
    const createIssue = vi.fn().mockResolvedValue({ number: 2, url: 'issue-url' });
    const options = routeOptions({ tasks, git, createClient: vi.fn(() => ({ createIssue })), createGithubClient: vi.fn(() => ({ createIssue })) });
    await gitHostingRoutes(api.app as any, options as any);
    tasks.get.mockReturnValueOnce(null);
    const missingPreviewReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /tasks/:id/issue/preview']({ params: { id: 'missing' } }, missingPreviewReply);
    expect(missingPreviewReply.status).toHaveBeenCalledWith(404);
    expect(missingPreviewReply.send).toHaveBeenCalledWith({ error: 'Task not found' });

    tasks.get.mockReturnValueOnce({ projectPath: '/p', title: 'T', prompt: 'P', notes: '' });
    expect(await api.handlers['POST /tasks/:id/issue/preview']({ params: { id: 'task' } }, {})).toEqual({ preview: { owner: 'o', repo: 'r' } });

    const generateReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /tasks/:id/issue/generate']({ body: { clientId: 'c' } }, generateReply);
    expect(generateReply.status).toHaveBeenCalledWith(400);
    expect(generateReply.send).toHaveBeenCalledWith({ error: 'Issue preview is required' });

    tasks.get.mockReturnValueOnce(null);
    const missingTaskReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /tasks/:id/issue']({ params: { id: 'missing' }, body: {} }, missingTaskReply);
    expect(missingTaskReply.status).toHaveBeenCalledWith(404);

    tasks.get.mockReturnValueOnce({ giteaIssue: { number: 1 } });
    const conflictReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /tasks/:id/issue']({ params: { id: 'task' }, body: {} }, conflictReply);
    expect(conflictReply.status).toHaveBeenCalledWith(409);
    expect(conflictReply.send).toHaveBeenCalledWith({ error: 'Task already has an issue' });

    tasks.get.mockReturnValueOnce({ giteaIssue: null });
    const result = await api.handlers['POST /tasks/:id/issue']({ params: { id: 'task' }, body: { provider: 'gitea', owner: 'o', repo: 'r', title: 'T', body: 'B' } }, {});
    expect(result.task.giteaIssue.number).toBe(2);
    expect(createIssue).toHaveBeenCalledWith({ provider: 'gitea', owner: 'o', repo: 'r', title: 'T', body: 'B' });
  });

  it('previews PR defaults, validates generation, and maps integration failures', async () => {
    const api = app();
    const git = { previewPr: vi.fn().mockResolvedValue({ targetBranch: 'main' }), createPr: vi.fn().mockRejectedValue('bad') };
    await gitHostingRoutes(api.app as any, routeOptions({ git }) as any);
    expect(await api.handlers['POST /pr/preview']({ body: {} }, {})).toEqual({ preview: { targetBranch: 'main' } });
    expect(git.previewPr).toHaveBeenCalledWith(expect.objectContaining({ cwd: '.', targetBranch: 'main' }));

    const generateReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /pr/generate']({ body: { clientId: 'c' } }, generateReply);
    expect(generateReply.status).toHaveBeenCalledWith(400);
    expect(generateReply.send).toHaveBeenCalledWith({ error: 'PR preview is required' });

    const createReply = { status: vi.fn().mockReturnThis(), send: vi.fn((value) => value) };
    await api.handlers['POST /pr/create']({ body: { preview: { cwd: '/p' }, title: '', body: '', commitMessage: '' } }, createReply);
    expect(createReply.status).toHaveBeenCalledWith(500);
    expect(createReply.send).toHaveBeenCalledWith({ error: 'Git integration request failed' });
  });

  it('does not duplicate an existing closing issue line', async () => {
    const api = app();
    const createPr = vi.fn().mockResolvedValue({ number: 3, url: 'https://git.example.com/owner/repo/pulls/3' });
    const settings = { get: vi.fn().mockReturnValue({ serverUrl: 'https://git.example.com', token: 'secret' }) };
    const tasks = { list: vi.fn().mockReturnValue([{ sessionId: 'session-1', giteaIssue: { number: 12 } }]) };
    await gitHostingRoutes(api.app as any, routeOptions({ settings, tasks, git: { createPr }, createClient: vi.fn() }) as any);

    await api.handlers['POST /pr/create']({
      body: { preview: {}, title: 'Add feature', body: 'AI generated body\n\nClose #12', commitMessage: 'Add feature', sessionId: 'session-1' },
    }, {});

    expect(createPr).toHaveBeenCalledWith(expect.objectContaining({ body: 'AI generated body\n\nClose #12' }));
  });
});
