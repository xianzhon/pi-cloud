import type { PiuiDatabase } from '../db/database';
import { normalizeServerUrl } from './gitea-settings-store';

export interface GithubSettings {
  serverUrl: string;
  token: string;
  proxyUrl?: string;
}

export interface SanitizedGithubSettings {
  serverUrl: string;
  tokenConfigured: boolean;
  proxyUrl: string;
}

const SERVER_URL_KEY = 'github.serverUrl';
const TOKEN_KEY = 'github.token';
const PROXY_URL_KEY = 'github.proxyUrl';
const DEFAULT_SERVER_URL = 'https://github.com';

export class GithubSettingsStore {
  constructor(private readonly db: PiuiDatabase) {}

  get(): GithubSettings {
    return {
      serverUrl: this.value(SERVER_URL_KEY) || DEFAULT_SERVER_URL,
      token: this.value(TOKEN_KEY) || '',
      proxyUrl: this.value(PROXY_URL_KEY) || '',
    };
  }

  getSanitized(): SanitizedGithubSettings {
    const settings = this.get();
    return {
      serverUrl: settings.serverUrl,
      tokenConfigured: Boolean(settings.token),
      proxyUrl: settings.proxyUrl || '',
    };
  }

  save(input: Pick<GithubSettings, 'serverUrl' | 'token'>): GithubSettings {
    const serverUrl = normalizeServerUrl(input.serverUrl || DEFAULT_SERVER_URL);
    const token = input.token.trim();
    if (!serverUrl) throw new Error('GitHub server URL is required');
    if (!token) throw new Error('GitHub token is required');
    this.set(SERVER_URL_KEY, serverUrl);
    this.set(TOKEN_KEY, token);
    return this.get();
  }

  saveProxyUrl(proxyUrl: string): GithubSettings {
    const value = proxyUrl.trim();
    if (value) new URL(value);
    if (value) this.set(PROXY_URL_KEY, value);
    else this.db.prepare('DELETE FROM security_settings WHERE key = ?').run(PROXY_URL_KEY);
    return this.get();
  }

  proxyEnv(): Record<string, string> {
    const proxyUrl = this.get().proxyUrl;
    return proxyUrl ? githubProxyEnvFromUrl(proxyUrl) : {};
  }

  clear(): void {
    this.db.prepare('DELETE FROM security_settings WHERE key IN (?, ?)').run(SERVER_URL_KEY, TOKEN_KEY);
  }

  private value(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM security_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO security_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }
}

export function githubProxyEnvFromUrl(proxyUrl: string): Record<string, string> {
  return {
    ALL_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    all_proxy: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
  };
}
