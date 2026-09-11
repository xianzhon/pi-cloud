import { describe, expect, it } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { GithubSettingsStore, githubProxyEnvFromUrl } from './github-settings-store.js';

describe('GithubSettingsStore', () => {
  it('saves, sanitizes, proxies, and clears settings', () => {
    const db = openPiCloudDatabase(':memory:');
    const store = new GithubSettingsStore(db);
    expect(store.get()).toEqual({ serverUrl: 'https://github.com', token: '', proxyUrl: '' });
    expect(store.getSanitized()).toEqual({ serverUrl: 'https://github.com', tokenConfigured: false, proxyUrl: '' });
    store.save({ serverUrl: 'https://github.example.com/', token: ' secret ' });
    store.saveProxyUrl(' http://proxy.example:8080 ');
    expect(store.getSanitized()).toEqual({ serverUrl: 'https://github.example.com', tokenConfigured: true, proxyUrl: 'http://proxy.example:8080' });
    expect(store.proxyEnv()).toEqual(githubProxyEnvFromUrl('http://proxy.example:8080'));
    store.saveProxyUrl('');
    expect(store.proxyEnv()).toEqual({});
    store.clear();
    expect(store.get()).toMatchObject({ serverUrl: 'https://github.com', token: '' });
    db.close();
  });

  it('validates credentials and proxy URLs', () => {
    const db = openPiCloudDatabase(':memory:');
    const store = new GithubSettingsStore(db);
    expect(() => store.save({ serverUrl: '', token: '' })).toThrow('token is required');
    expect(() => store.saveProxyUrl('not a url')).toThrow();
    db.close();
  });
});
