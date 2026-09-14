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

    (document.querySelector('.git-change-file-action') as HTMLElement).click();
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/git/index', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ cwd: '/workspace', path: 'src/app.ts', scope: 'unstaged', mode: 'file' }),
    }));
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
