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
    expect(wrapper.findAll('.git-tool-action').every(button => button.text() === '')).toBe(true);
    expect(wrapper.find('.git-tool-action').attributes('title')).toBe('Refresh');

    const commands = ['/status', '/commit', '/push', '/pull', '/branch', '/pr'];
    const buttons = wrapper.findAll('.git-tool-action');
    for (const button of buttons) await button.trigger('click');

    expect(wrapper.emitted('command')?.map(([command]) => command)).toEqual(commands);
  });

  it('disables commit when the working tree has no changed files', async () => {
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    const commit = wrapper.find('.git-tool-action[aria-label="Commit"]');
    expect(commit.attributes('disabled')).toBeDefined();
  });

  it('opens files and file diffs in the editor', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/git/diff')) {
        return response({ cwd: '/workspace', diff: 'diff --git a/src/app.ts b/src/app.ts' });
      }
      return response({ files: [{ status: 'M', path: 'src/app.ts' }] });
    });
    const openFile = vi.fn();
    const openDiff = vi.fn();
    window.addEventListener('open-file-in-editor', openFile);
    window.addEventListener('open-virtual-diff-in-editor', openDiff);
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    await wrapper.find('.git-file-open').trigger('click');
    await wrapper.find('.git-file-diff').trigger('click');
    await flushPromises();

    expect((openFile.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'src/app.ts', kind: 'path' });
    expect(fetch).toHaveBeenCalledWith('/api/git/diff?cwd=%2Fworkspace&path=src%2Fapp.ts');
    expect((openDiff.mock.calls[0][0] as CustomEvent).detail).toEqual({
      cwd: '/workspace',
      scope: 'src/app.ts',
      content: 'diff --git a/src/app.ts b/src/app.ts',
    });

    window.removeEventListener('open-file-in-editor', openFile);
    window.removeEventListener('open-virtual-diff-in-editor', openDiff);
  });

  it('resizes the panel by dragging its top edge', async () => {
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();
    wrapper.find('.git-tool-resize-handle').element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 300 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 250 }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.git-tool-panel').attributes('style')).toContain('height: 290px');
    window.dispatchEvent(new PointerEvent('pointerup'));
  });
});
