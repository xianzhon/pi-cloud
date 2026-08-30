import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createStorageStub(initialEntries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialEntries));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

async function importClientId() {
  vi.resetModules();
  return import('./tabClientId');
}

describe('getTabClientId', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the same client id across a refresh of the same tab', async () => {
    const localStorage = createStorageStub();
    const sessionStorage = createStorageStub();
    const randomUUID = vi.fn()
      .mockReturnValueOnce('owner-1')
      .mockReturnValueOnce('client-1')
      .mockReturnValueOnce('owner-2');

    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('crypto', { randomUUID });

    const firstModule = await importClientId();
    expect(firstModule.getTabClientId()).toBe('client-1');

    window.dispatchEvent(new Event('pagehide'));

    const secondModule = await importClientId();
    expect(secondModule.getTabClientId()).toBe('client-1');
  });

  it('regenerates the client id when a duplicated tab copies a live tab id', async () => {
    const existingOwner = JSON.stringify({ token: 'other-tab', updatedAt: Date.now() });
    const localStorage = createStorageStub({ 'pi-cloud-client-owner:client-1': existingOwner });
    const sessionStorage = createStorageStub({ 'pi-cloud-client-id': 'client-1' });
    const randomUUID = vi.fn()
      .mockReturnValueOnce('owner-duplicate')
      .mockReturnValueOnce('client-2');

    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('crypto', { randomUUID });

    const { getTabClientId } = await importClientId();

    expect(getTabClientId()).toBe('client-2');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('pi-cloud-client-id', 'client-2');
  });
});
