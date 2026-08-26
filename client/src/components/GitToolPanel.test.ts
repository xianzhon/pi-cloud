import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitToolPanel from './GitToolPanel.vue';

function response(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

describe('GitToolPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ files: [] })));
  });

  it('lists changed files and emits the matching slash command for each action', async () => {
    vi.mocked(fetch).mockResolvedValue(response({
      files: [
        { status: 'M', path: 'client/src/App.vue' },
        { status: '??', path: 'client/src/components/GitToolPanel.vue' },
      ],
    }));
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    expect(wrapper.findAll('.git-tool-files li')).toHaveLength(2);
    expect(wrapper.text()).toContain('client/src/App.vue');

    const commands = ['/status', '/commit', '/push', '/pull', '/branch', '/pr'];
    const buttons = wrapper.findAll('.git-tool-action');
    for (const button of buttons) await button.trigger('click');

    expect(wrapper.emitted('command')?.map(([command]) => command)).toEqual(commands);
  });

  it('disables commit when the working tree has no changed files', async () => {
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    const commit = wrapper.findAll('.git-tool-action').find((button) => button.text() === 'Commit');
    expect(commit?.attributes('disabled')).toBeDefined();
  });
});
