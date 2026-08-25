import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../services/apiClient';
import { useAuth, resetAuthForTests } from './useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    resetAuthForTests();
    vi.restoreAllMocks();
  });

  it('loads unauthenticated status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: false, user: null }) })));
    const auth = useAuth();
    await auth.refresh();
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.sessionExpiresAt.value).toBeNull();
  });

  it('logs in and stores 2FA challenge state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: false, requires2fa: true }) })));
    const auth = useAuth();
    await auth.login('me', 'secret');
    expect(auth.requires2fa.value).toBe(true);
  });

  it('stores session expiry after login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ authenticated: true, user: { username: 'me', totpEnabled: false }, sessionExpiresAt: '2026-08-08T12:00:00.000Z' }),
    })));
    const auth = useAuth();
    await auth.login('me', 'secret');
    expect(auth.sessionExpiresAt.value).toBe('2026-08-08T12:00:00.000Z');
  });

  it('clears authentication when an API request reports an expired session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, requires2fa: false, user: { username: 'me', totpEnabled: false } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Authentication required' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const auth = useAuth();
    await auth.login('me', 'secret');

    await expect(apiRequest('/api/tasks')).rejects.toThrow('Authentication required');

    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.sessionExpiresAt.value).toBeNull();
  });
});
