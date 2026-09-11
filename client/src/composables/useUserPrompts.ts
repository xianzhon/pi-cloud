import { ref } from 'vue';
import { apiRequest } from '../services/apiClient';

export interface UserPrompt {
  id: string;
  name: string;
  content: string;
}

export interface UserPromptInput {
  name: string;
  content: string;
}

const prompts = ref<UserPrompt[]>([]);

export function useUserPrompts() {
  async function loadPrompts(): Promise<void> {
    prompts.value = (await apiRequest<{ prompts: UserPrompt[] }>('/api/auth/user-prompts')).prompts;
  }

  async function createPrompt(input: UserPromptInput): Promise<void> {
    await apiRequest('/api/auth/user-prompts', { method: 'POST', body: input });
    await loadPrompts();
  }

  async function updatePrompt(id: string, input: UserPromptInput): Promise<void> {
    await apiRequest(`/api/auth/user-prompts/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
    await loadPrompts();
  }

  async function deletePrompt(id: string): Promise<void> {
    await apiRequest(`/api/auth/user-prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadPrompts();
  }

  return { prompts, loadPrompts, createPrompt, updatePrompt, deletePrompt };
}
