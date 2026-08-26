import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import SessionSidebar from './SessionSidebar.vue';

vi.mock('./FolderPickerModal.vue', () => ({
  default: {
    name: 'FolderPickerModal',
    props: ['visible', 'initialPath', 'currentProjectPath', 'clientId', 'title', 'showClone', 'projectHistory'],
    emits: ['close', 'select', 'historyRemoved'],
    template: '<div data-testid="folder-picker" />',
  },
}));

enableAutoUnmount(afterEach);

const defaultProfiles = [
  {
    id: 'default',
    label: 'default (~/.pi/agent)',
    path: '/Users/test/.pi/agent',
    isDefault: true,
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4',
  },
  {
    id: 'work',
    label: 'work (~/.pi/work)',
    path: '/Users/test/.pi/work',
    isDefault: false,
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
];

function mockFetchWithNoSessions(
  projectPaths: string[] = [],
  profiles = defaultProfiles,
  sessions: object[] = [],
  reviewSources: object[] = [],
  reviewProjectPaths: string[] = [],
  reviewSessions: object[] = [],
) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const ok = (payload: object) => ({ ok: true, json: async () => payload });
    if (url === '/api/sessions/agent-profiles') {
      return ok({ profiles });
    }
    if (String(url).startsWith('/api/sessions/agent-profile?')) {
      return ok({ profile: profiles[0] });
    }
    if (url === '/api/sessions/agent-profile') {
      const profileId = JSON.parse(String(options?.body || '{}')).profileId;
      return ok({ profile: profiles.find((profile) => profile.id === profileId) || profiles[0] });
    }
    if (String(url).startsWith('/api/sessions/project-paths')) {
      return ok({ projectPaths });
    }
    if (String(url).startsWith('/api/sessions/project-path')) {
      return ok({ projectPath: '/project' });
    }
    if (url === '/api/review-sources') {
      return ok({ sources: reviewSources });
    }
    if (String(url).match(/^\/api\/review-sources\/[^/]+\/project-paths$/)) {
      return ok({ projectPaths: reviewProjectPaths });
    }
    if (String(url).match(/^\/api\/review-sources\/[^/]+\/sessions/)) {
      return ok({ sessions: reviewSessions });
    }
    return ok({ sessions });
  }));
}

function mountSidebar() {
  return mount(SessionSidebar, { props: { clientId: 'client-1' } });
}

