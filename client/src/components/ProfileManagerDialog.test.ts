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
      if (url.endsWith('/proxy/check')) return ok({ ok: true, country: 'US' });
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
      if (url.includes('/api-key/') && options?.method === 'DELETE') {
        return ok({ providers: [
          { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', configured: false },
          { envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', configured: false },
        ] });
      }
      if (url.endsWith('/local-llm/discover')) return ok({ models: [{ id: 'qwen3:8b' }] });
      if (url.endsWith('/local-llm') && options?.method === 'PUT') {
        return ok({ config: { baseUrl: 'http://127.0.0.1:11434/v1', modelIds: ['qwen3:8b'] } });
      }
      if (url.endsWith('/local-llm') && options?.method === 'DELETE') return ok({ config: { baseUrl: '', modelIds: [] } });
      if (url.endsWith('/local-llm')) return ok({ config: { baseUrl: '', modelIds: [] } });
      if (url.endsWith('/custom-providers/discover')) {
        const body = JSON.parse(String(options?.body || '{}'));
        return body.providerType === 'cloudflare-workers-ai'
          ? ok({ models: [
              { id: '@cf/meta/llama-3.2-3b-instruct', supportsImages: false },
              { id: '@cf/meta/llama-3.2-11b-vision-instruct', supportsImages: true },
            ] })
          : ok({ models: [{ id: 'agnes-2.5-flash', supportsImages: true }] });
      }
      if (url.endsWith('/custom-providers/cloudflare-workers-ai') && options?.method === 'PUT') {
        return ok({ provider: {
          id: 'cloudflare-workers-ai',
          baseUrl: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1',
          modelIds: ['@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.2-11b-vision-instruct'],
          imageModelIds: ['@cf/meta/llama-3.2-11b-vision-instruct'],
          configured: true,
        } });
      }
      if (url.endsWith('/custom-providers/agnes') && options?.method === 'PUT') {
        return ok({ provider: { id: 'agnes', baseUrl: 'https://api.agnes.test/v1', modelIds: ['agnes-2.5-flash'], imageModelIds: ['agnes-2.5-flash'], configured: true } });
      }
      if (url.endsWith('/custom-providers/agnes') && options?.method === 'DELETE') return ok({ id: 'agnes' });
      if (url.endsWith('/custom-providers')) return ok({ providers: [] });
      if (url.endsWith('/models')) {
        return ok({ models: [
          { provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku', current: true },
          { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
        ] });
      }
      if (url.endsWith('/automation-model') && options?.method !== 'PUT') {
        return ok({ model: { provider: 'openai', modelId: 'gpt-5' } });
      }
      if (url.endsWith('/auto-rename')) {
        return ok({ config: { provider: 'openai', modelId: 'gpt-5', language: 'chinese' } });
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

  it('collapses provider setup sections by default', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'default' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });

    await vi.waitFor(() => expect(wrapper.findAll('.profile-collapsible')).toHaveLength(3));
    const sections = wrapper.findAll('details.profile-collapsible');
    expect(sections.every((section) => !(section.element as HTMLDetailsElement).open)).toBe(true);

    await sections[0].find('summary').trigger('click');
    expect((sections[0].element as HTMLDetailsElement).open).toBe(true);
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

  it('removes a stored API key', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });

    await vi.waitFor(() => expect(wrapper.findAll('button').some((button) => button.text() === 'Remove saved key')).toBe(true));
    await wrapper.findAll('button').find((button) => button.text() === 'Remove saved key')!.trigger('click');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/api-key/OPENAI_API_KEY',
      { method: 'DELETE' },
    ));
    expect(wrapper.text()).toContain('Saved API key removed.');
  });

  it('discovers, saves, and removes a local LLM without asking for authentication', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Automation model"]').text()).toContain('GPT-5'));

    await wrapper.findAll('button').find((button) => button.text() === 'Connect & discover models')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('qwen3:8b'));
    await wrapper.findAll('button').find((button) => button.text() === 'Save local LLM')!.trigger('click');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/local-llm',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ baseUrl: 'http://127.0.0.1:11434/v1', modelIds: ['qwen3:8b'] }),
      }),
    ));
    expect(wrapper.text()).toContain('Local LLM saved.');

    await wrapper.findAll('button').find((button) => button.text() === 'Remove local LLM')!.trigger('click');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/local-llm',
      { method: 'DELETE' },
    ));
    expect(wrapper.text()).toContain('Local LLM removed.');
  });

  it('discovers and securely saves a custom API provider', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Provider ID"]').exists()).toBe(true));

    await wrapper.find('[aria-label="Provider ID"]').setValue('agnes');
    await wrapper.find('[aria-label="Custom provider URL"]').setValue('https://api.agnes.test/v1');
    await wrapper.find('[aria-label="Custom provider API key"]').setValue('agnes-secret');
    await wrapper.findAll('button').filter((button) => button.text() === 'Connect & discover models')[1].trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('agnes-2.5-flash'));
    await wrapper.findAll('button').find((button) => button.text() === 'Save custom provider')!.trigger('click');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/custom-providers/agnes',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          baseUrl: 'https://api.agnes.test/v1',
          modelIds: ['agnes-2.5-flash'],
          imageModelIds: ['agnes-2.5-flash'],
          apiKey: 'agnes-secret',
        }),
      }),
    ));
    expect((wrapper.find('[aria-label="Custom provider API key"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).not.toContain('agnes-secret');
  });

  it('shows custom model discovery errors beside the discovery action', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Provider ID"]').exists()).toBe(true));

    await wrapper.find('[aria-label="Custom provider URL"]').setValue('https://api.example.test/v1');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Cloudflare: Authentication failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
    await wrapper.findAll('button').filter((button) => button.text() === 'Connect & discover models')[1].trigger('click');

    await vi.waitFor(() => expect(wrapper.find('.custom-provider-error').text()).toBe('Cloudflare: Authentication failed'));
  });

  it('loads and saves Cloudflare Workers AI models from an account ID', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Provider type"]').exists()).toBe(true));

    await wrapper.find('[aria-label="Provider type"]').trigger('click');
    await wrapper.findAll('.custom-select-option').find((option) => option.text() === 'Cloudflare Workers AI')!.trigger('click');
    expect((wrapper.find('[aria-label="Provider ID"]').element as HTMLInputElement).value).toBe('cloudflare-workers-ai');

    await wrapper.find('[aria-label="Cloudflare Account ID"]').setValue('0123456789abcdef0123456789abcdef');
    await wrapper.find('[aria-label="Custom provider API key"]').setValue('cloudflare-secret');
    expect((wrapper.find('[aria-label="Custom provider URL"]').element as HTMLInputElement).value).toBe(
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1',
    );
    await wrapper.findAll('button').filter((button) => button.text() === 'Connect & discover models')[1].trigger('click');

    await vi.waitFor(() => expect(wrapper.text()).toContain('@cf/meta/llama-3.2-3b-instruct'));
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/custom-providers/discover',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          providerType: 'cloudflare-workers-ai',
          accountId: '0123456789abcdef0123456789abcdef',
          apiKey: 'cloudflare-secret',
        }),
      }),
    );

    await wrapper.findAll('button').find((button) => button.text() === 'Save custom provider')!.trigger('click');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/custom-providers/cloudflare-workers-ai',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          baseUrl: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1',
          modelIds: ['@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.2-11b-vision-instruct'],
          imageModelIds: ['@cf/meta/llama-3.2-11b-vision-instruct'],
          apiKey: 'cloudflare-secret',
        }),
      }),
    ));
    expect((wrapper.find('[aria-label="Custom provider API key"]').element as HTMLInputElement).value).toBe('');
  });

  it('shows the proxy country after a successful check', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });
    await vi.waitFor(() => expect(wrapper.find('[aria-label="API provider key"]').text()).toContain('OPENAI_API_KEY'));
    await wrapper.vm.$nextTick();

    const checkButton = wrapper.find('.profile-check-button');
    await checkButton.trigger('click');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/agent-profiles/work/proxy/check',
      expect.objectContaining({ method: 'POST' }),
    ));
    await vi.waitFor(() => expect(wrapper.find('.profile-check-button').text()).toContain('✓ US'));
  });

  it('loads and saves all profile settings with one action', async () => {
    const wrapper = mount(ProfileManagerDialog, {
      props: { visible: false, profiles, selectedId: 'work' },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.setProps({ visible: true });

    await vi.waitFor(() => expect(wrapper.find('[aria-label="Automation model"]').text()).toContain('GPT-5'));

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
