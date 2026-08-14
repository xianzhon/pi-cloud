import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecurityPanel from './SecurityPanel.vue';

describe('SecurityPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and displays audit events', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') {
        return { json: async () => ({ events: [{ id: 1, createdAt: '2026-06-03T00:00:00.000Z', type: 'login_success', status: 'success', ip: '127.0.0.1', metadata: {} }] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.text()).toContain('Login');
  });

  it('starts 2FA setup and shows QR code', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/2fa/setup') {
        return { json: async () => ({ secret: 'ABC', qrCodeDataUrl: 'data:image/png;base64,abc', otpauthUrl: 'otpauth://totp/x' }) };
      }
      if (url === '/api/auth/audit') return { json: async () => ({ events: [] }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await wrapper.find('.start-2fa').trigger('click');
    await flushPromises();

    expect(wrapper.find('img[alt="TOTP QR code"]').attributes('src')).toBe('data:image/png;base64,abc');
  });

  it('shows the standalone header and close button by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') return { json: async () => ({ events: [] }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.find('.security-header').exists()).toBe(true);
    expect(wrapper.find('.security-header button').text()).toBe('Close');
  });

  it('hides the standalone header when embedded in settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') return { json: async () => ({ events: [] }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false, embedded: true } });
    await flushPromises();

    expect(wrapper.find('.security-header').exists()).toBe(false);
    expect(wrapper.text()).toContain('Two-factor authentication');
    expect(wrapper.text()).toContain('Audit log');
  });

  it('paginates audit events 7 rows at a time', async () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      createdAt: `2026-06-03T00:${String(index).padStart(2, '0')}:00.000Z`,
      type: `event_${index + 1}`,
      status: 'success',
      ip: '127.0.0.1',
      metadata: {},
    }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') return { json: async () => ({ events }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(7);
    expect(wrapper.text()).toContain('Event 1');
    expect(wrapper.text()).not.toContain('Event 8');
    expect(wrapper.text()).not.toContain('Event 11');
    expect(wrapper.find('.audit-pagination').text()).toContain('Showing 1-7 of 12');
    expect(wrapper.find('.audit-prev').attributes('disabled')).toBeDefined();

    await wrapper.find('.audit-next').trigger('click');

    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(5);
    expect(wrapper.text()).toContain('Event 8');
    expect(wrapper.text()).toContain('Event 11');
    expect(wrapper.text()).toContain('Event 12');
    expect(wrapper.find('.audit-pagination').text()).toContain('Showing 8-12 of 12');
    expect(wrapper.find('.audit-next').attributes('disabled')).toBeDefined();
  });

  it('shows audit event times in Asia/Shanghai timezone', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') {
        return { json: async () => ({ events: [{ id: 1, createdAt: '2026-06-03T00:00:00.000Z', type: 'login_success', status: 'success', ip: '127.0.0.1', metadata: {} }] }) };
      }
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.find('.audit-table tbody tr td').text()).toContain('2026/06/03 08:00:00');
    expect(wrapper.find('.audit-table tbody tr td').text()).not.toContain('00:00:00.000Z');
  });

  it('groups adjacent matching audit events and shows readable status badges', async () => {
    const events = [
      { id: 3, createdAt: '2026-06-03T00:00:03.000Z', type: 'websocket_auth_failure', status: 'failure', ip: '127.0.0.1', metadata: { path: '/ws/chat' } },
      { id: 2, createdAt: '2026-06-03T00:00:02.000Z', type: 'websocket_auth_failure', status: 'failure', ip: '127.0.0.1', metadata: { path: '/ws/chat' } },
      { id: 1, createdAt: '2026-06-03T00:00:01.000Z', type: 'login_success', status: 'success', ip: '127.0.0.1', metadata: {} },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') return { json: async () => ({ events }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(2);
    expect(wrapper.find('.audit-table tbody tr').text()).toContain('WebSocket authentication');
    expect(wrapper.find('.audit-table tbody tr').text()).toContain('×2');
    expect(wrapper.find('.audit-event-cell').element.tagName).toBe('DIV');
    expect(wrapper.find('.audit-status.failure').text()).toBe('Failure');
    expect(wrapper.find('.audit-status.success').text()).toBe('Success');
  });

  it('clears the audit log after confirmation', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/auth/audit' && options?.method === 'DELETE') return { json: async () => ({ success: true }) };
      if (url === '/api/auth/audit') return { json: async () => ({ events: [{ id: 1, createdAt: '2026-06-03T00:00:00.000Z', type: 'login_success', status: 'success', ip: '127.0.0.1', metadata: {} }] }) };
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(SecurityPanel, {
      props: { totpEnabled: false },
      global: {
        stubs: {
          ConfirmModal: {
            props: ['visible'],
            emits: ['confirm', 'cancel'],
            template: '<button v-if="visible" class="confirm-clear" @click="$emit(\'confirm\')">Confirm</button>',
          },
        },
      },
    });
    await flushPromises();

    await wrapper.find('.clear-audit').trigger('click');
    await wrapper.find('.confirm-clear').trigger('click');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/audit', { method: 'DELETE' });
  });

  it('shows an empty state when there are no audit events', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/audit') return { json: async () => ({ events: [] }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.find('.audit-empty').text()).toContain('No audit events yet');
    expect(wrapper.find('.clear-audit').attributes('disabled')).toBeDefined();
  });

  it('uses prominent button styles for 2FA actions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/2fa/setup') {
        return { json: async () => ({ secret: 'ABC', qrCodeDataUrl: 'data:image/png;base64,abc', otpauthUrl: 'otpauth://totp/x' }) };
      }
      if (url === '/api/auth/audit') return { json: async () => ({ events: [] }) };
      return { json: async () => ({}) };
    }));

    const wrapper = mount(SecurityPanel, { props: { totpEnabled: false } });
    await flushPromises();

    expect(wrapper.find('.start-2fa').classes()).toContain('primary-action');

    await wrapper.find('.start-2fa').trigger('click');
    await flushPromises();

    expect(wrapper.find('.verify-2fa').classes()).toContain('primary-action');

    const enabledWrapper = mount(SecurityPanel, { props: { totpEnabled: true } });
    await flushPromises();

    expect(enabledWrapper.find('.disable-2fa').classes()).toContain('danger-action');
  });
});
