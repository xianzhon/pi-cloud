import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, computed } from 'vue';
import App from './App.vue';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));

vi.mock('./composables/useWebSocket', () => ({
  useWebSocket: () => ({ isConnected: ref(false), clientId: 'client-1', on: () => () => {} }),
}));

const authenticated = ref(false);
const loading = ref(false);
const user = ref<{ username: string; totpEnabled: boolean } | null>(null);
const sessionExpiresAt = ref<string | null>(null);
const refresh = vi.fn();
const logout = vi.fn();
const loadSkills = vi.fn(async () => {});
const loadPresets = vi.fn(async () => {});

vi.mock('./composables/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: computed(() => authenticated.value),
    loading,
    user,
    sessionExpiresAt,
    refresh,
    logout,
  }),
}));

vi.mock('./composables/useAvailableSkills', () => ({
  useAvailableSkills: () => ({ skills: ref([]), loadSkills }),
}));

vi.mock('./composables/useSkillPresets', () => ({
  useSkillPresets: () => ({
    presets: ref([]),
    loadPresets,
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
  }),
}));

vi.mock('./components/LoginView.vue', () => ({ default: { template: '<div class="login-stub">login</div>' } }));
vi.mock('./components/SettingsDialog.vue', () => ({
  default: {
    props: ['visible', 'totpEnabled'],
    template: '<div v-if="visible" class="settings-stub">settings {{ totpEnabled ? "enabled" : "disabled" }}</div>',
  },
}));
vi.mock('./components/SessionSidebar.vue', () => ({
  default: {
    emits: ['open-settings'],
    template: '<aside><button aria-label="Settings" @click="$emit(\'open-settings\')">settings</button></aside>',
  },
}));
vi.mock('./components/ChatPanel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./components/TerminalPanel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./components/EditorPanel.vue', () => ({ default: { template: '<div />' } }));

describe('App auth gate', () => {
  beforeEach(() => {
    authenticated.value = false;
    loading.value = false;
    user.value = null;
    sessionExpiresAt.value = null;
    refresh.mockReset();
    logout.mockReset();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows login view when unauthenticated', () => {
    authenticated.value = false;
    loading.value = false;
    user.value = null;

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });

    expect(wrapper.find('.login-stub').exists()).toBe(true);
    expect(wrapper.find('.app').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows settings dialog when authenticated user opens settings', async () => {
    authenticated.value = true;
    loading.value = false;
    user.value = { username: 'me', totpEnabled: false };

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });
    await wrapper.find('[aria-label="Settings"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.settings-stub').exists()).toBe(true);
    expect(wrapper.find('.settings-stub').text()).toContain('disabled');
    wrapper.unmount();
  });

  it('refreshes authentication before the returned session expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
    authenticated.value = true;
    loading.value = false;
    user.value = { username: 'me', totpEnabled: false };
    sessionExpiresAt.value = new Date(Date.now() + 10_000).toISOString();
    refresh.mockResolvedValue(undefined);

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });
    await flushPromises();
    refresh.mockClear();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('does not schedule an auth refresh without a session expiry', async () => {
    vi.useFakeTimers();
    authenticated.value = true;
    loading.value = false;
    user.value = { username: 'me', totpEnabled: false };
    sessionExpiresAt.value = null;
    refresh.mockResolvedValue(undefined);

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });
    await flushPromises();
    refresh.mockClear();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(refresh).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('reschedules auth refreshes with the latest returned expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
    authenticated.value = true;
    loading.value = false;
    user.value = { username: 'me', totpEnabled: false };
    sessionExpiresAt.value = new Date(Date.now() + 10_000).toISOString();
    refresh.mockResolvedValue(undefined);

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });
    await flushPromises();
    refresh.mockClear();
    refresh.mockImplementationOnce(async () => {
      sessionExpiresAt.value = new Date(Date.now() + 20_000).toISOString();
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it('does not leave an auth refresh timer after unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
    authenticated.value = true;
    loading.value = false;
    user.value = { username: 'me', totpEnabled: false };
    sessionExpiresAt.value = new Date(Date.now() + 10_000).toISOString();
    refresh.mockResolvedValue(undefined);

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });
    await flushPromises();
    refresh.mockClear();
    wrapper.unmount();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not reschedule auth refresh when an in-flight refresh resolves after unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
    authenticated.value = true;
    loading.value = false;
    user.value = { username: 'me', totpEnabled: false };
    sessionExpiresAt.value = new Date(Date.now() + 10_000).toISOString();
    let resolveRefresh: (() => void) | undefined;
    refresh.mockImplementation(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } });
    wrapper.unmount();
    resolveRefresh?.();
    await flushPromises();
    refresh.mockClear();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
