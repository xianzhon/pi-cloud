import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiTokensPanel from './ApiTokensPanel.vue';
import ConfirmModal from './ConfirmModal.vue';

const request = vi.hoisted(() => vi.fn());
vi.mock('../services/apiClient', () => ({ apiRequest: request, getApiErrorMessage: (error: Error) => error.message }));
vi.mock('../composables/useToasts', () => ({ useToasts: () => ({ showToast: vi.fn() }) }));
let wrapper: VueWrapper;
beforeEach(() => { request.mockReset(); request.mockResolvedValue({ tokens: [] }); });
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals(); });

describe('API token settings', () => {
  it('creates a named expiring token, confirms credentials and shows the secret once', async () => {
    wrapper = mount(ApiTokensPanel, { props: { totpEnabled: true }, global: { stubs: { Teleport: true } } });
    await flushPromises();
    request.mockResolvedValueOnce({ token: 'pic_pat_secret' }).mockResolvedValueOnce({ tokens: [] });
    await wrapper.find('header button').trigger('click');
    const inputs = wrapper.findAll('input');
    await inputs[0].setValue('Notes');
    await inputs[2].setValue('password');
    await inputs[3].setValue('123456');
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm');
    await flushPromises();
    expect(request).toHaveBeenCalledWith('/api/auth/tokens', expect.objectContaining({ method: 'POST', handleUnauthorized: false, body: expect.objectContaining({ name: 'Notes', password: 'password', totpCode: '123456', expiresAt: expect.any(String) }) }));
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('pic_pat_secret');
    expect(wrapper.emitted('updated')).toHaveLength(1);
    await wrapper.findAll('.token-secret button')[1].trigger('click');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('requires confirmation before revoking and sends password authentication', async () => {
    request.mockResolvedValueOnce({ tokens: [{ id: 'id-1', name: 'Notes', prefix: 'pic_pat_123', expiresAt: '2030-01-01', lastUsedAt: null }] });
    wrapper = mount(ApiTokensPanel, { props: { totpEnabled: false }, global: { stubs: { Teleport: true } } });
    await flushPromises();
    await wrapper.find('.token-row button').trigger('click');
    expect(request).toHaveBeenCalledTimes(1);
    await wrapper.find('input[type="password"]').setValue('password');
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm');
    await flushPromises();
    expect(request).toHaveBeenCalledWith('/api/auth/tokens/id-1', { method: 'DELETE', handleUnauthorized: false, body: { password: 'password', totpCode: '' } });
  });

  it('keeps the dialog open on authentication failure', async () => {
    wrapper = mount(ApiTokensPanel, { props: { totpEnabled: false }, global: { stubs: { Teleport: true } } });
    await flushPromises();
    request.mockRejectedValueOnce(new Error('Invalid password'));
    await wrapper.find('header button').trigger('click');
    await wrapper.find('input').setValue('Notes');
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('Invalid password');
    expect(wrapper.findComponent(ConfirmModal).props('visible')).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
  });
});
