import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileManagerDialog from './ProfileManagerDialog.vue';

const profiles = [
  { id: 'default', path: '/Users/test/.pi/agent', isDefault: true, label: 'default' },
  { id: 'work', path: '/Users/test/.pi/work', isDefault: false, label: 'work' },
];

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('ProfileManagerDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/proxy')) return ok({ proxy: {} });
      if (url.endsWith('/api-key-providers')) {
        return ok({ providers: [
          { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', configured: false },
          { envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', configured: true, source: 'stored' },
        ] });
      }
      if (url.endsWith('/api-key') && options?.method === 'PUT') {
        return ok({ providers: [
          { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', configured: true, source: 'stored' },
          { envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', configured: true, source: 'stored' },
        ] });
      }
      if (url.endsWith('/models')) {
        return ok({ models: [
          { provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku', current: true },
          { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
        ] });
      }
      if (url.endsWith('/automation-model') && options?.method !== 'PUT') {
        return ok({ model: { provider: 'openai', modelId: 'gpt-5' } });
      }
      if (url.endsWith('/auto-rename') && options?.method === 'PUT') {
        return ok({ config: { provider: 'openai', modelId: 'gpt-5', language: 'chinese', externalPluginInstalled: false } });
      }
      if (url.endsWith('/auto-rename')) {
        return ok({ config: { provider: 'openai', modelId: 'gpt-5', language: 'chinese', externalPluginInstalled: true } });
      }
      return ok({});
    }));
  });

  it('emits close from the dialog close button', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: true, profiles, selectedId: 'default' },
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('.settings-close').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('selects a configured API key provider by default', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });

    await vi.waitFor(() => expect(wrapper.find('[aria-label="API provider key"]').text()).toContain('OPENAI_API_KEY'));
  });

  it('saves an API key without displaying it again', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });

    await vi.waitFor(() => expect(wrapper.find('[aria-label="API provider key"]').text()).toContain('OPENAI_API_KEY'));
    await wrapper.find('[aria-label="API provider key"]').trigger('click');
    await wrapper.findAll('.custom-select-option').find((option) => option.text().includes('ANTHROPIC_API_KEY'))!.trigger('click');

    const keyInput = wrapper.find('input[type="password"]');
    await keyInput.setValue('secret-key');
    await wrapper.findAll('button').find((button) => button.text() === 'Save API key')!.trigger('click');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/api-key',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ envVar: 'ANTHROPIC_API_KEY', apiKey: 'secret-key' }),
      }),
    ));
    await vi.waitFor(() => expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe(''));
    expect(wrapper.text()).not.toContain('secret-key');
  });

  it('loads and saves all profile settings with one action', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });

    await vi.waitFor(() => expect(wrapper.text()).toContain('External pi-auto-rename plugin detected'));

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save settings')!;
    await saveButton.trigger('click');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/auto-rename',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ language: 'chinese' }),
      }),
    ));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/default-model',
      expect.objectContaining({ method: 'PUT' }),
    ));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/automation-model',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', modelId: 'gpt-5' }),
      }),
    ));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/proxy',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ proxy: { ALL_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '' } }),
      }),
    ));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Settings saved.'));
  });
});
