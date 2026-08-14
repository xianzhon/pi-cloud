import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GiteaClient } from './gitea-client';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('GiteaClient', () => {
  it('sends personal access token auth when testing connection', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ login: 'ross' }), { status: 200 }));
    await new GiteaClient({ serverUrl: 'https://git.example.com', token: 'abc' }).testConnection();

    expect(fetchMock).toHaveBeenCalledWith('https://git.example.com/api/v1/user', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'token abc' }),
    }));
  });

  it('creates issues and uses the configured port in issue links', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ number: 7, html_url: 'https://git.example.com/o/r/issues/7' }), { status: 201 }));
    const result = await new GiteaClient({ serverUrl: 'https://git.example.com:6', token: 'abc' }).createIssue({ owner: 'o', repo: 'r', title: 'T', body: 'B' });

    expect(result).toEqual({ number: 7, url: 'https://git.example.com:6/o/r/issues/7' });
  });

  it('uses the configured port in pull request links', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ number: 79, html_url: 'https://git.example.com/o/r/pulls/79' }), { status: 201 }));
    const result = await new GiteaClient({ serverUrl: 'https://git.example.com:6', token: 'abc' }).createPullRequest({ owner: 'o', repo: 'r', title: 'T', body: 'B', head: 'feature', base: 'main' });

    expect(result).toEqual({ number: 79, url: 'https://git.example.com:6/o/r/pulls/79' });
  });
});