describe('SessionSidebar', () => {
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
    i18n.global.locale.value = 'en';
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  it('renders the Agent selector above the unlabeled project picker', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Agent');
    });

    const agentPicker = wrapper.find('.agent-picker').element;
    const projectPicker = wrapper.find('.project-picker');
    expect(agentPicker.compareDocumentPosition(projectPicker.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(projectPicker.find('label').exists()).toBe(false);
  });

  it('loads the current agent profile from the server when the tab has no saved profile', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/sessions/agent-profile?clientId=client-1');
      expect((wrapper.find('.agent-profile-input').element as HTMLInputElement).value).toBe('default (~/.pi/agent)');
    });
  });

  it('restores the tab-saved agent profile instead of reusing another tab selection', async () => {
    sessionStorage.setItem('pi-webui-agent-profile', 'work');
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect((wrapper.find('.agent-profile-input').element as HTMLInputElement).value).toBe('work (~/.pi/work)');
    });

    expect(fetch).toHaveBeenCalledWith('/api/sessions/agent-profile', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', profileId: 'work' }),
    }));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/sessions/agent-profile?'))).toBe(false);
  });

  it('uses the profile and project query parameters before tab-saved values when opening a session URL', async () => {
    window.history.replaceState(null, '', '/sessions/session-1?profile=work&project=%2Fworkspace%2Fapp');
    sessionStorage.setItem('pi-webui-agent-profile', 'default');
    sessionStorage.setItem('pi-webui-project-path', '/saved/project');
    mockFetchWithNoSessions(['/workspace/app', '/saved/project']);
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect((wrapper.find('.agent-profile-input').element as HTMLInputElement).value).toBe('work (~/.pi/work)');
      expect((wrapper.find('.project-path-input').element as HTMLInputElement).value).toBe('/workspace/app');
    });

    expect(fetch).toHaveBeenCalledWith('/api/sessions/agent-profile', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', profileId: 'work' }),
    }));
  });

  it('shows the selected profile default provider/model under the agent input', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('anthropic / claude-sonnet-4');
    });
  });

  it('refreshes project paths and sessions after changing the agent profile', async () => {
    mockFetchWithNoSessions(['/home/alice/work/app']);
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.find('.agent-profile-input').exists()).toBe(true);
    });

    await wrapper.find('.agent-profile-input').trigger('focus');
    await vi.waitFor(() => {
      expect(wrapper.findAll('.agent-profile-option')).toHaveLength(3);
    });
    await wrapper.findAll('.agent-profile-option')[1].trigger('mousedown');

    await vi.waitFor(() => {
      expect(wrapper.emitted('agentProfileChanged')?.at(-1)).toEqual(['work']);
      expect(wrapper.text()).toContain('openai / gpt-4.1');
    });
    expect(sessionStorage.getItem('pi-webui-agent-profile')).toBe('work');
  });

  it('loads review-source project paths when selecting a review source', async () => {
    mockFetchWithNoSessions(
      ['/pi/project'],
      defaultProfiles,
      [],
      [{ id: 'devin', label: 'Devin', type: 'devin', dataPath: '/tmp/devin' }],
      ['/devin/project'],
      [],
    );
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.find('.agent-profile-input').exists()).toBe(true);
    });

    await wrapper.find('.agent-profile-input').trigger('focus');
    await vi.waitFor(() => {
      expect(wrapper.findAll('.agent-profile-option')).toHaveLength(4);
    });
    await wrapper.findAll('.agent-profile-option')[2].trigger('mousedown');

    await vi.waitFor(() => {
      expect((wrapper.find('.project-path-input').element as HTMLInputElement).value).toBe('/devin/project');
    });
    expect(wrapper.emitted('reviewSourceSelected')?.at(-1)).toEqual(['devin', 'Devin']);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/review-sources/devin/project-paths')).toBe(true);
  });

  it('highlights the active review session row', async () => {
    window.history.replaceState(null, '', '/sessions/review-1?profile=devin&project=%2Fdevin%2Fproject');
    mockFetchWithNoSessions(
      [],
      defaultProfiles,
      [],
      [{ id: 'devin', label: 'Devin', type: 'devin', dataPath: '/tmp/devin' }],
      ['/devin/project'],
      [{
        id: 'review-1', sourceId: 'devin', path: '/devin/project', cwd: '/devin/project',
        created: '2026-08-01T00:00:00.000Z', modified: '2026-08-01T00:00:00.000Z',
        messageCount: 1, firstMessage: 'review this',
      }],
    );
    const wrapper = mount(SessionSidebar, {
      props: { clientId: 'client-1', activeReviewSessionId: 'review-1' },
    });

    await vi.waitFor(() => expect(wrapper.find('.session-item').classes()).toContain('active'));
    expect(wrapper.emitted('reviewSessionSelected')?.at(-1)).toEqual([{ sourceId: 'devin', sessionId: 'review-1' }]);
  });

  it('restores a review source and session from the URL', async () => {
    window.history.replaceState(null, '', '/sessions/review-1?profile=devin&project=%2Fdevin%2Fproject');
    mockFetchWithNoSessions(
      [],
      defaultProfiles,
      [],
      [{ id: 'devin', label: 'Devin', type: 'devin', dataPath: '/tmp/devin' }],
      ['/devin/project'],
      [{
        id: 'review-1', sourceId: 'devin', path: '/devin/project', cwd: '/devin/project',
        created: '2026-08-01T00:00:00.000Z', modified: '2026-08-01T00:00:00.000Z',
        messageCount: 1, firstMessage: 'review this',
      }],
    );
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.emitted('reviewSourceSelected')?.at(-1)).toEqual(['devin', 'Devin']));
    expect(wrapper.emitted('reviewSessionSelected')?.at(-1)).toEqual([{ sourceId: 'devin', sessionId: 'review-1' }]);
    expect((wrapper.find('.project-path-input').element as HTMLInputElement).value).toBe('/devin/project');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/review-sources/devin/sessions'))).toBe(true);
  });

  it('opens profile management from the agent selector', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.agent-profile-input').exists()).toBe(true));
    await wrapper.find('.agent-profile-input').trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.agent-profile-option')).toHaveLength(3));
    await wrapper.findAll('.agent-profile-option').at(-1)!.trigger('mousedown');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Agent profiles'));
    const changesBeforeManaging = wrapper.emitted('agentProfileChanged')?.length || 0;
    (document.querySelectorAll('.profile-manager-list button')[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('work profile'));
    expect(wrapper.emitted('agentProfileChanged')?.length || 0).toBe(changesBeforeManaging);
  });

  it('keeps creation actions out of the sidebar header', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect((wrapper.find('.project-path-input').element as HTMLInputElement).value).toBe('/project');
    });

    expect(wrapper.find('.sidebar-header').text()).toContain('Pi WebUI');
    expect(wrapper.find('.new-session-btn').exists()).toBe(false);
  });

  it('localizes relative session times in Chinese mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
    i18n.global.locale.value = 'zh-CN';
    mockFetchWithNoSessions([], defaultProfiles, [
      {
        id: 'session-minutes', path: '/project', cwd: '/project', created: '2026-08-06T11:56:00.000Z',
        modified: '2026-08-06T11:56:00.000Z', messageCount: 1, firstMessage: 'minutes',
      },
      {
        id: 'session-hour', path: '/project', cwd: '/project', created: '2026-08-06T11:00:00.000Z',
        modified: '2026-08-06T11:00:00.000Z', messageCount: 1, firstMessage: 'hour',
      },
    ]);
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.findAll('.session-item')).toHaveLength(2));

    const relativeTimes = wrapper.findAll('.session-meta > span:first-child').map((node) => node.text());
    expect(relativeTimes).toEqual(['4分钟前', '1小时前']);
    vi.useRealTimers();
  });

  it('shows a newly created session immediately when notified', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No sessions found');
    });

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'session-1',
        cwd: '/project',
        firstMessage: 'build a quick feature',
        created: '2026-06-02T00:00:00.000Z',
      },
    }));

    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('build a quick feature');
    expect(wrapper.text()).not.toContain('No sessions found');
  });

  it('loads older sessions when the user scrolls near the bottom', async () => {
    const makeSession = (id: number) => ({
      id: `session-${id}`,
      path: '/project',
      cwd: '/project',
      created: `2026-07-${String(id).padStart(2, '0')}T00:00:00.000Z`,
      modified: `2026-07-${String(id).padStart(2, '0')}T00:00:00.000Z`,
      messageCount: 1,
      firstMessage: `session ${id}`,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (String(url).startsWith('/api/sessions/agent-profile?')) return { json: async () => ({ profile: defaultProfiles[0] }) };
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/project' }) };

      const requestUrl = new URL(String(url), 'http://localhost');
      const offset = Number(requestUrl.searchParams.get('offset'));
      return offset === 0
        ? { json: async () => ({ sessions: Array.from({ length: 30 }, (_, index) => makeSession(30 - index)), hasMore: true, nextOffset: 30 }) }
        : { json: async () => ({ sessions: [makeSession(0)], hasMore: false, nextOffset: 31 }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.findAll('.session-item')).toHaveLength(30));
    const list = wrapper.find('.session-list');
    Object.defineProperties(list.element, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 850 },
    });
    await list.trigger('scroll');

    await vi.waitFor(() => expect(wrapper.findAll('.session-item')).toHaveLength(31));
    expect(fetchMock.mock.calls.some(([url]) => {
      const requestUrl = new URL(String(url), 'http://localhost');
      return requestUrl.pathname === '/api/sessions' && requestUrl.searchParams.get('offset') === '30';
    })).toBe(true);
  });

  it('shows an optimistic managed worktree session under its base project', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No sessions found');
    });

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'session-1',
        cwd: '/project/.project-worktrees/feature-a',
        firstMessage: 'worktree feature',
        created: '2026-06-02T00:00:00.000Z',
        worktree: {
          baseRepoPath: '/project',
          worktreePath: '/project/.project-worktrees/feature-a',
          worktreeManaged: true,
        },
      },
    }));

    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('worktree feature');
    expect(wrapper.text()).not.toContain('No sessions found');
  });

  it('keeps optimistic sessions visible when an immediate stale refresh returns without them', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No sessions found');
    });

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'session-1',
        cwd: '/project',
        firstMessage: 'keep me visible',
        created: '2026-06-02T00:00:00.000Z',
      },
    }));
    window.dispatchEvent(new CustomEvent('refresh-sessions'));

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('keep me visible');
    });
  });

  it('updates an empty optimistic session title as soon as the first message is sent', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No sessions found');
    });

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'session-1',
        cwd: '/project',
        created: '2026-06-02T00:00:00.000Z',
      },
    }));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('New Session');

    window.dispatchEvent(new CustomEvent('session-first-message', {
      detail: {
        id: 'session-1',
        firstMessage: 'title from first prompt',
      },
    }));

    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('title from first prompt');
    expect(wrapper.text()).not.toContain('New Session');
  });

  it('opens recent project paths from the input with home paths shortened', async () => {
    mockFetchWithNoSessions(['/home/alice/work/app', '/workspace/api']);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.find('.project-path-input').exists()).toBe(true);
    });

    expect(wrapper.find('.project-path-select').exists()).toBe(false);
    expect(wrapper.find('.recent-project-list').exists()).toBe(false);

    await wrapper.find('.project-path-input').trigger('focus');

    await vi.waitFor(() => {
      expect(wrapper.findAll('.recent-project-option')).toHaveLength(2);
    });

    const options = wrapper.findAll('.recent-project-option');
    expect(options[0].text()).toBe('~/work/app');
    expect(options[0].attributes('title')).toBeUndefined();
    expect(options[1].text()).toBe('/workspace/api');
    expect(wrapper.find('.recent-project-list').classes()).toContain('bounded');
  });

  it('filters recent projects and abbreviates long paths while preserving their full title', async () => {
    const longPath = '/Users/alice/projects/clients/acme/platform/services/api/src/backend';
    mockFetchWithNoSessions([longPath, '/Users/alice/projects/internal/dashboard']);

    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.project-path-input').exists()).toBe(true));

    const input = wrapper.find('.project-path-input');
    await input.trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')).toHaveLength(2));
    await input.setValue('acme');

    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')).toHaveLength(1));
    const option = wrapper.find('.recent-project-option');
    expect(option.text()).toBe('~/projects/…/src/backend');
    expect(option.attributes('title')).toBeUndefined();
    await option.trigger('mouseenter');
    expect(document.body.textContent).toContain(longPath);
  });

  it('orders recent project paths by per-profile MRU', async () => {
    localStorage.setItem('pi-webui-project-path-mru:default', JSON.stringify({
      updatedAt: Date.now(),
      paths: ['/workspace/api'],
    }));
    mockFetchWithNoSessions(['/home/alice/work/app', '/workspace/api']);

    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.project-path-input').exists()).toBe(true));

    await wrapper.find('.project-path-input').trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')).toHaveLength(2));

    const options = wrapper.findAll('.recent-project-option');
    expect(options[0].text()).toBe('/workspace/api');
    expect(options[1].text()).toBe('~/work/app');
  });

  it('uses separate project MRU lists for each agent profile', async () => {
    localStorage.setItem('pi-webui-project-path-mru:default', JSON.stringify({
      updatedAt: Date.now(),
      paths: ['/workspace/api'],
    }));
    localStorage.setItem('pi-webui-project-path-mru:work', JSON.stringify({
      updatedAt: Date.now(),
      paths: ['/home/alice/work/app'],
    }));
    mockFetchWithNoSessions(['/workspace/api', '/home/alice/work/app']);

    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.agent-profile-input').exists()).toBe(true));

    await wrapper.find('.agent-profile-input').trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.agent-profile-option')).toHaveLength(3));
    await wrapper.findAll('.agent-profile-option')[1].trigger('mousedown');
    await vi.waitFor(() => expect(wrapper.emitted('agentProfileChanged')?.at(-1)).toEqual(['work']));

    await wrapper.find('.project-path-input').trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')[0].text()).toBe('~/work/app'));
  });

  it('updates project MRU from another tab for the active profile', async () => {
    mockFetchWithNoSessions(['/workspace/api', '/workspace/web']);

    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.project-path-input').exists()).toBe(true));

    localStorage.setItem('pi-webui-project-path-mru:default', JSON.stringify({
      updatedAt: Date.now(),
      paths: ['/workspace/web'],
    }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'pi-webui-project-path-mru:default' }));

    await wrapper.find('.project-path-input').trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')[0].text()).toBe('/workspace/web'));
  });

  it('switches to a selected recent project path from the input dropdown', async () => {
    mockFetchWithNoSessions(['/home/alice/work/app']);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.find('.project-path-input').exists()).toBe(true);
    });

    await wrapper.find('.project-path-input').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.recent-project-option').exists()).toBe(true);
    });
    await wrapper.find('.recent-project-option').trigger('mousedown');

    expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/home/alice/work/app']);
  });

  it('selects a filtered project with the arrow keys and Enter', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    mockFetchWithNoSessions(['/workspace/api', '/workspace/web']);

    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.project-path-input').exists()).toBe(true));

    const input = wrapper.find('.project-path-input');
    await input.trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')).toHaveLength(2));
    await input.trigger('keydown.down');
    expect(wrapper.findAll('.recent-project-option')[1].classes()).toContain('active');
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
    await input.trigger('keydown.enter');

    expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/workspace/web']);
  });

  it('clamps project keyboard navigation at the first and last result', async () => {
    mockFetchWithNoSessions(['/workspace/api', '/workspace/web']);

    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.project-path-input').exists()).toBe(true));

    const input = wrapper.find('.project-path-input');
    await input.trigger('focus');
    await vi.waitFor(() => expect(wrapper.findAll('.recent-project-option')).toHaveLength(2));
    await input.trigger('keydown.up');
    expect(wrapper.findAll('.recent-project-option')[0].classes()).toContain('active');
    await input.trigger('keydown.down');
    await input.trigger('keydown.down');
    expect(wrapper.findAll('.recent-project-option')[1].classes()).toContain('active');
  });

  it('commits a manually entered project path when Enter is pressed', async () => {
    mockFetchWithNoSessions();

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.find('.project-path-input').exists()).toBe(true);
    });

    await wrapper.find('.project-path-input').setValue('/manual/project');
    await wrapper.find('.project-path-input').trigger('keydown.enter');

    expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/manual/project']);
  });

  it('switches project without moving when no moveMode is set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/old/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/old/project' }) };
      if (String(url).startsWith('/api/sessions?')) return { json: async () => ({ sessions: [] }) };
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/project', { initial: true }]);
    });
    wrapper.findComponent({ name: 'FolderPickerModal' }).vm.$emit('select', { path: '/new/parent' });
    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/new/parent']);
    });

    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/move-project', expect.anything());
  });

  it('moves sessions before switching when requested', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/relocate-project') {
        expect(JSON.parse(String(options?.body))).toEqual({
          clientId: 'client-1',
          oldProjectPath: '/old/project',
          newProjectPath: '/alias/project',
        });
        return { ok: true, json: async () => ({ success: true, moved: 2, skipped: 0 }) };
      }
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/old/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/old/project' }) };
      if (String(url).startsWith('/api/sessions?')) return { json: async () => ({ sessions: [] }) };
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/project', { initial: true }]);
    });
    wrapper.findComponent({ name: 'FolderPickerModal' }).vm.$emit('select', { path: '/alias/project', moveMode: 'move-sessions' });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions/relocate-project', expect.objectContaining({ method: 'POST' }));
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/alias/project']);
    });
  });

  it('renames project before switching when requested', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/move-project') {
        expect(JSON.parse(String(options?.body))).toEqual({
          clientId: 'client-1',
          oldProjectPath: '/old/project',
          destinationParentPath: '/old',
          newProjectName: 'renamed-project',
        });
        return { ok: true, json: async () => ({ success: true, projectPath: '/old/renamed-project', movedSessions: 2, skippedSessionFiles: 0 }) };
      }
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/old/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/old/project' }) };
      if (String(url).startsWith('/api/sessions?')) return { json: async () => ({ sessions: [] }) };
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/project', { initial: true }]);
    });
    wrapper.findComponent({ name: 'FolderPickerModal' }).vm.$emit('select', { path: '/old', moveMode: 'rename', projectName: 'renamed-project' });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions/move-project', expect.objectContaining({ method: 'POST' }));
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/renamed-project']);
    });
  });

  it('moves project before switching without renaming it', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/move-project') {
        expect(JSON.parse(String(options?.body))).toEqual({
          clientId: 'client-1',
          oldProjectPath: '/old/project',
          destinationParentPath: '/new/parent',
          newProjectName: 'project',
        });
        return { ok: true, json: async () => ({ success: true, projectPath: '/new/parent/project', movedSessions: 2, skippedSessionFiles: 0 }) };
      }
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/old/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/old/project' }) };
      if (String(url).startsWith('/api/sessions?')) return { json: async () => ({ sessions: [] }) };
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/project', { initial: true }]);
    });
    wrapper.findComponent({ name: 'FolderPickerModal' }).vm.$emit('select', { path: '/new/parent', moveMode: 'move-project', projectName: 'renamed-project' });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions/move-project', expect.objectContaining({ method: 'POST' }));
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/new/parent/project']);
    });
  });

  it('does not switch project when project move fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sessions/move-project') {
        return { ok: false, status: 409, json: async () => ({ error: 'Destination project folder already exists' }) };
      }
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/old/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/old/project' }) };
      if (String(url).startsWith('/api/sessions?')) return { json: async () => ({ sessions: [] }) };
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/project', { initial: true }]);
    });
    wrapper.findComponent({ name: 'FolderPickerModal' }).vm.$emit('select', { path: '/new/parent', moveMode: 'move-project', projectName: 'project' });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Destination project folder already exists');
    });

    expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/old/project', { initial: true }]);
  });

  it('switches to the session project from the All tab context menu', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (url === '/api/sessions/agent-profile') {
        const profileId = JSON.parse(String(options?.body || '{}')).profileId;
        return { json: async () => ({ profile: defaultProfiles.find((profile) => profile.id === profileId) || defaultProfiles[0] }) };
      }
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/current/project', '/other/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/current/project' }) };
      if (String(url).startsWith('/api/sessions?')) {
        const parsed = new URL(String(url), 'http://localhost');
        return {
          json: async () => ({
            sessions: parsed.searchParams.get('scope') === 'all' ? [{
              id: 'session-other',
              path: '/other/project',
              cwd: '/other/project',
              created: '2026-06-02T00:00:00.000Z',
              modified: '2026-06-02T00:00:00.000Z',
              messageCount: 1,
              firstMessage: 'other project session',
            }] : [],
          }),
        };
      }
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/current/project', { initial: true }]);
    });
    await wrapper.findAll('.scope-toggle button')[1].trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('other project session'));

    await wrapper.find('.session-item').trigger('contextmenu');
    await vi.waitFor(() => expect(document.body.querySelector('.switch-to-project-btn')?.textContent).toContain('Switch to this project'));
    (document.body.querySelector('.switch-to-project-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/other/project']);
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions?scope=project&clientId=client-1&offset=0&limit=30&projectPath=%2Fother%2Fproject');
    });
  });

  it('hides the session project switch action for current-project sessions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/agent-profiles') return { json: async () => ({ profiles: defaultProfiles }) };
      if (url === '/api/sessions/agent-profile') {
        const profileId = JSON.parse(String(options?.body || '{}')).profileId;
        return { json: async () => ({ profile: defaultProfiles.find((profile) => profile.id === profileId) || defaultProfiles[0] }) };
      }
      if (String(url).startsWith('/api/sessions/project-paths')) return { json: async () => ({ projectPaths: ['/current/project'] }) };
      if (String(url).startsWith('/api/sessions/project-path')) return { json: async () => ({ projectPath: '/current/project' }) };
      if (String(url).startsWith('/api/sessions?')) {
        return {
          json: async () => ({
            sessions: [{
              id: 'session-current',
              path: '/current/project',
              cwd: '/current/project',
              created: '2026-06-02T00:00:00.000Z',
              modified: '2026-06-02T00:00:00.000Z',
              messageCount: 1,
              firstMessage: 'current project session',
            }],
          }),
        };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.text()).toContain('current project session'));
    await wrapper.findAll('.scope-toggle button')[1].trigger('click');
    await wrapper.find('.session-item').trigger('contextmenu');

    await vi.waitFor(() => expect(document.body.querySelector('.session-context-menu')).not.toBeNull());
    expect(document.body.querySelector('.switch-to-project-btn')).toBeNull();
  });

  it('lets users drag the right edge to resize the session list', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No sessions found');
    });

    expect(wrapper.find('.session-sidebar').attributes('style')).toContain('--session-sidebar-width: 280px');

    const handle = wrapper.find('.sidebar-resize-handle');
    await handle.trigger('mousedown', { clientX: 280 });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 340 }));
    await wrapper.vm.$nextTick();
    expect(handle.classes()).toContain('is-resizing');

    window.dispatchEvent(new Event('blur'));
    await wrapper.vm.$nextTick();
    expect(handle.classes()).not.toContain('is-resizing');
    expect(wrapper.find('.session-sidebar').attributes('style')).toContain('--session-sidebar-width: 340px');
  });

  it('shows a live indicator for streaming sessions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/agent-profiles') {
        return { json: async () => ({ profiles: defaultProfiles }) };
      }
      if (url === '/api/sessions/agent-profile') {
        const profileId = JSON.parse(String(options?.body || '{}')).profileId;
        return { json: async () => ({ profile: defaultProfiles.find((profile) => profile.id === profileId) || defaultProfiles[0] }) };
      }
      if (String(url).startsWith('/api/sessions/project-paths')) {
        return { json: async () => ({ projectPaths: ['/project'] }) };
      }
      if (String(url).startsWith('/api/sessions/project-path')) {
        return { json: async () => ({ projectPath: '/project' }) };
      }
      return {
        json: async () => ({
          sessions: [{
            id: 'session-live',
            path: '/project',
            cwd: '/project',
            created: '2026-06-02T00:00:00.000Z',
            modified: '2026-06-02T00:00:00.000Z',
            messageCount: 2,
            firstMessage: 'streaming now',
            isStreaming: true,
          }],
        }),
      };
    }));

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.find('.live-indicator').exists()).toBe(true);
    });
  });

  it('updates the live indicator immediately from a local streaming-state event', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/agent-profiles') {
        return { json: async () => ({ profiles: defaultProfiles }) };
      }
      if (url === '/api/sessions/agent-profile') {
        const profileId = JSON.parse(String(options?.body || '{}')).profileId;
        return { json: async () => ({ profile: defaultProfiles.find((profile) => profile.id === profileId) || defaultProfiles[0] }) };
      }
      if (String(url).startsWith('/api/sessions/project-paths')) {
        return { json: async () => ({ projectPaths: ['/project'] }) };
      }
      if (String(url).startsWith('/api/sessions/project-path')) {
        return { json: async () => ({ projectPath: '/project' }) };
      }
      return {
        json: async () => ({
          sessions: [{
            id: 'session-1',
            path: '/project',
            cwd: '/project',
            created: '2026-06-02T00:00:00.000Z',
            modified: '2026-06-02T00:00:00.000Z',
            messageCount: 2,
            firstMessage: 'not live yet',
            isStreaming: false,
          }],
        }),
      };
    }));

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('not live yet');
    });
    expect(wrapper.find('.live-indicator').exists()).toBe(false);

    window.dispatchEvent(new CustomEvent('session-streaming-state', {
      detail: {
        id: 'session-1',
        isStreaming: true,
      },
    }));

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.live-indicator').exists()).toBe(true);
  });

  it('shows live indicators for multiple locally streaming sessions across stale refreshes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/agent-profiles') {
        return { json: async () => ({ profiles: defaultProfiles }) };
      }
      if (url === '/api/sessions/agent-profile') {
        const profileId = JSON.parse(String(options?.body || '{}')).profileId;
        return { json: async () => ({ profile: defaultProfiles.find((profile) => profile.id === profileId) || defaultProfiles[0] }) };
      }
      if (String(url).startsWith('/api/sessions/project-paths')) {
        return { json: async () => ({ projectPaths: ['/project'] }) };
      }
      if (String(url).startsWith('/api/sessions/project-path')) {
        return { json: async () => ({ projectPath: '/project' }) };
      }
      return {
        json: async () => ({
          sessions: [
            {
              id: 'session-1',
              path: '/project',
              cwd: '/project',
              created: '2026-06-02T00:00:00.000Z',
              modified: '2026-06-02T00:00:00.000Z',
              messageCount: 2,
              firstMessage: 'stream one',
              isStreaming: false,
            },
            {
              id: 'session-2',
              path: '/project',
              cwd: '/project',
              created: '2026-06-02T00:00:00.000Z',
              modified: '2026-06-02T00:00:00.000Z',
              messageCount: 2,
              firstMessage: 'stream two',
              isStreaming: false,
            },
          ],
        }),
      };
    }));

    const wrapper = mountSidebar();

    await vi.waitFor(() => {
      expect(wrapper.findAll('.session-item')).toHaveLength(2);
    });

    window.dispatchEvent(new CustomEvent('session-streaming-state', {
      detail: { id: 'session-1', isStreaming: true },
    }));
    window.dispatchEvent(new CustomEvent('session-streaming-state', {
      detail: { id: 'session-2', isStreaming: true },
    }));
    window.dispatchEvent(new CustomEvent('refresh-sessions'));

    await vi.waitFor(() => {
      expect(wrapper.findAll('.live-indicator')).toHaveLength(2);
    });
  });

  it('shows the signed-in user and Log out action at the bottom', async () => {
    mockFetchWithNoSessions();
    const wrapper = mount(SessionSidebar, { props: { clientId: 'client-1', username: 'alice' } });

    await vi.waitFor(() => expect(wrapper.find('.sidebar-footer').exists()).toBe(true));

    expect(wrapper.find('.sidebar-username').text()).toBe('alice');
    expect(wrapper.find('.sidebar-menu-btn').exists()).toBe(false);
    const logoutButton = wrapper.get('[aria-label="Log out"]');
    expect(logoutButton.attributes('title')).toBeUndefined();
    await logoutButton.trigger('mouseenter');
    expect(document.body.textContent).toContain('Log out');
    await logoutButton.trigger('click');
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });

  it('shows the fixed app brand', async () => {
    mockFetchWithNoSessions();
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.find('.sidebar-header h3').text()).toContain('Pi WebUI'));
    expect(wrapper.find('.sidebar-mode-toggle').exists()).toBe(false);
  });

  it('moves a session to a folder selected from its context menu', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.text()).toContain('No sessions found'));

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'saved-session-1',
        path: '/sessions/project/saved-session-1.jsonl',
        cwd: '/project',
        firstMessage: 'saved conversation',
        created: '2026-07-14T00:00:00.000Z',
      },
    }));
    await wrapper.vm.$nextTick();
    await wrapper.get('.session-item').trigger('contextmenu', { clientX: 20, clientY: 30 });
    await vi.waitFor(() => expect(document.body.querySelector('.move-session-btn')).not.toBeNull());
    (document.body.querySelector('.move-session-btn') as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, path: '/sessions/archive/saved-session-1.jsonl', cwd: '/archive' }),
    } as Response);
    wrapper.findAllComponents({ name: 'FolderPickerModal' })[1].vm.$emit('select', { path: '/archive' });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/sessions/saved-session-1/relocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', newProjectPath: '/archive' }),
    }));
  });

  it('extracts memories from a saved-session context menu and closes it', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.text()).toContain('No sessions found'));

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'saved-session-1',
        path: '/project',
        cwd: '/project',
        firstMessage: 'saved conversation',
        created: '2026-07-14T00:00:00.000Z',
      },
    }));
    await wrapper.vm.$nextTick();
    await wrapper.get('.session-item').trigger('contextmenu', { clientX: 20, clientY: 30 });
    await vi.waitFor(() => expect(document.body.querySelector('.extract-memories-btn')).not.toBeNull());

    (document.body.querySelector('.extract-memories-btn') as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('extract-memories')).toEqual([['saved-session-1']]);
    expect(document.body.querySelector('.session-context-menu')).toBeNull();
  });

  it('notifies the app when a session is deleted from the context menu', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.text()).toContain('No sessions found'));

    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: 'saved-session-1',
        path: '/project',
        cwd: '/project',
        firstMessage: 'saved conversation',
        created: '2026-07-14T00:00:00.000Z',
      },
    }));
    await wrapper.vm.$nextTick();
    await wrapper.get('.session-item').trigger('contextmenu', { clientX: 20, clientY: 30 });
    await vi.waitFor(() => expect(document.body.querySelector('.session-context-menu .danger')).not.toBeNull());

    (document.body.querySelector('.session-context-menu .danger') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.querySelector('.confirm-modal .btn-confirm')).not.toBeNull());
    vi.mocked(fetch).mockResolvedValueOnce({ json: async () => ({ success: true }) } as Response);
    (document.body.querySelector('.confirm-modal .btn-confirm') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(wrapper.emitted('sessionDeleted')).toEqual([['saved-session-1']]);
      expect(wrapper.find('.session-item').exists()).toBe(false);
    });
  });

  it('keeps clone repository out of the sidebar project row', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect((wrapper.find('.project-path-input').element as HTMLInputElement).value).toBe('/project'));

    expect(wrapper.find('[data-testid="clone-repository-button"]').exists()).toBe(false);
  });

  it('switches the project path after the open project dialog clones a repository without creating a session', async () => {
    mockFetchWithNoSessions(['/project']);
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect((wrapper.find('.project-path-input').element as HTMLInputElement).value).toBe('/project'));
    wrapper.findComponent({ name: 'FolderPickerModal' }).vm.$emit('select', { path: '/Users/test/git/github/acme/tool' });

    await vi.waitFor(() => {
      expect(wrapper.emitted('projectPathChanged')?.at(-1)).toEqual(['/Users/test/git/github/acme/tool']);
    });
    expect(wrapper.emitted('createSessionWithSameSettings')).toBeUndefined();
    const stored = JSON.parse(localStorage.getItem('pi-webui-project-path-mru:default') || '{}');
    expect(stored.entries[0]).toMatchObject({ path: '/Users/test/git/github/acme/tool' });
    expect(stored.entries[0].lastAccessed).toEqual(expect.any(Number));
    expect(wrapper.findComponent({ name: 'FolderPickerModal' }).props('projectHistory'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: '/Users/test/git/github/acme/tool' })]));
  });

  it('renders pinned sessions in collapsible groups and creates groups', async () => {
    const pinnedSession = {
      id: 'session-1', path: '/project', cwd: '/project', name: 'Pinned session',
      created: '2026-08-01T00:00:00.000Z', modified: '2026-08-01T00:00:00.000Z', messageCount: 2,
    };
    const groups = [
      { id: 'default', name: 'Default', isDefault: true, createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'important', name: 'Important', isDefault: false, createdAt: '2026-08-02T00:00:00.000Z' },
    ];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const ok = (payload: object) => ({ ok: true, json: async () => payload });
      if (url === '/api/sessions/agent-profiles') return ok({ profiles: defaultProfiles });
      if (String(url).startsWith('/api/sessions/agent-profile?')) return ok({ profile: defaultProfiles[0] });
      if (String(url).startsWith('/api/sessions/project-paths')) return ok({ projectPaths: ['/project'] });
      if (String(url).startsWith('/api/sessions/project-path')) return ok({ projectPath: '/project' });
      if (url === '/api/review-sources') return ok({ sources: [] });
      if (url === '/api/sessions/pin-groups' && options?.method === 'POST') {
        groups.push({ id: 'later', name: JSON.parse(String(options.body)).name, isDefault: false, createdAt: '2026-08-03T00:00:00.000Z' });
        return ok({ group: groups.at(-1) });
      }
      if (url === '/api/sessions/pin-groups?profileId=default') return ok({ groups });
      if (String(url).startsWith('/api/sessions/pinned?')) {
        return ok({ groups: groups.map((group) => ({ ...group, sessions: group.id === 'important' ? [pinnedSession] : [] })) });
      }
      return ok({ sessions: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.findAll('.scope-toggle button')).toHaveLength(3));
    await wrapper.findAll('.scope-toggle button')[2].trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Pinned session'));
    expect(wrapper.text()).toContain('Default');
    expect(wrapper.text()).toContain('Important');

    await wrapper.get('.session-item').trigger('contextmenu');
    expect(document.body.querySelector('.pin-session-btn')?.textContent).toContain('Move to group');
    const moveChoices = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.pin-group-choices button'));
    expect(moveChoices.find((button) => button.textContent?.includes('Important'))?.getAttribute('aria-checked')).toBe('true');
    moveChoices.find((button) => button.textContent?.includes('Default'))!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/pin', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ groupId: 'default', profileId: 'default' }),
    })));

    await wrapper.get('.session-item').trigger('contextmenu');
    (document.body.querySelector('.remove-pin-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/pin?profileId=default', { method: 'DELETE' }));

    await wrapper.findAll('.pin-group-header')[1].trigger('click');
    expect(wrapper.text()).not.toContain('Pinned session');
    await wrapper.get('.add-pin-group-btn').trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.prompt-input')).not.toBeNull());
    const input = document.body.querySelector('.prompt-input') as HTMLInputElement;
    input.value = 'Later';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (document.body.querySelector('.prompt-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Later'));
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/pin-groups', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Later', profileId: 'default' }),
    }));
  });

  it('pins review sessions and displays them in pinned groups', async () => {
    window.history.replaceState(null, '', '/?profile=codex&project=%2Fproject');
    const reviewSession = {
      id: 'review-1', sourceId: 'codex', path: '/tmp/review-1.jsonl', cwd: '/project', name: 'Review one',
      created: '2026-08-01T00:00:00.000Z', modified: '2026-08-01T00:00:00.000Z', messageCount: 1,
    };
    let pinned = false;
    const group = { id: 'default', name: 'Default', isDefault: true, createdAt: '', sessionIds: [] as string[] };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const ok = (payload: object) => ({ ok: true, json: async () => payload });
      if (url === '/api/sessions/agent-profiles') return ok({ profiles: defaultProfiles });
      if (url === '/api/review-sources') return ok({ sources: [{ id: 'codex', label: 'Codex', type: 'codex', dataPath: '/tmp/codex' }] });
      if (url === '/api/review-sources/codex/project-paths') return ok({ projectPaths: ['/project'] });
      if (url === '/api/review-sources/codex/pin-groups') return ok({ groups: [{ ...group, sessionIds: pinned ? ['review-1'] : [] }] });
      if (url === '/api/review-sources/codex/sessions/review-1/pin' && options?.method === 'PUT') {
        pinned = true;
        return ok({ success: true });
      }
      if (url === '/api/review-sources/codex/pinned') {
        return ok({ groups: [{ ...group, sessions: pinned ? [reviewSession] : [] }] });
      }
      if (String(url).startsWith('/api/review-sources/codex/sessions')) return ok({ sessions: [reviewSession] });
      if (String(url).startsWith('/api/sessions/project-path')) return ok({ projectPath: '/project' });
      return ok({ sessions: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mountSidebar();

    await vi.waitFor(() => expect(wrapper.text()).toContain('Review one'));
    expect((wrapper.findAll('.scope-toggle button')[2].element as HTMLButtonElement).disabled).toBe(false);
    await wrapper.get('.session-item').trigger('contextmenu');
    const defaultGroup = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.pin-group-choices button'))
      .find((button) => button.textContent?.includes('Default'))!;
    defaultGroup.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/review-sources/codex/sessions/review-1/pin',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ groupId: 'default' }) }),
    ));

    await wrapper.findAll('.scope-toggle button')[2].trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Review one'));
    expect(fetchMock).toHaveBeenCalledWith('/api/review-sources/codex/pinned');
    await wrapper.get('.session-item').trigger('click');
    expect(wrapper.emitted('reviewSessionSelected')?.at(-1)).toEqual([{ sourceId: 'codex', sessionId: 'review-1' }]);
  });

  it('pins a session to the selected group from the Project context menu', async () => {
    const session = {
      id: 'session-1', path: '/project', cwd: '/project', name: 'Session one',
      created: '2026-08-01T00:00:00.000Z', modified: '2026-08-01T00:00:00.000Z', messageCount: 1,
    };
    const fetchMock = vi.fn(async (url: string) => {
      const ok = (payload: object) => ({ ok: true, json: async () => payload });
      if (url === '/api/sessions/agent-profiles') return ok({ profiles: defaultProfiles });
      if (String(url).startsWith('/api/sessions/agent-profile?')) return ok({ profile: defaultProfiles[0] });
      if (String(url).startsWith('/api/sessions/project-paths')) return ok({ projectPaths: ['/project'] });
      if (String(url).startsWith('/api/sessions/project-path')) return ok({ projectPath: '/project' });
      if (url === '/api/review-sources') return ok({ sources: [] });
      if (url === '/api/sessions/pin-groups?profileId=default') return ok({ groups: [
        { id: 'default', name: 'Default', isDefault: true, createdAt: '', sessionIds: ['session-1'] },
        { id: 'important', name: 'Important', isDefault: false, createdAt: '', sessionIds: [] },
      ] });
      return ok({ sessions: [session] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mountSidebar();
    await vi.waitFor(() => expect(wrapper.find('.session-item').exists()).toBe(true));

    await wrapper.get('.session-item').trigger('contextmenu');
    const pinTrigger = document.body.querySelector<HTMLButtonElement>('.pin-session-btn');
    const choicesMenu = document.body.querySelector<HTMLElement>('.pin-group-choices');
    expect(pinTrigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(choicesMenu?.parentElement?.classList.contains('pin-group-submenu')).toBe(true);

    const choices = Array.from(choicesMenu!.querySelectorAll<HTMLButtonElement>('button'));
    expect(choices.find((button) => button.textContent?.includes('Default'))?.getAttribute('aria-checked')).toBe('true');
    choices.find((button) => button.textContent?.includes('Important'))!.click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/pin', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ groupId: 'important', profileId: 'default' }),
    })));
  });

});
