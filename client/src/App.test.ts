import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import App from './App.vue';

const push = vi.fn();
const replace = vi.fn();
const route = reactive<{
  params: { id?: string };
  path: string;
  query: Record<string, string>;
}>({ params: { id: 'session-1' }, path: '/sessions/session-1', query: {} });

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => route,
}));

const isConnected = ref(true);
vi.mock('./composables/useWebSocket', () => ({
  useWebSocket: () => ({ isConnected, clientId: 'client-1' }),
}));

const memoryCounts = ref({ globalPending: 0 });
const memoryError = ref<string | null>(null);
const memoryWarning = ref<string | null>(null);
const memoryToast = ref(null);
const memorySetContext = vi.fn();
const memoryLoadCounts = vi.fn(async () => {});
const memoryExtractSession = vi.fn(async () => {});
vi.mock('./composables/useMemories', () => ({
  useMemories: () => ({
    counts: memoryCounts,
    error: memoryError,
    warning: memoryWarning,
    toast: memoryToast,
    setContext: memorySetContext,
    loadCounts: memoryLoadCounts,
    extractSession: memoryExtractSession,
    undoExtraction: vi.fn(),
    dismissToast: vi.fn(),
  }),
}));

const authUser = ref({ username: 'me', totpEnabled: false });
const authLoading = ref(false);
const showHintInfo = ref(true);
const showCodeBlockLanguageHeaders = ref(true);
const streamingMessageBehavior = ref<'steer' | 'followUp'>('steer');
const editorAutoRefresh = ref(false);
const confirmSessionDelete = ref(true);
const newSessionShortcut = ref<'ctrlAltN' | 'ctrlMetaN' | 'disabled'>('ctrlMetaN');
const fullscreenShortcut = ref<'f11' | 'ctrlShiftF'>('f11');
const showGoToTopButton = ref(true);
const showChatViewOptionsButton = ref(true);
const theme = ref<'light' | 'dark' | 'system'>('system');
const language = ref<'en' | 'zh-CN'>('en');
const soundNotification = ref<'off' | 'beep' | 'chime' | 'ding'>('beep');
const refresh = vi.fn();
const loadPreferences = vi.fn();
const loadSkills = vi.fn(async () => {});
const loadPresets = vi.fn(async () => {});
const createPreset = vi.fn(async () => {});
const updatePreset = vi.fn(async () => {});
const deletePreset = vi.fn(async () => {});
const {
  editorOpenFile,
  submitExternalPrompt,
  heavyModuleLoads,
} = vi.hoisted(() => ({
  editorOpenFile: vi.fn(),
  submitExternalPrompt: vi.fn(async () => true),
  heavyModuleLoads: {
    editor: 0,
    gitHistory: 0,
    memory: 0,
    settings: 0,
    tasks: 0,
    terminalPanel: 0,
    terminalRuntime: 0,
  },
}));
const setShowHintInfo = vi.fn((value: boolean) => {
  showHintInfo.value = value;
});
const setShowCodeBlockLanguageHeaders = vi.fn((value: boolean) => {
  showCodeBlockLanguageHeaders.value = value;
});
const setStreamingMessageBehavior = vi.fn((value: 'steer' | 'followUp') => {
  streamingMessageBehavior.value = value;
});
const setEditorAutoRefresh = vi.fn((value: boolean) => {
  editorAutoRefresh.value = value;
});
const setConfirmSessionDelete = vi.fn((value: boolean) => {
  confirmSessionDelete.value = value;
});
const setNewSessionShortcut = vi.fn((value: 'ctrlAltN' | 'ctrlMetaN' | 'disabled') => {
  newSessionShortcut.value = value;
});
const setFullscreenShortcut = vi.fn((value: 'f11' | 'ctrlShiftF') => {
  fullscreenShortcut.value = value;
});
const setShowGoToTopButton = vi.fn((value: boolean) => {
  showGoToTopButton.value = value;
});
const setShowChatViewOptionsButton = vi.fn((value: boolean) => {
  showChatViewOptionsButton.value = value;
});
const setTheme = vi.fn((value: 'light' | 'dark' | 'system') => {
  theme.value = value;
});
const setLanguage = vi.fn((value: 'en' | 'zh-CN') => {
  language.value = value;
});
const setSoundNotification = vi.fn((value: 'off' | 'beep' | 'chime' | 'ding') => {
  soundNotification.value = value;
});
vi.mock('./composables/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: computed(() => true),
    loading: authLoading,
    user: authUser,
    refresh,
    logout: vi.fn(),
  }),
}));

