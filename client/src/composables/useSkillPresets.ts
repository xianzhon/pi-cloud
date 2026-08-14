import { ref } from 'vue';
import { cachedLaunchResource, invalidateLaunchResourceCache } from './useLaunchResourceCache';

export type SkillPresetMode = 'enabled' | 'disabled';

export interface SkillPreset {
  id: string;
  name: string;
  mode: SkillPresetMode;
  skills: string[];
}

export interface SkillPresetInput {
  name: string;
  mode: SkillPresetMode;
  skills: string[];
}

export function useSkillPresets() {
  const presets = ref<SkillPreset[]>([]);

  async function loadPresets(): Promise<void> {
    presets.value = await cachedLaunchResource('skill-presets', async () => {
      const response = await fetch('/api/auth/skill-presets');
      const data = await response.json();
      return Array.isArray(data.presets) ? data.presets : [];
    });
  }

  async function createPreset(payload: SkillPresetInput): Promise<SkillPreset> {
    const response = await fetch('/api/auth/skill-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    invalidateLaunchResourceCache('skill-presets');
    await loadPresets();
    return data.preset as SkillPreset;
  }

  async function updatePreset(id: string, payload: SkillPresetInput): Promise<SkillPreset> {
    const response = await fetch(`/api/auth/skill-presets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    invalidateLaunchResourceCache('skill-presets');
    await loadPresets();
    return data.preset as SkillPreset;
  }

  async function deletePreset(id: string): Promise<void> {
    await fetch(`/api/auth/skill-presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    invalidateLaunchResourceCache('skill-presets');
    await loadPresets();
  }

  return { presets, loadPresets, createPreset, updatePreset, deletePreset };
}
