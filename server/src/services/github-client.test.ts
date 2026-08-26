import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithProxy } from '../utils/fetch-proxy.js';
import { GithubClient } from './github-client';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file: string, _args: readonly string[] | null | undefined, _options: unknown, callback: Function) => callback(null, '', '')),
}));
vi.mock('../utils/fetch-proxy.js', () => ({ fetchWithProxy: vi.fn() }));

const fetchMock = vi.mocked(fetchWithProxy);
const execFileMock = vi.mocked(execFile);

beforeEach(() => {
  fetchMock.mockReset();
  execFileMock.mockReset();
  execFileMock.mockImplementation(((_file: string, _args: readonly string[] | null | undefined, _options: unknown, callback: Function) => callback(null, '', '')) as any);
});

describe('GithubClient', () => {
  it('sends bearer token auth when testing connection', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ login: 'ross' }), { status: 200 }));
    await new GithubClient({ serverUrl: 'https://github.com', token: 'abc' }).testConnection();

    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer abc' }),
    }), expect.any(Object));
  });

  it('creates issues and returns number/url', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }), { status: 201 }));
    const result = await new GithubClient({ serverUrl: 'https://github.com', token: 'abc' }).createIssue({ owner: 'o', repo: 'r', title: 'T', body: 'B' });

    expect(result).toEqual({ number: 7, url: 'https://github.com/o/r/issues/7' });
  });

  it('preserves GitHub error status codes', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 }));

    await expect(new GithubClient({ serverUrl: 'https://github.com', token: 'abc' }).createIssue({ owner: 'o', repo: 'r', title: 'T', body: 'B' }))
      .rejects.toMatchObject({ message: 'Resource not accessible by personal access token', statusCode: 403 });
  });

  it('falls back to curl when fetch fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    execFileMock.mockImplementation(((_file: string, _args: readonly string[] | null | undefined, _options: unknown, callback: Function) => {
      callback(null, JSON.stringify({ number: 8, html_url: 'https://github.com/o/r/issues/8' }) + '\n201', '');
    }) as any);

    const result = await new GithubClient({ serverUrl: 'https://github.com', token: 'abc', proxyUrl: 'http://proxy.example' })
      .createIssue({ owner: 'o', repo: 'r', title: 'T', body: 'B' });

    expect(result).toEqual({ number: 8, url: 'https://github.com/o/r/issues/8' });
    expect(execFileMock).toHaveBeenCalledWith('curl', expect.any(Array), expect.objectContaining({ env: expect.objectContaining({ HTTPS_PROXY: 'http://proxy.example' }) }), expect.any(Function));
  });
});
