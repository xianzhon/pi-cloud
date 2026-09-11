import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), ProxyAgent: vi.fn(function (this: any, options: unknown) { this.options = options; }) }));
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: mocks.ProxyAgent }));

import { fetchWithProxy } from './fetch-proxy.js';

describe('fetchWithProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('direct')));
    mocks.fetch.mockResolvedValue(new Response('proxy'));
  });

  it.each([
    ['not a url', { HTTPS_PROXY: 'http://proxy' }],
    ['http://localhost/path', { HTTP_PROXY: 'http://proxy' }],
    ['http://127.0.0.1/path', { HTTP_PROXY: 'http://proxy' }],
    ['http://[::1]/path', { HTTP_PROXY: 'http://proxy' }],
    ['https://api.example.com', { HTTPS_PROXY: 'http://proxy', NO_PROXY: '*' }],
    ['https://api.example.com', { HTTPS_PROXY: 'http://proxy', NO_PROXY: '.example.com' }],
    ['https://api.example.com', { HTTPS_PROXY: 'http://proxy', NO_PROXY: 'api.example.com' }],
  ])('uses direct fetch for %s with bypass environment', async (url, env) => {
    await fetchWithProxy(url, { method: 'GET' }, env);
    expect(fetch).toHaveBeenCalledWith(url, { method: 'GET' });
  });

  it('selects protocol, lowercase, and all-proxy settings and caches agents', async () => {
    await fetchWithProxy('http://example.com', { method: 'POST' }, { HTTP_PROXY: 'http://http-proxy' });
    await fetchWithProxy('http://other.com', {}, { HTTP_PROXY: 'http://http-proxy' });
    await fetchWithProxy('https://secure.test', {}, { https_proxy: 'http://https-proxy' });
    await fetchWithProxy('ftp://files.test', {}, { ALL_PROXY: 'socks://all-proxy' });
    expect(mocks.ProxyAgent).toHaveBeenCalledTimes(3);
    expect(mocks.ProxyAgent).toHaveBeenCalledWith({ uri: 'http://http-proxy' });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(mocks.fetch.mock.calls[0][1]).toHaveProperty('dispatcher');
  });

  it('uses direct fetch when no matching proxy exists', async () => {
    await fetchWithProxy('https://example.com', {}, { HTTP_PROXY: 'http://wrong-protocol' });
    expect(fetch).toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
