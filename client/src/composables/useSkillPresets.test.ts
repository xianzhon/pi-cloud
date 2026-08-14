import { describe, expect, it, vi } from 'vitest';
import { useSkillPresets } from './useSkillPresets';

describe('useSkillPresets', () => {
  it('creates and refreshes skill presets', async () => {
    const fetchSpy = vi.fn(async (url: string, options?: RequestInit) => {
      if (!options || options.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            presets: [{ id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] }],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          preset: { id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { presets, loadPresets, createPreset } = useSkillPresets();
    await loadPresets();
    await createPreset({ name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] });

    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/skill-presets');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/skill-presets',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(presets.value.at(-1)).toEqual({ id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] });
  });
});
