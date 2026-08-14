import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { GiteaSettingsStore } from './gitea-settings-store';

function db() {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE security_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  return database;
}

describe('GiteaSettingsStore', () => {
  it('saves settings and never exposes the token in sanitized output', () => {
    const store = new GiteaSettingsStore(db());
    store.save({ serverUrl: 'https://git.example.com/', token: 'secret-token' });

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
