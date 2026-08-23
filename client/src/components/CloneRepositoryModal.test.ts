import { mount, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CloneRepositoryModal from './CloneRepositoryModal.vue';

enableAutoUnmount(afterEach);

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
  emitRaw(data: string) { this.onmessage?.({ data } as MessageEvent); }
}

function ok(data: unknown) {
  return { ok: true, json: async () => data } as Response;
}

function error(status: number, data: unknown) {
  return { ok: false, status, json: async () => data } as Response;
}

function mountModal() {
  return mount(CloneRepositoryModal, {
    props: { visible: true, clientId: 'client-1' },
    global: { stubs: { Teleport: true } },
  });
}

describe('CloneRepositoryModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it('previews GitHub URLs and fills the suggested destination', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } })));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect((wrapper.find('[data-testid="clone-destination-input"]').element as HTMLInputElement).value).toBe('/Users/test/git/github/acme/tool'));
  });

  it('requires a destination for non-GitHub URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ preview: { remoteUrl: 'https://git.example.com/acme/tool.git', isGithub: false } })));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://git.example.com/acme/tool.git');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Choose a destination'));
    expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeDefined();
  });

  it('clears an auto-suggested GitHub destination when changing to a non-GitHub URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/preview')) return ok({ status: 'started', jobId: 'clone_1' });
      const body = JSON.parse(String(init?.body));
      if (new URL(body.remoteUrl).hostname === 'github.com') return ok({ preview: { remoteUrl: body.remoteUrl, isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } });
      return ok({ preview: { remoteUrl: body.remoteUrl, isGithub: false } });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect((wrapper.find('[data-testid="clone-destination-input"]').element as HTMLInputElement).value).toBe('/Users/test/git/github/acme/tool'));

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://git.example.com/acme/tool.git');
    expect((wrapper.find('[data-testid="clone-destination-input"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeDefined();
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/preview'))).toHaveLength(2));
    expect((wrapper.find('[data-testid="clone-destination-input"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeDefined();
  });

  it('shows a destination directory browser by default and follows the suggested clone target', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/files/tree?')) {
        return ok({
          path: new URL(url, 'http://localhost').searchParams.get('path'),
          tree: [
            { name: 'api', path: '/Users/test/git/github/acme/api', type: 'directory' },
            { name: 'web', path: '/Users/test/git/github/acme/web', type: 'directory' },
          ],
        });
      }
      return ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await vi.waitFor(() => expect(wrapper.text()).toContain('api'));
    expect(wrapper.text()).toContain('Parent folder');

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect((wrapper.find('[data-testid="clone-destination-input"]').element as HTMLInputElement).value).toBe('/Users/test/git/github/acme/tool'));
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('path=%2FUsers%2Ftest%2Fgit%2Fgithub%2Facme'))).toBe(true));

    await wrapper.findAll('.directory-row')[1].trigger('click');
    expect((wrapper.find('[data-testid="clone-destination-input"]').element as HTMLInputElement).value).toBe('/Users/test/git/github/acme/api');
  });

  it('starts a shallow clone when the unchecked-by-default option is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/files/tree?')) return ok({ path: '~', tree: [] });
      if (url.endsWith('/preview')) return ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true } });
      return ok({ status: 'started', jobId: 'clone_1' });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();
    const shallowCheckbox = wrapper.find('[data-testid="clone-shallow-checkbox"]');

    expect((shallowCheckbox.element as HTMLInputElement).checked).toBe(false);
    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await wrapper.find('[data-testid="clone-destination-input"]').setValue('/Users/test/git/github/acme/tool');
    await shallowCheckbox.setValue(true);
    await wrapper.find('[data-testid="clone-start-button"]').trigger('click');

    await vi.waitFor(() => {
      const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/sessions/clone-repository');
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ shallow: true });
    });
  });

  it('shows inline destination choices when the destination exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/files/tree?')) return ok({ path: '~', tree: [] });
      if (url.endsWith('/preview')) return ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } });
      return error(409, { status: 'destination_exists', existingPath: '/Users/test/git/github/acme/tool' });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeUndefined());
    await wrapper.find('[data-testid="clone-start-button"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Folder already exists'));

    await wrapper.find('[data-testid="clone-use-existing-button"]').trigger('click');
    expect(wrapper.emitted('cloned')).toEqual([[{ projectPath: '/Users/test/git/github/acme/tool' }]]);
  });

  it('updates progress from SSE and emits cloned on completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/preview')) return ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } });
      return ok({ status: 'started', jobId: 'clone_1' });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeUndefined());
    await wrapper.find('[data-testid="clone-start-button"]').trigger('click');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0].emit({ type: 'progress', status: 'Receiving objects…', percent: 42 });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Receiving objects…');
    expect(wrapper.text()).toContain('42%');

    FakeEventSource.instances[0].emit({ type: 'completed', status: 'Clone completed', projectPath: '/Users/test/git/github/acme/tool', percent: 100 });
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('cloned')).toEqual([[{ projectPath: '/Users/test/git/github/acme/tool' }]]);
  });

  it('disables Clone while the start request is in flight', async () => {
    let resolveStart: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/preview')) return ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } });
      return new Promise<Response>((resolve) => { resolveStart = resolve; });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeUndefined());
    await wrapper.find('[data-testid="clone-start-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeDefined();

    resolveStart(ok({ status: 'started', jobId: 'clone_1' }));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  });

  it('handles invalid SSE messages without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/preview')) return ok({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, suggestedPath: '/Users/test/git/github/acme/tool' } });
      return ok({ status: 'started', jobId: 'clone_1' });
    }));
    vi.stubGlobal('EventSource', FakeEventSource as any);
    const wrapper = mountModal();

    await wrapper.find('[data-testid="clone-url-input"]').setValue('https://github.com/acme/tool.git');
    await vi.waitFor(() => expect(wrapper.find('[data-testid="clone-start-button"]').attributes('disabled')).toBeUndefined());
    await wrapper.find('[data-testid="clone-start-button"]').trigger('click');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0].emitRaw('{not-json');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Clone progress update was invalid');
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
