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
  execFileMock.mockClear();
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
    await gitHostingRoutes(api.app as any, routeOptions({}) as any);

    try {
      const result = await api.handlers['POST /github/proxy/test']({ body: { proxyUrl: '' } }, {});

      expect(result).toEqual({ ok: true });
      expect(execFileMock).toHaveBeenCalledWith('curl', expect.any(Array), expect.objectContaining({ timeout: 12_000 }), expect.any(Function));
      const options = execFileMock.mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
      expect(options.env.HTTP_PROXY).toBeUndefined();
    } finally {
      if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = originalHttpProxy;
    }
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
