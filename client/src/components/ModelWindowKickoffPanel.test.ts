import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import ModelWindowKickoffPanel from './ModelWindowKickoffPanel.vue';

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock('../services/apiClient', () => ({ apiRequest }));

const kickoff = {
  id: 'kickoff-1',
  enabled: true,
  profileId: 'default',
  provider: 'anthropic',
  modelId: 'claude',
  projectPath: '/project',
  prompt: 'Ping',
  windowDurationMinutes: 300,
  safetyBufferSeconds: 60,
  notificationChannelId: null,
  nextRunAt: '2026-03-20T12:00:00.000Z',
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
};

describe('ModelWindowKickoffPanel', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en';
    apiRequest.mockReset();
  });

  it('shows saving and saved feedback on the kickoff save button', async () => {
    let resolveSave!: (value: { kickoff: typeof kickoff }) => void;
    const pendingSave = new Promise<{ kickoff: typeof kickoff }>((resolve) => {
      resolveSave = resolve;
    });

    apiRequest.mockImplementation((url: string, options?: { method?: string }) => {
      if (url === '/api/sessions/agent-profiles') {
        return Promise.resolve({ profiles: [{ id: 'default' }] });
      }
      if (url === '/api/model-window-kickoffs') {
        return Promise.resolve({ kickoffs: [kickoff] });
      }
      if (url === '/api/model-window-kickoffs/notification-channels') {
        return Promise.resolve({ channels: [] });
      }
      if (url === '/api/sessions/project-path') {
        return Promise.resolve({ projectPath: '/project' });
      }
      if (url === '/api/sessions/agent-profiles/default/models') {
        return Promise.resolve({ models: [{ provider: 'anthropic', id: 'claude' }] });
      }
      if (url === '/api/model-window-kickoffs/kickoff-1' && options?.method === 'PUT') {
        return pendingSave;
      }
      throw new Error(`Unexpected API request: ${url}`);
    });

    const wrapper = mount(ModelWindowKickoffPanel);
    await flushPromises();

    const saveButton = wrapper.get('.save-button');
    expect(saveButton.text()).toBe('Save');

    await saveButton.trigger('click');
    expect(saveButton.text()).toBe('Saving…');

    resolveSave({ kickoff });
    await flushPromises();

    expect(saveButton.text()).toBe('Save');
    expect(wrapper.get('.save-success').text()).toBe('Saved');
    expect(wrapper.get('.save-success').attributes('role')).toBe('status');
  });
});
