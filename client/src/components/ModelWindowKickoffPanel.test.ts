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

  it('adds, edits, removes, and configures kickoff notifications', async () => {
    const channel = { id: 'wecom', name: 'Alerts', configured: true };
    const added = { ...kickoff, id: 'kickoff-2', notificationChannelId: 'wecom' };
    apiRequest.mockImplementation((url: string, options?: { method?: string; body?: any }) => {
      if (url === '/api/sessions/agent-profiles') return Promise.resolve({ profiles: [{ id: 'default', label: 'Default', defaultProvider: 'anthropic', defaultModel: 'claude' }] });
      if (url === '/api/model-window-kickoffs' && !options) return Promise.resolve({ kickoffs: [kickoff] });
      if (url === '/api/model-window-kickoffs/notification-channels' && !options) return Promise.resolve({ channels: [channel] });
      if (url === '/api/sessions/project-path') return Promise.resolve({ projectPath: '/project' });
      if (url.includes('/models')) return Promise.resolve({ models: [{ provider: 'anthropic', id: 'claude', name: 'Claude' }] });
      if (url === '/api/model-window-kickoffs' && options?.method === 'POST') return Promise.resolve({ kickoff: added });
      if (url === '/api/model-window-kickoffs/kickoff-2' && options?.method === 'DELETE') return Promise.resolve({});
      if (url === '/api/model-window-kickoffs/notification-channels/wecom' && options?.method === 'DELETE') return Promise.resolve({});
      if (url === '/api/model-window-kickoffs/notification-channels/wecom') return Promise.resolve({ channel });
      throw new Error(`Unexpected API request: ${url}`);
    });
    const wrapper = mount(ModelWindowKickoffPanel, { props: { clientId: 'c1' } });
    await flushPromises();
    const vm = wrapper.vm as any;
    expect(vm.profileOptions).toEqual([{ value: 'default', label: 'Default' }]);
    expect(vm.notificationOptions).toHaveLength(2);
    expect(vm.modelOptions('default')[0].label).toBe('Claude [anthropic]');
    await vm.add();
    expect(vm.kickoffs).toHaveLength(2);
    vm.setProfile(vm.kickoffs[0], 'default');
    vm.setModel(vm.kickoffs[0], 'anthropic\nclaude');
    vm.setNotificationChannel(vm.kickoffs[0], '');
    vm.openProjectPicker(vm.kickoffs[0]);
    vm.selectProjectPath({ path: '/other' });
    expect(vm.kickoffs[0].projectPath).toBe('/other');
    await vm.remove('kickoff-2');
    await vm.saveChannel();
    await vm.deleteChannel();
    expect(apiRequest).toHaveBeenCalledWith('/api/model-window-kickoffs/notification-channels/wecom', { method: 'DELETE' });
    expect(vm.channel).toBeUndefined();
  });

  it('reports load and action failures and handles missing models', async () => {
    apiRequest.mockRejectedValue(new Error('load failed'));
    const wrapper = mount(ModelWindowKickoffPanel);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('load failed');
    const vm = wrapper.vm as any;
    await vm.add();
    vm.profiles = [{ id: 'empty' }];
    vm.models = { empty: [] };
    await vm.add();
    expect(vm.error).toContain('no available models');
    vm.kickoffs = [{ ...kickoff, windowHours: 5, nextRunLocal: '2026-03-20T12:00' }];
    await vm.save(vm.kickoffs[0]);
    expect(vm.error).toBe('load failed');
    await vm.remove('missing');
    expect(vm.formatTime(null)).toBe('—');
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
