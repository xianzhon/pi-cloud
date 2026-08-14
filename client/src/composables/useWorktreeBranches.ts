import { ref } from 'vue';
import { cachedLaunchResource, launchCacheKey } from './useLaunchResourceCache';

export function useWorktreeBranches() {
  const branches = ref<string[]>([]);
  const copyFiles = ref<string[]>([]);
  const loading = ref(false);
  const error = ref('');

  async function loadCopyFiles(clientId: string, projectPath: string): Promise<void> {
    if (!clientId || !projectPath) return;
    const params = new URLSearchParams({ clientId, projectPath });
    copyFiles.value = await cachedLaunchResource(
      launchCacheKey(['worktree-copy-files', clientId, projectPath]),
      async () => {
        const response = await fetch(`/api/sessions/worktree-copy-files?${params.toString()}`);
        if (response.ok === false) throw new Error('Failed to load copy files');
        const data = await response.json();
        return Array.isArray(data.files) ? data.files : [];
      },
    ).catch(() => []);
  }

  async function loadBranches(clientId: string, projectPath: string): Promise<void> {
    if (!clientId || !projectPath) return;
    loading.value = true;
    error.value = '';
    try {
      const params = new URLSearchParams({ clientId, projectPath });
      const response = await fetch(`/api/sessions/worktree-branches?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load branches');

      const data = await response.json();
      branches.value = Array.isArray(data.branches) ? data.branches : [];
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to load branches';
      branches.value = [];
    } finally {
      loading.value = false;
    }
  }

  function resetBranches(): void {
    branches.value = [];
    error.value = '';
  }

  return { branches, copyFiles, loading, error, loadBranches, loadCopyFiles, resetBranches };
}
