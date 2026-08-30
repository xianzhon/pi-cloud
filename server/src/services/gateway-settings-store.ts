import type { PiCloudDatabase } from '../db/database';

export interface GatewaySettings {
  cwds: string[];
  defaultProfile: string;
  defaultSkillset: string;
  defaultModelProvider: string;
  defaultModelId: string;
}

const CWD_CHOICES_KEY = 'gateway.cwdChoices';
const DEFAULT_PROFILE_KEY = 'gateway.defaultProfile';
const DEFAULT_SKILLSET_KEY = 'gateway.defaultSkillset';
const DEFAULT_MODEL_PROVIDER_KEY = 'gateway.defaultModelProvider';
const DEFAULT_MODEL_ID_KEY = 'gateway.defaultModelId';
export class GatewaySettingsStore {
  constructor(private readonly db: PiCloudDatabase) {}

  get(): GatewaySettings {
    return {
      cwds: this.getConfiguredCwds(),
      defaultProfile: this.value(DEFAULT_PROFILE_KEY),
      defaultSkillset: this.value(DEFAULT_SKILLSET_KEY),
      defaultModelProvider: this.value(DEFAULT_MODEL_PROVIDER_KEY),
      defaultModelId: this.value(DEFAULT_MODEL_ID_KEY),
    };
  }

  save(input: { cwds?: unknown; defaultProfile?: unknown; defaultSkillset?: unknown; defaultModelProvider?: unknown; defaultModelId?: unknown }): GatewaySettings {
    if ('cwds' in input) {
      const cwds = normalizeCwdList(input.cwds);
      if (cwds.length) this.set(CWD_CHOICES_KEY, JSON.stringify(cwds));
      else this.delete(CWD_CHOICES_KEY);
    }

    if ('defaultProfile' in input) this.saveString(DEFAULT_PROFILE_KEY, input.defaultProfile);
    if ('defaultSkillset' in input) this.saveString(DEFAULT_SKILLSET_KEY, input.defaultSkillset);
    if ('defaultModelProvider' in input || 'defaultModelId' in input) {
      const provider = typeof input.defaultModelProvider === 'string' ? input.defaultModelProvider.trim() : '';
      const modelId = typeof input.defaultModelId === 'string' ? input.defaultModelId.trim() : '';
      if (provider && modelId) {
        this.set(DEFAULT_MODEL_PROVIDER_KEY, provider);
        this.set(DEFAULT_MODEL_ID_KEY, modelId);
      } else {
        this.delete(DEFAULT_MODEL_PROVIDER_KEY);
        this.delete(DEFAULT_MODEL_ID_KEY);
      }
    }
    return this.get();
  }

  private getConfiguredCwds(): string[] {
    const value = this.value(CWD_CHOICES_KEY);
    if (!value) return [];
    try {
      return normalizeCwdList(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }


  private saveString(key: string, value: unknown): void {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) this.set(key, trimmed);
    else this.delete(key);
  }

  private value(key: string): string {
    const row = this.db.prepare('SELECT value FROM security_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  }

  private set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO security_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  private delete(key: string): void {
    this.db.prepare('DELETE FROM security_settings WHERE key = ?').run(key);
  }
}

function normalizeCwdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)));
}
