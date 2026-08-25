import { ref } from 'vue';
import { apiRequest, getApiErrorMessage } from '../services/apiClient';
import type {
  ProjectTask,
  ProjectTaskDraft,
  ProjectTaskStartResult,
  ProjectTaskVisibleStatus,
} from '../types/projectTask';

export function useProjectTasks(clientId: string) {
  const tasks = ref<ProjectTask[]>([]);
  const scope = ref<'project' | 'all'>('project');
  const status = ref<ProjectTaskVisibleStatus>('waiting');
  const loading = ref(false);
  const error = ref('');
  const startingTaskId = ref<string | null>(null);
  let lastProjectPath = '';

  async function load(projectPath = lastProjectPath): Promise<void> {
    lastProjectPath = projectPath;
    loading.value = true;
    error.value = '';
    try {
      const params = new URLSearchParams({ scope: scope.value, status: status.value });
      if (scope.value === 'project' && projectPath) params.set('projectPath', projectPath);
      const data = await apiRequest<{ tasks?: ProjectTask[] }>(`/api/tasks?${params.toString()}`, {
        fallbackMessage: 'Task request failed',
      });
      tasks.value = data.tasks || [];
    } catch (exception) {
      error.value = errorMessage(exception);
      tasks.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function create(draft: ProjectTaskDraft): Promise<ProjectTask> {
    const data = await mutate<{ task: ProjectTask }>('/api/tasks', 'POST', draft);
    return data.task;
  }

  async function update(id: string, draft: ProjectTaskDraft): Promise<ProjectTask> {
    const data = await mutate<{ task: ProjectTask }>(`/api/tasks/${encodeURIComponent(id)}`, 'PUT', draft);
    return data.task;
  }

  async function remove(id: string): Promise<void> {
    await mutate(`/api/tasks/${encodeURIComponent(id)}`, 'DELETE');
  }

  async function complete(id: string): Promise<ProjectTask> {
    const data = await mutate<{ task: ProjectTask }>(`/api/tasks/${encodeURIComponent(id)}/complete`, 'POST');
    return data.task;
  }

  async function start(id: string): Promise<ProjectTaskStartResult> {
    startingTaskId.value = id;
    error.value = '';
    try {
      const result = await apiRequest<ProjectTaskStartResult, { clientId: string }>(`/api/tasks/${encodeURIComponent(id)}/start`, {
        method: 'POST',
        body: { clientId },
        fallbackMessage: 'Task request failed',
      });
      notifyChanged();
      await load(lastProjectPath);
      return result;
    } catch (exception) {
      error.value = errorMessage(exception);
      throw exception;
    } finally {
      startingTaskId.value = null;
    }
  }

  async function mutate<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
    error.value = '';
    try {
      const data = await apiRequest<T, unknown>(url, {
        method,
        body,
        fallbackMessage: 'Task request failed',
      });
      notifyChanged();
      await load(lastProjectPath);
      return data;
    } catch (exception) {
      error.value = errorMessage(exception);
      throw exception;
    }
  }

  function notifyChanged() {
    window.dispatchEvent(new Event('refresh-tasks'));
  }

  return {
    tasks,
    scope,
    status,
    loading,
    error,
    startingTaskId,
    load,
    create,
    update,
    remove,
    start,
    complete,
  };
}

function errorMessage(error: unknown): string {
  return getApiErrorMessage(error, 'Task request failed');
}
