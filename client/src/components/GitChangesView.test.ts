import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitChangesView from './GitChangesView.vue';

function response(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

const patch = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

describe('GitChangesView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/git/status')) {
        return response({ files: [{ path: 'src/app.ts', status: 'MM', staged: true, unstaged: true }] });
      }
      if (url.includes('/api/git/branches')) return response({ current: 'main' });
      if (url.includes('/api/git/diff')) return response({ diff: patch });
      if (url.includes('/api/git/change-reason')) return response({ reason: 'This updates the displayed value.' });
      if (url.includes('/api/git/amend-status')) return response({ message: 'Previous message' });
      if (url.includes('/api/git/commit') || url.includes('/api/git/amend')) return response({ commit: '1234567890' });
      return response({});
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('shows staged and unstaged files and updates whole files', async () => {
    const wrapper = mount(GitChangesView, { props: { visible: true, cwd: '/workspace' } });
    await flushPromises();

    expect(document.querySelectorAll('.git-change-file')).toHaveLength(2);
    expect(document.body.textContent).toContain('Unstaged Changes');
    expect(document.body.textContent).toContain('Staged Changes');

    (document.querySelector('.git-change-status-icon') as HTMLElement).click();
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/git/index', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ cwd: '/workspace', path: 'src/app.ts', scope: 'unstaged', mode: 'file' }),
    }));
    wrapper.unmount();
  });

  it('provides resizable, independently scrollable lists and stages all files', async () => {
    const wrapper = mount(GitChangesView, { props: { visible: true, cwd: '/workspace' } });
    await flushPromises();

    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(document.querySelectorAll('.git-change-list')).toHaveLength(2);
    (Array.from(document.querySelectorAll<HTMLButtonElement>('.git-change-group h3 button'))
      .find(button => button.textContent?.includes('Stage All')) as HTMLButtonElement).click();
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/git/index', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ cwd: '/workspace', scope: 'unstaged', mode: 'all' }),
    }));
    wrapper.unmount();
  });

  it('commits staged files and loads the previous message for amend', async () => {
    const wrapper = mount(GitChangesView, { props: { visible: true, cwd: '/workspace', sessionId: 'session-1' } });
    await flushPromises();

    const amend = document.querySelector<HTMLInputElement>('.git-amend-option input')!;
    amend.click();
    await flushPromises();
    expect(document.querySelector<HTMLTextAreaElement>('#git-changes-commit-message')?.value).toBe('Previous message');

    const amendButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.git-commit-actions button'))
      .find(button => button.textContent?.includes('Amend'))!;
    amendButton.click();
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/git/amend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ cwd: '/workspace', message: 'Previous message', sessionId: 'session-1', stagedOnly: true }),
    }));
    expect(document.body.textContent).toContain('Amended commit 1234567.');
    wrapper.unmount();
  });

  it('explains the reason for an individual diff hunk on demand', async () => {
    const wrapper = mount(GitChangesView, { props: { visible: true, cwd: '/workspace', clientId: 'client-1' } });
    await flushPromises();

    const explainButton = document.querySelector<HTMLButtonElement>('.git-change-reason-button')!;
    expect(explainButton.textContent).toContain('Why this change?');
    explainButton.click();
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/git/change-reason', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        cwd: '/workspace',
        clientId: 'client-1',
        path: 'src/app.ts',
        scope: 'unstaged',
        hunkIndex: 0,
        expectedHunk: '@@ -1 +1 @@\n-old\n+new',
      }),
    }));
    const reasonPanels = document.querySelectorAll('.git-change-reason');
    expect(reasonPanels).toHaveLength(1);
    expect(reasonPanels[0].textContent).toContain('This updates the displayed value.');
    expect(reasonPanels[0].closest('.git-changes-diff-block')?.querySelectorAll('.git-changes-line')).toHaveLength(3);
    wrapper.unmount();
  });

  it('offers line and hunk staging from the diff context menu', async () => {
    const wrapper = mount(GitChangesView, { props: { visible: true, cwd: '/workspace' } });
    await flushPromises();

    const addedLine = Array.from(document.querySelectorAll<HTMLElement>('.git-changes-line'))
      .find(line => line.textContent?.includes('+new')) as HTMLElement;
    addedLine.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 }));
    await flushPromises();

    const menuButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.git-changes-context-menu button'));
    expect(menuButtons.map(button => button.textContent?.trim())).toEqual(['Stage Selected Lines', 'Stage Hunk']);
    menuButtons[0].click();
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/git/index', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        cwd: '/workspace',
        path: 'src/app.ts',
        scope: 'unstaged',
        mode: 'lines',
        hunkIndex: 0,
        expectedHunk: '@@ -1 +1 @@\n-old\n+new',
        selectedLines: [1],
      }),
    }));
    wrapper.unmount();
  });
});