vi.mock('./composables/usePreferences', () => ({
  usePreferences: () => ({
    showHintInfo,
    showCodeBlockLanguageHeaders,
    streamingMessageBehavior,
    editorAutoRefresh,
    confirmSessionDelete,
    newSessionShortcut,
    fullscreenShortcut,
    showGoToTopButton,
    showChatViewOptionsButton,
    theme,
    language,
    soundNotification,
    loadPreferences,
    setShowHintInfo,
    setShowCodeBlockLanguageHeaders,
    setStreamingMessageBehavior,
    setEditorAutoRefresh,
    setConfirmSessionDelete,
    setNewSessionShortcut,
    setFullscreenShortcut,
    setShowGoToTopButton,
    setShowChatViewOptionsButton,
    setTheme,
    setLanguage,
    setSoundNotification,
  }),
}));

vi.mock('./composables/useAvailableSkills', () => ({
  useAvailableSkills: () => ({ skills: ref([]), loadSkills }),
}));

vi.mock('./composables/useSkillPresets', () => ({
  useSkillPresets: () => ({
    presets: ref([]),
    loadPresets,
    createPreset,
    updatePreset,
    deletePreset,
  }),
}));

vi.mock('./components/ChatPanel.vue', () => ({
  default: {
    props: ['sessionId', 'ensureSession', 'showHintInfo', 'clientId', 'showGoToTopButton', 'showChatViewOptionsButton'],
    methods: { focusInput: vi.fn(), submitExternalPrompt },
    template: '<button class="stub-ensure" :data-session-id="sessionId || \'\'" :data-show-hint-info="String(showHintInfo)" :data-client-id="clientId" :data-show-go-to-top="String(showGoToTopButton)" :data-show-view-options="String(showChatViewOptionsButton)" @click="ensureSession?.(undefined, \'first prompt\')">ensure</button>',
  },
}));
vi.mock('./components/TerminalPanel.vue', () => {
  heavyModuleLoads.terminalPanel += 1;
  return { __esModule: true, default: { props: ['visible'], template: '<div class="terminal-panel-stub" :data-visible="String(visible)" />' } };
});
vi.mock('./components/EditorPanel.vue', () => ({
  __esModule: true,
  default: (() => {
    heavyModuleLoads.editor += 1;
    return {
      name: 'EditorPanel',
      props: ['visible'],
      methods: { openFile: editorOpenFile },
      template: '<div class="editor-panel-stub" :data-visible="String(visible)" />',
    };
  })(),
}));
vi.mock('./components/TaskQueuePanel.vue', () => {
  heavyModuleLoads.tasks += 1;
  return { __esModule: true, default: { props: ['visible'], template: '<div class="task-queue-panel" :class="{ visible }" />' } };
});
vi.mock('./components/NewSessionDialog.vue', () => ({
  default: {
    props: ['visible'],
    emits: ['close', 'create'],
    template: `
      <section v-if="visible" class="new-session-dialog-stub">
        <button class="new-session-create-stub" @click="$emit('create', { cwd: '/workspace', enabledSkills: ['systematic-debugging'] })">create</button>
        <button class="new-session-close-stub" @click="$emit('close')">close</button>
      </section>
    `,
  },
}));

vi.mock('./components/GitHistoryView.vue', () => ({
  __esModule: true,
  default: (() => {
    heavyModuleLoads.gitHistory += 1;
    return {
      name: 'GitHistoryView',
      props: ['visible', 'cwd'],
      emits: ['close'],
      template: '<section v-if="visible" class="git-history-dialog" />',
    };
  })(),
}));

vi.mock('./components/MemoryCenter.vue', () => ({
  __esModule: true,
  default: (() => {
    heavyModuleLoads.memory += 1;
    return {
      name: 'MemoryCenter',
      props: ['visible', 'controller'],
      emits: ['close', 'openSession'],
      template: '<section v-if="visible" class="memory-center-stub" />',
    };
  })(),
}));

vi.mock('./components/MemoryToast.vue', () => ({
  default: { props: ['toast'], template: '<section />' },
}));

vi.mock('./components/SettingsDialog.vue', () => ({
  __esModule: true,
  default: (() => {
    heavyModuleLoads.settings += 1;
    return {
      props: ['visible', 'totpEnabled', 'showHintInfo'],
      emits: ['close', 'updated', 'update:showHintInfo'],
      template: `
        <section v-if="visible" class="settings-dialog-stub">
          <span class="totp-enabled">{{ totpEnabled ? 'enabled' : 'disabled' }}</span>
          <span class="hint-info-state">{{ showHintInfo ? 'hints shown' : 'hints hidden' }}</span>
          <button class="settings-close-stub" @click="$emit('close')">close</button>
          <button class="settings-updated-stub" @click="$emit('updated')">updated</button>
          <button class="settings-hint-toggle-stub" @click="$emit('update:showHintInfo', false)">hide hints</button>
        </section>
      `,
    };
  })(),
}));

