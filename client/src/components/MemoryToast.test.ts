import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MemoryToast from './MemoryToast.vue';

const toast = {
  extractionRunId: 'run-1',
  activeProjectCount: 2,
  pendingGlobalCount: 1,
  failed: false,
};

enableAutoUnmount(afterEach);

describe('MemoryToast', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows extraction counts without memory bodies and emits its actions', async () => {
    const wrapper = mount(MemoryToast, {
      props: { toast },
      attachTo: document.body,
    });

    const status = wrapper.get('[role="status"]');
    expect(status.text()).toContain('2 project memories saved');
    expect(status.text()).toContain('1 global memory needs review');
    expect(status.text()).not.toContain('memory body');

    await wrapper.get('.memory-toast-review').trigger('click');
    await wrapper.get('.memory-toast-undo').trigger('click');
    await wrapper.get('.memory-toast-close').trigger('click');

    expect(wrapper.emitted('review')).toEqual([['run-1']]);
    expect(wrapper.emitted('undo')).toEqual([['run-1']]);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('hides review when the extraction has no pending global memories', () => {
    const wrapper = mount(MemoryToast, {
      props: { toast: { ...toast, pendingGlobalCount: 0 } },
    });

    expect(wrapper.find('.memory-toast-review').exists()).toBe(false);
    expect(wrapper.find('.memory-toast-undo').exists()).toBe(true);
  });

  it('renders nothing without toast state', () => {
    const wrapper = mount(MemoryToast, { props: { toast: null } });

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('dismisses automatically after eight seconds and restarts for a new run', async () => {
    vi.useFakeTimers();
    const wrapper = mount(MemoryToast, { props: { toast } });

    await vi.advanceTimersByTimeAsync(4_000);
    await wrapper.setProps({ toast: { ...toast, extractionRunId: 'run-2' } });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(wrapper.emitted('dismiss')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('does not dismiss while keyboard focus is inside and restarts after focus leaves', async () => {
    vi.useFakeTimers();
    const wrapper = mount(MemoryToast, {
      props: { toast },
      attachTo: document.body,
    });
    const reviewButton = wrapper.get<HTMLButtonElement>('.memory-toast-review');

    reviewButton.element.focus();
    await reviewButton.trigger('focusin');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(wrapper.emitted('dismiss')).toBeUndefined();

    reviewButton.element.blur();
    await reviewButton.trigger('focusout', { relatedTarget: document.body });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(wrapper.emitted('dismiss')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });
});
