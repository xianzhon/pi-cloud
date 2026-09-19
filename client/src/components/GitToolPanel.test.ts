import { flushPromises, mount } from '@vue/test-utils';
import { PhGitCommit } from '@phosphor-icons/vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitToolPanel from './GitToolPanel.vue';

function response(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

describe('GitToolPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ files: [] })));
  });

  it('lists changed files and emits commands only for actions handled by chat', async () => {
    vi.mocked(fetch).mockResolvedValue(response({
      files: [
        { status: ' M', path: 'client/src/App.vue', staged: false, unstaged: true },
        { status: 'M ', path: 'client/src/staged.ts', staged: true, unstaged: false },
        { status: '??', path: 'client/src/new.ts', staged: false, unstaged: true },
        { status: ' D', path: 'client/src/deleted.ts', staged: false, unstaged: true },
      ],
    }));
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    expect(wrapper.findAll('.git-tool-files li')).toHaveLength(4);
    expect(wrapper.text()).toContain('client/src/App.vue');
    expect(wrapper.findAll('.git-file-status').map(icon => icon.classes())).toEqual([
      ['git-file-status', 'modified'],
      ['git-file-status', 'staged'],
      ['git-file-status', 'untracked'],
      ['git-file-status', 'missing'],
    ]);
    expect(wrapper.findAll('.git-file-status-badge')).toHaveLength(2);
    expect(wrapper.findAll('.git-file-open')[1].attributes('aria-label')).toBe('client/src/staged.ts: Staged for commit');
    const actions = wrapper.findAll('.git-tool-action');
    expect(actions.every(button => button.text() === '')).toBe(true);
    expect(actions.every(button => button.classes().includes('tooltip'))).toBe(true);
    expect(actions.map(button => button.attributes('data-tooltip'))).toEqual([
      'Refresh', 'Git Commit', 'History', 'PR', 'Pull', 'Branch',
    ]);
    expect(actions[1].findComponent(PhGitCommit).exists()).toBe(true);
    expect(actions.every(button => button.attributes('title') === undefined)).toBe(true);

    const commands = ['/pr', '/pull', '/branch'];
    for (const button of actions) await button.trigger('click');

    expect(wrapper.emitted('changes')).toHaveLength(1);
    expect(wrapper.emitted('history')).toHaveLength(1);
    expect(wrapper.emitted('command')?.map(([command]) => command)).toEqual(commands);
  });

  it('shows a friendly state and disables Git actions outside a repository', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ isRepository: false, files: [] }));
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    expect(wrapper.text()).toContain('This folder is not a Git repository.');
    const actions = wrapper.findAll('.git-tool-action');
    expect(actions[0].attributes('disabled')).toBeUndefined();
    expect(actions.slice(1).every(action => action.attributes('disabled') !== undefined)).toBe(true);

    vi.mocked(fetch).mockResolvedValue(response({
      isRepository: true,
      files: [{ status: 'M', path: 'src/changed.ts' }],
    }));
    await actions[0].trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('src/changed.ts');
    expect(wrapper.findAll('.git-tool-action').every(action => action.attributes('disabled') === undefined)).toBe(true);
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

  it('opens changed files in the editor', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ files: [{ status: 'M', path: 'src/app.ts' }] }));
    const openFile = vi.fn();
    window.addEventListener('open-file-in-editor', openFile);
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();

    expect(wrapper.find('.git-file-diff').exists()).toBe(false);
    await wrapper.find('.git-file-open').trigger('click');

    expect((openFile.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'src/app.ts', kind: 'path' });
    expect(fetch).not.toHaveBeenCalledWith('/api/git/diff?cwd=%2Fworkspace&path=src%2Fapp.ts');

    window.removeEventListener('open-file-in-editor', openFile);
  });

  it('resizes the panel by dragging its top edge', async () => {
    const wrapper = mount(GitToolPanel, { props: { cwd: '/workspace' } });
    await flushPromises();
    wrapper.find('.git-tool-resize-handle').element.dispatchEvent(new PointerEvent('pointerdown', { clientY: 300 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 250 }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.git-tool-panel').attributes('style')).toContain('height: 290px');
    window.dispatchEvent(new PointerEvent('pointerup'));

    await wrapper.find('.git-tool-resize-handle').trigger('dblclick');
    expect(wrapper.find('.git-tool-panel').attributes('style')).toContain('height: 240px');
  });
});
