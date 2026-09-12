import { describe, expect, it } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { GiteaSettingsStore } from './gitea-settings-store';

function db() {
  return openPiCloudDatabase(':memory:');
}

describe('GiteaSettingsStore', () => {
  it('saves settings and never exposes the token in sanitized output', () => {
    const database = db();
    const store = new GiteaSettingsStore(database);
    store.save({ serverUrl: 'https://git.example.com/', token: 'secret-token' });

    const stored = database.prepare("SELECT value FROM application_settings WHERE key = 'gitea.token'").get() as { value: string };
    expect(stored.value).toMatch(/^enc:v1:/);
    expect(stored.value).not.toContain('secret-token');
    expect(store.get()).toEqual({ serverUrl: 'https://git.example.com', token: 'secret-token' });
    expect(store.getSanitized()).toEqual({ serverUrl: 'https://git.example.com', tokenConfigured: true });
  });

  it('clears settings', () => {
    const store = new GiteaSettingsStore(db());
    store.save({ serverUrl: 'https://git.example.com', token: 'secret-token' });
    store.clear();

    expect(store.get()).toEqual({ serverUrl: '', token: '' });
    expect(store.getSanitized()).toEqual({ serverUrl: '', tokenConfigured: false });
  });
});
