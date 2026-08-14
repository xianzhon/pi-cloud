import { ref } from 'vue';
import { cachedLaunchResource, launchCacheKey } from './useLaunchResourceCache';

export interface AvailableSkill {
  name: string;
  description: string;
  path?: string;
}

export function useAvailableSkills() {
  const skills = ref<AvailableSkill[]>([]);
  const loading = ref(false);

  async function loadSkills(clientId: string, projectPath?: string): Promise<void> {
    loading.value = true;
    try {
      skills.value = await cachedLaunchResource(
        launchCacheKey(['skills', clientId, projectPath || '']),
        async () => {
          const params = new URLSearchParams({ clientId });
          if (projectPath) params.set('projectPath', projectPath);
          const response = await fetch(`/api/sessions/skills?${params.toString()}`);
          const data = await response.json();
          return Array.isArray(data.skills) ? data.skills : [];
        },
      );
    } finally {
      loading.value = false;
    }
  }

  return { skills, loading, loadSkills };
}
