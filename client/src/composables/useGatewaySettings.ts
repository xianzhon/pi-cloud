import { ref } from 'vue';
import { apiRequest } from '../services/apiClient';

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

interface GatewaySettingsResponse {
  settings: GatewaySettings;
}

export function useGatewaySettings() {
  async function loadSettings(signal?: AbortSignal): Promise<void> {
    settings.value = (await apiRequest<GatewaySettingsResponse>('/api/gateways/settings', {
      signal,
      fallbackMessage: 'Gateway settings request failed',
    })).settings;
  }

  async function saveSettings(input: GatewaySettingsInput, signal?: AbortSignal): Promise<void> {
    settings.value = (await apiRequest<GatewaySettingsResponse, GatewaySettingsInput>('/api/gateways/settings', {
      method: 'POST',
      body: input,
      signal,
      fallbackMessage: 'Gateway settings request failed',
    })).settings;
  }

  return { settings, loadSettings, saveSettings };
}
