import type { PiuiDatabase } from '../db/database';

export interface GiteaSettings {
  serverUrl: string;
  token: string;
}

export interface SanitizedGiteaSettings {
  serverUrl: string;
  tokenConfigured: boolean;
}

const SERVER_URL_KEY = 'gitea.serverUrl';
const TOKEN_KEY = 'gitea.token';

export class GiteaSettingsStore {
  constructor(private readonly db: PiuiDatabase) {}

  get(): GiteaSettings {
    return {
      serverUrl: this.value(SERVER_URL_KEY) || '',
      token: this.value(TOKEN_KEY) || '',
    };
  }

  getSanitized(): SanitizedGiteaSettings {
    const settings = this.get();
    return {
      serverUrl: settings.serverUrl,
      tokenConfigured: Boolean(settings.token),
    };
  }

  save(input: GiteaSettings): GiteaSettings {
    const serverUrl = normalizeServerUrl(input.serverUrl);
    const token = input.token.trim();
    if (!serverUrl) throw new Error('Gitea server URL is required');
    if (!token) throw new Error('Gitea token is required');
    this.set(SERVER_URL_KEY, serverUrl);
    this.set(TOKEN_KEY, token);
    return this.get();
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

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Gitea server URL must start with http:// or https://');
  return parsed.toString().replace(/\/+$/, '');
}
