import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CommandCenter from './CommandCenter.vue';

const props = { visible: true, clientId: 'client-1', projectPath: '/workspace' };
const stubs = { Teleport: true };

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('CommandCenter', () => {
  it('opens with recent sessions, filters files and activates a result with the keyboard', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.startsWith('/api/sessions?')
        ? { sessions: [{ id: 's1', name: 'Fix tests', cwd: '/workspace', path: '/sessions/s1' }] }
        : { files: ['src/main.ts', 'README.md'] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(CommandCenter, { props, global: { stubs } });
    await flushPromises();
    expect(wrapper.text()).toContain('Fix tests');
    expect(fetchMock.mock.calls[0][0]).toContain('clientId=client-1');
    expect(fetchMock.mock.calls[1][0]).toContain('path=%2Fworkspace');

    const input = wrapper.find('input');
    await input.setValue('main.ts');
    expect(wrapper.text()).toContain('src/main.ts');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('file')?.[0]).toEqual(['src/main.ts']);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('keeps the initial selection until the mouse moves over a result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [], files: [] }) })));
    const wrapper = mount(CommandCenter, { props, global: { stubs } });
    await flushPromises();
    const options = wrapper.findAll('[role="option"]');
    expect(options[0].attributes('aria-selected')).toBe('true');
    await options[1].trigger('mouseenter');
    expect(options[0].attributes('aria-selected')).toBe('true');
    await options[1].trigger('mousemove');
    expect(wrapper.findAll('[role="option"]')[1].attributes('aria-selected')).toBe('true');
  });

  it('supports action prefix and arrow navigation without touching the chat draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [], files: [] }) })));
    const wrapper = mount(CommandCenter, { props, global: { stubs } });
    await flushPromises();
    const input = wrapper.find('input');
    await input.setValue('>terminal');
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('action')?.[0]).toEqual(['terminal']);
    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(wrapper.find('input').element.value).toBe('');
    await wrapper.find('input').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(2);
  });
});
