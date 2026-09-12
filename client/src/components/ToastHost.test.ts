import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useToasts } from '../composables/useToasts';
import ToastHost from './ToastHost.vue';

const toastController = useToasts();

describe('ToastHost', () => {
  beforeEach(() => toastController.clearToasts());
  afterEach(() => toastController.clearToasts());

  it('renders notifications and lets the user dismiss them', async () => {
    toastController.showToast('No working tree changes.', 'info', 0);
    toastController.showToast('Push failed', 'error', 0);
    const wrapper = mount(ToastHost);

    const notifications = wrapper.findAll('.app-toast');
    expect(notifications.map(notification => notification.text())).toEqual([
      'No working tree changes.',
      'Push failed',
    ]);
    expect(notifications[0].attributes('role')).toBe('status');
    expect(notifications[1].attributes('role')).toBe('alert');

    await notifications[0].get('button').trigger('click');
    expect(wrapper.findAll('.app-toast')).toHaveLength(1);
  });
});
