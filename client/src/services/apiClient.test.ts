import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, getApiErrorMessage, onSessionExpired } from './apiClient';

describe('apiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses typed JSON responses and serializes request bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'task-1' }),
    })));

    const result = await apiRequest<{ id: string }, { title: string }>('/api/tasks', {
      method: 'POST',
      body: { title: 'Review changes' },
    });

    expect(result.id).toBe('task-1');
    expect(fetch).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Review changes' }),
    });
  });

  it('extracts server errors into a structured ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid task' }),
    })));

    const request = apiRequest('/api/tasks');
    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Invalid task',
      status: 400,
      payload: { error: 'Invalid task' },
    });
  });

  it('uses a consistent fallback when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError('invalid JSON'); },
    })));

    await expect(apiRequest('/api/tasks', { fallbackMessage: 'Could not load tasks' }))
      .rejects.toThrow('Could not load tasks');
  });

  it('notifies session expiration on 401 unless disabled', async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Authentication required' }),
    })));

    await expect(apiRequest('/api/tasks')).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest('/api/auth/login', { handleUnauthorized: false })).rejects.toBeInstanceOf(ApiError);

    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('passes AbortSignal to fetch', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

    await apiRequest('/api/tasks', { signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith('/api/tasks', { signal: controller.signal });
  });

  it('extracts user-facing messages from unknown errors', () => {
    expect(getApiErrorMessage(new Error('Server unavailable'), 'Fallback')).toBe('Server unavailable');
    expect(getApiErrorMessage({}, 'Fallback')).toBe('Fallback');
  });
});
