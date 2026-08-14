import { describe, expect, it, vi } from 'vitest';
import { useAvailableSkills } from './useAvailableSkills';

describe('useAvailableSkills', () => {
  it('loads available skills for the selected client profile', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skills: [{ name: 'brainstorming', description: 'Use before creative work' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const { skills, loadSkills } = useAvailableSkills();
    await loadSkills('client-1', '/repo/app');

    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/skills?clientId=client-1&projectPath=%2Frepo%2Fapp');
    expect(skills.value).toEqual([{ name: 'brainstorming', description: 'Use before creative work' }]);
  });
});