vi.mock('./composables/useTerminal', () => {
  heavyModuleLoads.terminalRuntime += 1;
  return {
    createTerminalInstance: vi.fn(() => ({ terminal: { options: {} } })),
    openTerminal: vi.fn(),
    fitTerminal: vi.fn(),
    connectTerminal: vi.fn(),
    disconnectTerminal: vi.fn(),
    disposeTerminal: vi.fn(),
    applyTerminalTheme: vi.fn(),
  };
});

describe('App routing', () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    replace.mockImplementation(async (location: { path: string; query: Record<string, string> }) => {
      route.path = location.path;
      route.query = location.query;
    });
    submitExternalPrompt.mockClear();
    isConnected.value = true;
    refresh.mockClear();
    loadPreferences.mockClear();
    setShowHintInfo.mockClear();
    setShowCodeBlockLanguageHeaders.mockClear();
    setStreamingMessageBehavior.mockClear();
    setEditorAutoRefresh.mockClear();
    setConfirmSessionDelete.mockClear();
    setNewSessionShortcut.mockClear();
    setShowGoToTopButton.mockClear();
    setShowChatViewOptionsButton.mockClear();
    setTheme.mockClear();
    setLanguage.mockClear();
    loadSkills.mockClear();
    loadPresets.mockClear();
    createPreset.mockClear();
    updatePreset.mockClear();
    deletePreset.mockClear();
    editorOpenFile.mockClear();
    memorySetContext.mockClear();
    memoryLoadCounts.mockClear();
    memoryExtractSession.mockClear();
    memoryCounts.value = { globalPending: 0 };
    memoryError.value = null;
    memoryWarning.value = null;
    memoryToast.value = null;
    showHintInfo.value = true;
    showCodeBlockLanguageHeaders.value = true;
    confirmSessionDelete.value = true;
    streamingMessageBehavior.value = 'steer';
    editorAutoRefresh.value = false;
       newSessionShortcut.value = 'ctrlMetaN';
    showGoToTopButton.value = true;
    showChatViewOptionsButton.value = true;
    theme.value = 'system';
    language.value = 'en';
    authUser.value = { username: 'me', totpEnabled: false };
    document.title = 'Pi WebUI';
    sessionStorage.clear();
    route.params.id = 'session-1';
    route.path = '/sessions/session-1';
    route.query = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [{ id: 'session-1', cwd: '/workspace' }] }) };
      }
      return { json: async () => ({}) };
    }));
  });

  it('does not load opt-in feature modules during application startup', async () => {
    expect(heavyModuleLoads).toEqual({
      editor: 0,
      gitHistory: 0,
      memory: 0,
      settings: 0,
      tasks: 0,
      terminalPanel: 0,
      terminalRuntime: 0,
    });

    const wrapper = mount(App);
    await flushPromises();

    expect(heavyModuleLoads).toEqual({
      editor: 0,
      gitHistory: 0,
      memory: 0,
      settings: 0,
      tasks: 0,
      terminalPanel: 0,
      terminalRuntime: 0,
    });

    wrapper.unmount();
  });

  const preloadErrorStubs = {
    ChatPanel: true,
    TerminalPanel: true,
    EditorPanel: true,
    FolderPickerModal: true,
    Teleport: true,
  };

  it('shows the custom confirmation dialog when a lazy chunk cannot load', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { stubs: preloadErrorStubs },
    });
    await flushPromises();
    const preloadError = new Event('vite:preloadError', { cancelable: true });

    window.dispatchEvent(preloadError);
    await flushPromises();

    const modal = wrapper.get('.confirm-modal');
    const modalText = modal.text();
    expect(preloadError.defaultPrevented).toBe(true);
    expect(modalText).toContain('Update available');
    expect(modalText).toContain('A new version of Pi WebUI is available. Reload now?');

    await modal.get('.btn-cancel').trigger('click');
    expect(wrapper.find('.confirm-modal').exists()).toBe(false);
    wrapper.unmount();
  });

  it('reloads from the custom confirmation dialog after a lazy chunk failure', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { stubs: preloadErrorStubs },
    });
    await flushPromises();

    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await flushPromises();
    await wrapper.get('.confirm-modal .btn-confirm').trigger('click');

    expect(reload).toHaveBeenCalledOnce();
    wrapper.unmount();
    reload.mockRestore();
  });

  it('waits for the socket and sidebar before submitting a new-tab queued task', async () => {
    const SessionSidebarStub = defineComponent({
      emits: ['initialized'],
      setup(_props, { emit, expose }) {
        expose({ switchToProjectPath: vi.fn(async () => {}) });
        return () => h('button', { class: 'sidebar-initialize', onClick: () => emit('initialized') });
      },
    });
    isConnected.value = false;
    route.query = { startTask: 'task-1', project: '/workspace' };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      if (url === '/api/tasks/task-1/start') {
        return {
          ok: true,
          json: async () => ({
            task: { id: 'task-1', projectPath: '/workspace' },
            sessionId: 'task-session',
            prompt: 'Implement the queued task',
          }),
        } as Response;
      }
      if (url === '/api/sessions/project-path') return { json: async () => ({ projectPath: '/workspace' }) } as Response;
      if (String(url).startsWith('/api/sessions')) return { json: async () => ({ sessions: [] }) } as Response;
      return { json: async () => ({}) } as Response;
    });

    const wrapper = mount(App, {
      global: {
        stubs: {
          SessionSidebar: SessionSidebarStub,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalledWith('/api/tasks/task-1/start', expect.anything());

    isConnected.value = true;
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1' }),
    }));
    expect(submitExternalPrompt).not.toHaveBeenCalled();

    await wrapper.get('.sidebar-initialize').trigger('click');
    await flushPromises();

    expect(submitExternalPrompt).toHaveBeenCalledWith('Implement the queued task');
  });

  it('deletes a session immediately when delete confirmation is disabled', async () => {
    confirmSessionDelete.value = false;
    const fetchMock = vi.mocked(fetch);
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true }) } as Response);

    expect(wrapper.findComponent({ name: 'SessionSidebar' }).props('confirmSessionDelete')).toBe(false);
    await wrapper.get('.header-actions .delete-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.confirm-modal').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1?clientId=client-1', { method: 'DELETE' });
    expect(push).toHaveBeenCalledWith('/sessions');
  });

  it('clears the active route and chat when the sidebar deletes that session', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();
    push.mockImplementationOnce(() => {
      route.params.id = undefined;
    });

    wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('sessionDeleted', 'session-1');
    await flushPromises();

    expect(push).toHaveBeenCalledWith('/sessions');
    expect(wrapper.get('.stub-ensure').attributes('data-session-id')).toBe('');
  });

  it('keeps global actions in a permanent desktop utility rail beside the session panel', async () => {
    localStorage.setItem('pi-webui-sidebar-collapsed', 'false');
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('.app-utility-rail').exists()).toBe(true);
    expect(wrapper.find('.app-utility-rail .sidebar-logo').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'SessionSidebar' }).props('collapsed')).toBe(false);
    expect(wrapper.find('.header-actions > .sidebar-toggle-btn').exists()).toBe(false);
    expect(wrapper.find('.header-actions > .search-btn').exists()).toBe(false);
    expect(wrapper.get('.header-actions > .title-new-btn').classes()).toContain('mobile-title-new-btn');
    expect(wrapper.find('.utility-rail-bottom [data-rail-action="terminal"]').exists()).toBe(true);
    expect(wrapper.find('.utility-rail-bottom [data-rail-action="git"]').exists()).toBe(true);
    expect(wrapper.find('.utility-rail-bottom [data-rail-action="theme"]').exists()).toBe(true);
    expect(wrapper.find('.app-utility-rail [data-rail-action="tasks"]').exists()).toBe(false);
    expect(wrapper.find('.app-utility-rail [data-rail-action="editor"]').exists()).toBe(false);
    expect(wrapper.find('.header-actions > [data-header-action="tasks"]').exists()).toBe(true);
    expect(wrapper.find('.header-actions > [data-header-action="editor"]').exists()).toBe(true);

    const railActions = wrapper.findAll('.app-utility-rail [data-rail-action]');
    expect(railActions).toHaveLength(8);
    railActions.forEach((action) => {
      expect(action.classes()).toContain('tooltip');
      expect(action.attributes('data-tooltip')).toBeTruthy();
    });

    await wrapper.find('.app-utility-rail [data-rail-action="expand"]').trigger('click');
    expect(wrapper.findComponent({ name: 'SessionSidebar' }).props('collapsed')).toBe(true);
    expect(wrapper.find('.app-utility-rail').exists()).toBe(true);

    wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('sessionsChanged', [
      { id: 'session-chinese', path: '/workspace', cwd: '/workspace', title: '项目讨论' },
      { id: 'session-english', path: '/workspace', cwd: '/workspace', title: 'check tests' },
    ]);
    await wrapper.vm.$nextTick();

    const compactSessions = wrapper.findAll('.utility-rail-session');
    expect(compactSessions.map((item) => item.text())).toEqual(['项', 'C']);
    expect(compactSessions[0].attributes('title')).toBe('项目讨论');

    await compactSessions[0].trigger('click');
    expect(push).toHaveBeenLastCalledWith({
      path: '/sessions/session-chinese',
      query: { project: '/workspace' },
    });
  });

  it('shows the Git tool by default and dispatches toolbar actions through the chat composer', async () => {
    localStorage.setItem('pi-webui-sidebar-collapsed', 'false');
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (String(url).startsWith('/api/git/status')) {
        return { ok: true, status: 200, json: async () => ({ files: [{ status: 'M', path: 'src/app.ts' }] }) } as Response;
      }
      if (url === '/api/sessions/project-path') return { json: async () => ({ projectPath: '/workspace' }) } as Response;
      if (String(url).startsWith('/api/sessions')) return { json: async () => ({ sessions: [{ id: 'session-1', cwd: '/workspace' }] }) } as Response;
      return { json: async () => ({}) } as Response;
    });
    const wrapper = mount(App, {
      global: { stubs: { TerminalPanel: true, EditorPanel: true, FolderPickerModal: true, Teleport: true } },
    });
    await flushPromises();

    expect(wrapper.findComponent({ name: 'SessionSidebar' }).props('collapsed')).toBe(false);
    expect(wrapper.find('.git-tool-panel').exists()).toBe(true);
    expect(wrapper.get('[data-rail-action="git"]').classes()).toContain('active');

    await wrapper.get('.git-tool-action[aria-label="Show diff"]').trigger('click');
    expect(submitExternalPrompt).toHaveBeenCalledWith('/diff', { hideCommandMessage: true });

    await wrapper.get('.git-tool-action[aria-label="History"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.git-history-dialog').exists()).toBe(true);
  });

  it('opens the session context menu from the collapsed utility rail', async () => {
    localStorage.setItem('pi-webui-sidebar-collapsed', 'true');
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    const compactSession = wrapper.get('.utility-rail-session');
    await compactSession.trigger('contextmenu', { clientX: 20, clientY: 30 });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.session-context-menu').exists()).toBe(true);
  });

  it('passes clientId into SessionSidebar so it can sync the selected agent profile', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.findComponent({ name: 'SessionSidebar' }).props('clientId')).toBe('client-1');
  });

  it('opens Memory Center from the utility rail and provides the active context', async () => {
    memoryCounts.value = { globalPending: 3 };
    const wrapper = mount(App, {
      global: {
        stubs: { ChatPanel: true, TerminalPanel: true, EditorPanel: true, FolderPickerModal: true, Teleport: true },
      },
    });

    await flushPromises();

    expect(memorySetContext).toHaveBeenCalledWith({
      profileId: 'default',
      projectPath: '/workspace',
      sessionId: 'session-1',
    });
    expect(wrapper.get('[data-rail-action="memory"] .memory-pending-badge').text()).toBe('3');
    await wrapper.get('[data-rail-action="memory"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.memory-center-stub').exists()).toBe(true);
  });

  it('passes clientId into ChatPanel so slash commands can load session-aware skills', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('.stub-ensure').attributes('data-client-id')).toBe('client-1');
  });

  it('toggles the task queue with Ctrl+Q while keeping the title plus button for new sessions', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    expect(wrapper.find('.task-queue-panel').exists()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, code: 'KeyQ', key: 'q', cancelable: true }));
    await flushPromises();

    expect(wrapper.get('[data-header-action="tasks"]').classes()).toContain('active');
    expect(wrapper.find('.title-new-btn').attributes('aria-label')).toBe('New Session');

    await wrapper.find('.title-new-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.new-session-dialog-stub').exists()).toBe(true);
  });

  it('keeps the active session route when the sidebar loads the initial project path', async () => {
    mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(push).not.toHaveBeenCalledWith('/sessions');
  });

  it('sets the browser title to the session name', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/Users/me/projects/fallback' }) };
      }
      if (String(url).includes('/api/sessions/session-1/summary')) {
        return { json: async () => ({ id: 'session-1', name: 'Debug bug', cwd: '/Users/me/projects/my-project' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(document.title).toBe('Debug bug - default');
  });

  it('shows the current git branch for the active session cwd in the header', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions/git-status')) {
        return { ok: true, json: async () => ({ isGitRepo: true, branch: 'feature/a', detached: false }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [{ id: 'session-1', cwd: '/workspace' }] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('.git-branch-pill').text()).toContain('feature/a');
  });

  it('shows the first prompt and project path in the header immediately after creating a session', async () => {
    route.params.id = undefined;
    push.mockImplementation((location: string | { path?: string }) => {
      const path = typeof location === 'string' ? location : location.path || '';
      route.params.id = path.match(/^\/sessions\/(.+)$/)?.[1];
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (url === '/api/sessions' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true, sessionId: 'new-session-1' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.find('.stub-ensure').trigger('click');
    await flushPromises();

    expect(wrapper.find('.header-title').text()).toContain('first prompt');
    expect(wrapper.find('.session-cwd').text()).toContain('workspace');
    expect(wrapper.find('.session-cwd').attributes('title')).toBe('/workspace');
    expect(wrapper.find('.header-title').text()).not.toContain('new-sess');
  });

  it('shows the selected project path in the header when no session is active', async () => {
    route.params.id = undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('.session-cwd').text()).toContain('workspace');
    expect(wrapper.find('.session-cwd').attributes('title')).toBe('/workspace');
  });

  it('shows the review source label and search icon when a review profile is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('reviewSourceSelected', 'devin', 'Devin');
    await flushPromises();

    const agentPill = wrapper.find('.agent-pill');
    expect(agentPill.text()).toContain('Devin');
    expect(agentPill.findComponent({ name: 'PhMagnifyingGlass' }).exists()).toBe(true);
    expect(agentPill.findComponent({ name: 'PhRobot' }).exists()).toBe(false);
  });

  it('routes a selected review session with its source profile and project path', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('reviewSourceSelected', 'devin', 'Devin');
    wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('projectPathChanged', '/devin/project', { initial: true });
    wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('reviewSessionSelected', { sourceId: 'devin', sessionId: 'review-1' });

    expect(push).toHaveBeenLastCalledWith({
      path: '/sessions/review-1',
      query: { profile: 'devin', project: '/devin/project' },
    });
  });

  it('switches review sessions from the collapsed utility rail', async () => {
    localStorage.setItem('pi-webui-sidebar-collapsed', 'true');
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    const sidebar = wrapper.findComponent({ name: 'SessionSidebar' });
    sidebar.vm.$emit('projectPathChanged', '/devin/project', { initial: true });
    sidebar.vm.$emit('reviewSessionSelected', { sourceId: 'devin', sessionId: 'review-1' });
    sidebar.vm.$emit('sessionsChanged', [
      { id: 'review-1', path: '/review-1.jsonl', cwd: '/devin/project', title: 'First review' },
      { id: 'review-2', path: '/review-2.jsonl', cwd: '/devin/project', title: 'Second review' },
    ]);
    await wrapper.vm.$nextTick();
    push.mockClear();

    await wrapper.findAll('.utility-rail-session')[1].trigger('click');

    expect(push).toHaveBeenCalledWith({
      path: '/sessions/review-2',
      query: { profile: 'devin', project: '/devin/project' },
    });
    expect(sidebar.props('activeReviewSessionId')).toBe('review-2');
  });

  it('shows worktree and Pi history cleanup targets before finishing a worktree session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions/session-1/finish-worktree-preview')) {
        return {
          ok: true,
          json: async () => ({
            worktreePath: '/repo/.app-worktrees/feature-a',
            baseRepoPath: '/repo/app',
            history: {
              sourcePath: '/Users/me/.pi/agent/sessions/--worktree--/timestamp_session-1.jsonl',
              destinationPath: '/Users/me/.pi/agent/sessions/--base--/timestamp_session-1.jsonl',
              sourceExists: true,
            },
          }),
        };
      }
      if (String(url).includes('/api/sessions/session-1/summary')) {
        return {
          json: async () => ({
            id: 'session-1',
            cwd: '/repo/.app-worktrees/feature-a',
            worktree: {
              sessionId: 'session-1',
              baseRepoPath: '/repo/app',
              worktreePath: '/repo/.app-worktrees/feature-a',
              branchName: 'feature/a',
              branchMode: 'new',
              worktreeManaged: true,
              worktreeStatus: 'active',
            },
          }),
        };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.find('[data-tooltip="Finish worktree session"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('commit your worktree changes and push the branch to the remote');
    expect(wrapper.text()).toContain('merge the branch after pushing');
    expect(wrapper.text()).toContain('Remove Git worktree');
    expect(wrapper.text()).toContain('/repo/.app-worktrees/feature-a');
    expect(wrapper.text()).toContain('Move Pi session history');
    expect(wrapper.text()).toContain('/Users/me/.pi/agent/sessions/--worktree--/timestamp_session-1.jsonl');
    expect(wrapper.text()).toContain('/Users/me/.pi/agent/sessions/--base--/timestamp_session-1.jsonl');
    expect(wrapper.text()).toContain('Rewrite session cwd');
  });

  it('opens the new session dialog and creates it with the selected profile and skills', async () => {
    route.params.id = undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).startsWith('/api/sessions/agent-profile?')) {
        return { json: async () => ({ profile: { id: 'work', label: 'work (~/.pi/work)' } }) };
      }
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions/skills')) {
        return { json: async () => ({ skills: [{ name: 'systematic-debugging', description: '...' }] }) };
      }
      if (url === '/api/auth/skill-presets') {
        return { json: async () => ({ presets: [] }) };
      }
      if (url === '/api/sessions' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true, sessionId: 'new-session-1' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.find('.title-new-btn').trigger('click');
    await flushPromises();
    expect(wrapper.find('.new-session-dialog-stub').exists()).toBe(true);

    await wrapper.find('.new-session-create-stub').trigger('click');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', cwd: '/workspace', agentProfileId: 'work', enabledSkills: ['systematic-debugging'] }),
    }));
  });

  it('opens settings from the header settings button', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    const settingsButton = wrapper.find('[aria-label="Settings"]');
    expect(settingsButton.exists()).toBe(true);
    expect(wrapper.find('[data-tooltip="Security"]').exists()).toBe(false);

    await settingsButton.trigger('click');
    await flushPromises();

    expect(wrapper.find('.settings-dialog-stub').exists()).toBe(true);
    expect(wrapper.find('.totp-enabled').text()).toBe('disabled');
    expect(wrapper.find('.hint-info-state').text()).toBe('hints shown');
  });

  it('switches directly between dark and light themes from the utility rail', async () => {
    theme.value = 'dark';
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();

    const themeButton = wrapper.find('[data-rail-action="theme"]');
    expect(themeButton.attributes('aria-label')).toBe('Switch to light theme');

    await themeButton.trigger('click');
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(themeButton.attributes('aria-label')).toBe('Switch to dark theme');
  });

  it('updates the app locale when the language preference changes', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();

    language.value = 'zh-CN';
    await flushPromises();

    expect(document.documentElement.lang).toBe('zh-CN');
    expect(wrapper.find('.search-btn').attributes('data-tooltip')).toBe('搜索 (⌘K)');
  });

  it('loads preferences and wires hint info state to chat and settings', async () => {
    showHintInfo.value = false;
    const wrapper = mount(App, {
      global: {
        stubs: {
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();

    expect(loadPreferences).toHaveBeenCalled();
    expect(wrapper.find('.stub-ensure').attributes('data-show-hint-info')).toBe('false');

    await wrapper.find('[aria-label="Settings"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.hint-info-state').text()).toBe('hints hidden');

    await wrapper.find('.settings-hint-toggle-stub').trigger('click');
    expect(setShowHintInfo).toHaveBeenCalledWith(false);
  });

  it('refreshes auth state when settings reports an update', async () => {
    authUser.value = { username: 'me', totpEnabled: true };
    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.find('[aria-label="Settings"]').trigger('click');
    await flushPromises();
    await wrapper.find('.settings-updated-stub').trigger('click');

    expect(refresh).toHaveBeenCalled();
  });

  it('opens a bare filename from the project root without a recursive search', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [{ id: 'session-1', cwd: '/workspace' }] }) };
      }
      if (String(url) === '/api/files/search?pattern=AGENTS.md&path=%2Fworkspace') {
        return { json: async () => ({ files: ['AGENTS.md'] }) };
      }
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    window.dispatchEvent(new CustomEvent('open-file-in-editor', {
      detail: { path: 'AGENTS.md', kind: 'filename' },
    }));
    await flushPromises();

    await vi.waitFor(() => expect(editorOpenFile).toHaveBeenCalledWith('/workspace/AGENTS.md', undefined, undefined));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/files/search?pattern=**%2FAGENTS.md&path=%2Fworkspace');
  });

  it('canonicalizes a bare filename resolved in a Windows workspace', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: 'D:\\develop\\project' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [{ id: 'session-1', cwd: 'D:\\develop\\project' }] }) };
      }
      if (String(url) === '/api/files/search?pattern=MyTT.py&path=D%3A%5Cdevelop%5Cproject') {
        return { json: async () => ({ files: ['MyTT.py'] }) };
      }
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    window.dispatchEvent(new CustomEvent('open-file-in-editor', {
      detail: { path: 'MyTT.py', kind: 'filename' },
    }));
    await flushPromises();

    await vi.waitFor(() => expect(editorOpenFile).toHaveBeenCalledWith('D:/develop/project/MyTT.py', undefined, undefined));
  });

  it('opens home-relative file paths without resolving them against the workspace', async () => {
    const fetchMock = vi.mocked(fetch);
    mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    window.dispatchEvent(new CustomEvent('open-file-in-editor', {
      detail: { path: '~/ai/260815-sshd-usepam-systemd-user-service.md', kind: 'path' },
    }));
    await flushPromises();

    await vi.waitFor(() => expect(editorOpenFile).toHaveBeenCalledWith('~/ai/260815-sshd-usepam-systemd-user-service.md', undefined, undefined));
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/files/search?'))).toBe(false);
  });

  it('falls back to suffix search for relative file paths that are not rooted at the workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [{ id: 'session-1', cwd: '/workspace' }] }) };
      }
      if (String(url) === '/api/files/search?pattern=src%2Findex.ts&path=%2Fworkspace') {
        return { json: async () => ({ files: [] }) };
      }
      if (String(url) === '/api/files/search?pattern=**%2Fsrc%2Findex.ts&path=%2Fworkspace') {
        return { json: async () => ({ files: ['server/src/index.ts'] }) };
      }
      return { json: async () => ({}) };
    }));

    mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    window.dispatchEvent(new CustomEvent('open-file-in-editor', {
      detail: { path: 'src/index.ts', kind: 'path' },
    }));
    await flushPromises();

    await vi.waitFor(() => expect(editorOpenFile).toHaveBeenCalledWith('/workspace/server/src/index.ts', undefined, undefined));
  });

  it('clears route state when the agent profile changes away from the active session store', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).includes('/api/sessions/session-1/summary')) {
        return { ok: false, status: 404, json: async () => ({ error: 'Session not found' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [{ id: 'session-1', cwd: '/workspace' }] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('agentProfileChanged', 'work');
    await flushPromises();

    expect(push).toHaveBeenCalledWith('/sessions');
  });

  it('renames the active session by double-clicking its navbar title', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/api/sessions/session-1/summary')) {
        return {
          ok: true,
          json: async () => ({ id: 'session-1', name: 'Original title', cwd: '/workspace' }),
        };
      }
      if (url === '/api/sessions/session-1/rename' && options?.method === 'PATCH') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.get('.session-title-text').trigger('dblclick');
    const input = wrapper.get('.session-title-input');
    await input.setValue('Renamed title');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/rename', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', name: 'Renamed title' }),
    });
    expect(wrapper.find('.session-title-input').exists()).toBe(false);
    expect(wrapper.get('.session-title-text').text()).toBe('Renamed title');
  });

  it('restores the active session title after initial agent profile sync on page refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (String(url).includes('/api/sessions/session-1/summary')) {
        return {
          ok: true,
          json: async () => ({
            id: 'session-1',
            firstMessage: 'refreshed session title',
            cwd: '/workspace',
          }),
        };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    expect(wrapper.find('.header-title').text()).toContain('refreshed session title');

    await wrapper.findComponent({ name: 'SessionSidebar' }).vm.$emit('agentProfileChanged', 'default');
    await flushPromises();

    expect(wrapper.find('.header-title').text()).toContain('refreshed session title');
    expect(wrapper.find('.session-cwd').text()).toContain('workspace');
  });

  it('updates the header title when the first prompt is sent after clicking new session', async () => {
    route.params.id = undefined;
    push.mockImplementation((location: string | { path?: string }) => {
      const path = typeof location === 'string' ? location : location.path || '';
      route.params.id = path.match(/^\/sessions\/(.+)$/)?.[1];
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sessions/project-path') {
        return { json: async () => ({ projectPath: '/workspace' }) };
      }
      if (url === '/api/sessions' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true, sessionId: 'new-session-1' }) };
      }
      if (String(url).startsWith('/api/sessions')) {
        return { json: async () => ({ sessions: [] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(App, {
      global: {
        stubs: {
          ChatPanel: true,
          TerminalPanel: true,
          EditorPanel: true,
          FolderPickerModal: true,
          Teleport: true,
        },
      },
    });

    await flushPromises();
    await wrapper.find('.title-new-btn').trigger('click');
    await flushPromises();
    await wrapper.find('.new-session-create-stub').trigger('click');
    await flushPromises();
    expect(wrapper.find('.header-title').text()).toContain('New Session');

    window.dispatchEvent(new CustomEvent('session-first-message', {
      detail: {
        id: 'new-session-1',
        firstMessage: 'prompt after plus new',
      },
    }));
    await flushPromises();

    expect(wrapper.find('.header-title').text()).toContain('prompt after plus new');
    expect(wrapper.find('.session-cwd').text()).toContain('workspace');
    expect(wrapper.find('.header-title').text()).not.toContain('New Session');
  });

  it('focuses the project selector with Ctrl+Alt+P', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { stubs: { TerminalPanel: true, EditorPanel: true, FolderPickerModal: true, Teleport: true } },
    });
    await flushPromises();

    const event = new KeyboardEvent('keydown', {
      code: 'KeyP',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    await vi.waitFor(() => {
      expect(wrapper.find('.project-path-input').attributes('placeholder')).toBe('Search projects…');
    });

    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
  });

  function dispatchCtrlE(target: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'e',
      code: 'KeyE',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  }

  it('toggles the editor with Ctrl+E while focus is in a text input', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { stubs: { TerminalPanel: true, FolderPickerModal: true, Teleport: true } },
    });
    await flushPromises();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    dispatchCtrlE(input);
    await flushPromises();

    expect(wrapper.get('[data-header-action="editor"]').classes()).toContain('active');

    input.remove();
    wrapper.unmount();
  });

  it('uses Ctrl+E only to toggle the editor from a selected message', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { stubs: { TerminalPanel: true, FolderPickerModal: true, Teleport: true } },
    });
    await flushPromises();

    const messageBlock = document.createElement('div');
    const messageKeydown = vi.fn();
    messageBlock.className = 'message-block is-selected';
    messageBlock.tabIndex = -1;
    messageBlock.addEventListener('keydown', messageKeydown);
    document.body.appendChild(messageBlock);
    messageBlock.focus();
    const event = dispatchCtrlE(messageBlock);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(messageKeydown).not.toHaveBeenCalled();
    expect(wrapper.get('[data-header-action="editor"]').classes()).toContain('active');

    messageBlock.remove();
    wrapper.unmount();
  });

});
