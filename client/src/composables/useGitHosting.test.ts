import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitHosting } from './useGitHosting';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ settings: { serverUrl: 'https://git.example.com', tokenConfigured: true } }), { status: 200 })));
});

describe('useGitHosting', () => {
  it('loads sanitized settings', async () => {
    const gitHosting = useGitHosting();
    await gitHosting.loadSettings();
    expect(fetch).toHaveBeenCalledWith('/api/git-hosting/settings', { method: 'GET' });
    expect(gitHosting.settings.value).toEqual({ serverUrl: 'https://git.example.com', tokenConfigured: true });
  });
});
