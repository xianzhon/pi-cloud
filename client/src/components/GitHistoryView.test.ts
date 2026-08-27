import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitHistoryView from './GitHistoryView.vue';

function response(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

function commit(hash: string, subject: string) {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parentHashes: [],
    subject,
    body: `${subject} body`,
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    authoredAt: '2026-08-27T10:00:00.000Z',
  };
}

describe('GitHistoryView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('loads history, selects commits, and pages through 10 commits at a time', async () => {
    const first = commit('a'.repeat(40), 'Newest commit');
    const second = commit('b'.repeat(40), 'Earlier commit');
    const nextPage = commit('c'.repeat(40), 'Older commit');
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/history') && url.includes('page=1')) {
        return response({ branch: 'main', page: 1, hasPrevious: true, hasNext: false, commits: [nextPage] });
      }
      if (url.includes('/history')) {
        return response({ branch: 'main', page: 0, hasPrevious: false, hasNext: true, commits: [first, second] });
      }
      const selectedHash = new URL(url, 'http://localhost').searchParams.get('commit');
      return response({ stat: '1 file changed', diff: `diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-old ${selectedHash}\n+new ${selectedHash}` });
    });

    const wrapper = mount(GitHistoryView, {
      props: { visible: true, cwd: '/workspace' },
      global: { stubs: { Teleport: true } },
    });
    await flushPromises();

    expect(wrapper.findAll('.git-history-commit')).toHaveLength(2);
    expect(wrapper.get('.git-history-commit.is-selected').text()).toContain('Newest commit');
    expect(wrapper.get('.git-history-detail').text()).toContain('Newest commit body');
    expect(wrapper.find('.git-diff-line.is-removed').exists()).toBe(true);
    expect(wrapper.find('.git-diff-line.is-added').exists()).toBe(true);
    expect(wrapper.get('.git-history-previous').attributes('disabled')).toBeDefined();

    await wrapper.findAll('.git-history-commit')[1].trigger('click');
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith(`/api/git/diff?cwd=%2Fworkspace&commit=${'b'.repeat(40)}`);
    expect(wrapper.get('.git-history-commit.is-selected').text()).toContain('Earlier commit');

    await wrapper.get('.git-history-next').trigger('click');
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/git/history?cwd=%2Fworkspace&page=1');
    expect(wrapper.text()).toContain('Older commit');
    expect(wrapper.get('.git-history-next').attributes('disabled')).toBeDefined();
  });

  it('shows empty history and oversized patch states without closing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ branch: 'main', page: 0, hasPrevious: false, hasNext: false, commits: [] }));
    const emptyWrapper = mount(GitHistoryView, {
      props: { visible: true, cwd: '/workspace' },
      global: { stubs: { Teleport: true } },
    });
    await flushPromises();
    expect(emptyWrapper.text()).toContain('No commits found');

    const onlyCommit = commit('d'.repeat(40), 'Large change');
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ branch: 'main', page: 0, hasPrevious: false, hasNext: false, commits: [onlyCommit] }))
      .mockResolvedValueOnce(response({ oversized: true, message: 'This diff is too large to show safely.' }));
    const oversizedWrapper = mount(GitHistoryView, {
      props: { visible: true, cwd: '/workspace' },
      global: { stubs: { Teleport: true } },
    });
    await flushPromises();
    expect(oversizedWrapper.get('.git-history-diff-state').text()).toContain('too large');
  });
});
