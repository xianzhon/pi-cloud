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
    const actions = wrapper.findAll('.git-tool-action');
    expect(actions.every(button => button.text() === '')).toBe(true);
    expect(actions.every(button => button.classes().includes('tooltip'))).toBe(true);
    expect(actions.map(button => button.attributes('data-tooltip'))).toEqual([
      'History', 'Refresh', 'Commit', 'PR', 'Push', 'Pull', 'Branch', 'Show diff',
    ]);
    expect(actions.every(button => button.attributes('title') === undefined)).toBe(true);

    const commands = ['/status', '/commit', '/pr', '/push', '/pull', '/branch', '/diff'];
    for (const button of actions) await button.trigger('click');

    expect(wrapper.emitted('history')).toHaveLength(1);
    expect(wrapper.emitted('command')?.map(([command]) => command)).toEqual(commands);
  });

  it('shows a friendly state and disables Git actions outside a repository', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ isRepository: false, files: [] }));
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    expect(wrapper.text()).toContain('This folder is not a Git repository.');
    const actions = wrapper.findAll('.git-tool-action');
    expect(actions[0].attributes('disabled')).toBeDefined();
    expect(actions[1].attributes('disabled')).toBeUndefined();
    expect(actions.slice(2).every(action => action.attributes('disabled') !== undefined)).toBe(true);

    vi.mocked(fetch).mockResolvedValue(response({
      isRepository: true,
      files: [{ status: 'M', path: 'src/changed.ts' }],
    }));
    await actions[1].trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('src/changed.ts');
    expect(wrapper.findAll('.git-tool-action').every(action => action.attributes('disabled') === undefined)).toBe(true);
  });

  it('disables commit when the working tree has no changed files', async () => {
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    const commit = wrapper.find('.git-tool-action[aria-label="Commit"]');
    expect(commit.attributes('disabled')).toBeDefined();
  });

  it('refreshes when an agent turn completes', async () => {
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    vi.mocked(fetch).mockResolvedValue(response({ files: [{ status: 'M', path: 'src/changed.ts' }] }));
    window.dispatchEvent(new CustomEvent('refresh-git-status'));
    await flushPromises();

    expect(wrapper.text()).toContain('src/changed.ts');
    wrapper.unmount();
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

    const fileDiff = wrapper.find('.git-file-diff');
    expect(fileDiff.attributes('aria-label')).toBe('Show diff for src/app.ts');
    expect(fileDiff.attributes('data-tooltip')).toBeUndefined();
    expect(fileDiff.attributes('title')).toBeUndefined();

    await wrapper.find('.git-file-open').trigger('click');
    await fileDiff.trigger('click');
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
