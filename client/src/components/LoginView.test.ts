import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView.vue';
import { resetAuthForTests } from '../composables/useAuth';

describe('LoginView', () => {
  beforeEach(() => {
    resetAuthForTests();
    vi.restoreAllMocks();
  });

  it('submits username and password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: true, user: { username: 'me', totpEnabled: false } }) })));
    const wrapper = mount(LoginView);

    await wrapper.find('input[name="username"]').setValue('me');
    await wrapper.find('input[name="password"]').setValue('secret');
    await wrapper.find('form').trigger('submit.prevent');

    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('shows totp field after challenge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: false, requires2fa: true }) })));
    const wrapper = mount(LoginView);

    await wrapper.find('input[name="username"]').setValue('me');
    await wrapper.find('input[name="password"]').setValue('secret');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('input[name="totpCode"]').exists()).toBe(true);
  });
});
