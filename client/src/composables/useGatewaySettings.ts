import { ref } from 'vue';

export interface GatewaySettings {
  cwds: string[];
  defaultProfile: string;
  defaultSkillset: string;
  defaultModelProvider: string;
  defaultModelId: string;
}

export interface GatewaySettingsInput {
  cwds: string[];
  defaultProfile: string;
  defaultSkillset: string;
  defaultModelProvider: string;
  defaultModelId: string;
}

const settings = ref<GatewaySettings>({
  cwds: [],
  defaultProfile: '',
  defaultSkillset: '',
  defaultModelProvider: '',
  defaultModelId: '',
});

export function useGatewaySettings() {
  async function loadSettings(): Promise<void> {
    settings.value = (await request<{ settings: GatewaySettings }>('/api/gateways/settings')).settings;
  }

  async function saveSettings(input: GatewaySettingsInput): Promise<void> {
    settings.value = (await request<{ settings: GatewaySettings }>('/api/gateways/settings', 'POST', input)).settings;
  }

  return { settings, loadSettings, saveSettings };
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Gateway settings request failed (${response.status})`);
  return data as T;
}
