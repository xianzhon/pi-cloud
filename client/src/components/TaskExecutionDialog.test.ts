import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaskExecutionDialog from './TaskExecutionDialog.vue';

const request = vi.hoisted(() => vi.fn());
vi.mock('../services/apiClient', () => ({ apiRequest: request, getApiErrorMessage: (error: Error) => error.message }));
const tasks = [
  { id: 'one', title: 'Current task', projectPath: '/current', status: 'waiting' },
  { id: 'two', title: 'Other task', projectPath: '/other', status: 'waiting' },
  { id: 'done', title: 'Completed task', projectPath: '/current', status: 'completed' },
];
let state: { enabled: boolean; scheduledAt?: string | null; taskIds: string[]; activeTaskId: string | null; error: string } = { enabled: false, taskIds: [], activeTaskId: null, error: '' };
let wrapper: ReturnType<typeof mount>;
async function open() {
  wrapper = mount(TaskExecutionDialog, {
    props: { visible: true, currentProjectPath: '/current' },
    global: { stubs: { Teleport: true, Transition: false } },
  });
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  state = { enabled: false, taskIds: [], activeTaskId: null, error: '' };
  request.mockReset();
  request.mockImplementation(async (url: string, options?: any) => {
    if (url.includes('?')) return { tasks };
    if (options?.method === 'PUT') { state = { ...state, ...options.body }; return state; }
    return state;
  });
});
afterEach(() => wrapper?.unmount());

describe('TaskExecutionDialog', () => {
  it('filters waiting tasks by project, supports all projects, and saves the selected order', async () => {
    await open();
    expect(wrapper.find('.available').text()).toContain('Current task');
    expect(wrapper.find('.available').text()).not.toContain('Other task');
    await wrapper.get('.available input').setValue(true);
    await wrapper.get('.custom-select-trigger').trigger('click');
    await wrapper.findAll('.custom-select-option')[1]!.trigger('click');
    expect(wrapper.find('.available').text()).not.toContain('Completed task');
    await wrapper.findAll('.available input')[1]!.setValue(true);
    await wrapper.findAll('.execution-list li')[1]!.get('button[aria-label="Move up"]').trigger('click');
    await wrapper.get('input[role="switch"]').setValue(true);
    await wrapper.get('.btn-confirm').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledWith('/api/tasks/execution-queue', { method: 'PUT', body: { taskIds: ['two', 'one'], enabled: true, scheduledAt: null } });
  });

  it('excludes individually scheduled tasks from shared-queue selection', async () => {
    request.mockImplementation(async (url: string) => url.includes('?')
      ? { tasks: tasks.map((task) => task.id === 'one' ? { ...task, scheduledAt: '2099-01-01T00:00:00Z' } : task) }
      : state);
    await open();
    expect(wrapper.find('.available').text()).not.toContain('Current task');
    await wrapper.get('.custom-select-trigger').trigger('click');
    await wrapper.findAll('.custom-select-option')[1]!.trigger('click');
    expect(wrapper.find('.available').text()).toContain('Other task');
  });

  it('locks ordering during execution but allows saving the switch off', async () => {
    state = { enabled: true, taskIds: ['one', 'two'], activeTaskId: 'one', error: '' };
    await open();
    expect(wrapper.text()).toContain('Running: Current task');
    expect(wrapper.get('button[aria-label="Remove from queue"]').attributes('disabled')).toBeDefined();
    await wrapper.get('input[role="switch"]').setValue(false);
    await wrapper.get('.btn-confirm').trigger('click');
    await flushPromises();
    expect(state.enabled).toBe(false);
    expect(state.taskIds).toEqual(['one', 'two']);
  });

  it('preserves an unsaved pause when polling observes task completion', async () => {
    vi.useFakeTimers();
    try {
      state = { enabled: true, taskIds: ['one', 'two'], activeTaskId: 'one', error: '' };
      await open();
      await wrapper.get('input[role="switch"]').setValue(false);
      state = { enabled: true, taskIds: ['two'], activeTaskId: 'two', error: '' };
      await vi.advanceTimersByTimeAsync(2000);
      await flushPromises();
      expect((wrapper.get('input[role="switch"]').element as HTMLInputElement).checked).toBe(false);
      expect(wrapper.text()).toContain('Running: Other task');
      await wrapper.get('.btn-confirm').trigger('click');
      await flushPromises();
      expect(request).toHaveBeenCalledWith('/api/tasks/execution-queue', {
        method: 'PUT', body: { taskIds: ['two'], enabled: false, scheduledAt: null },
      });
      await wrapper.setProps({ visible: false });
      state = { ...state, enabled: true };
      await wrapper.setProps({ visible: true });
      await flushPromises();
      expect((wrapper.get('input[role="switch"]').element as HTMLInputElement).checked).toBe(true);
    } finally {
      wrapper?.unmount();
      vi.useRealTimers();
    }
  });

  it('clears an unsaved schedule when the persisted schedule fires so tasks can still be appended', async () => {
    vi.useFakeTimers();
    try {
      state = { enabled: true, scheduledAt: new Date(Date.now() + 1000).toISOString(), taskIds: ['one'], activeTaskId: null, error: '' };
      await open();
      const future = new Date(Date.now() + 86_400_000);
      const draft = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      await wrapper.get('input[type="datetime-local"]').setValue(draft);
      state = { ...state, scheduledAt: null, activeTaskId: 'one' };
      await vi.advanceTimersByTimeAsync(2000);
      await flushPromises();
      const input = wrapper.get('input[type="datetime-local"]');
      expect(input.attributes('disabled')).toBeDefined();
      expect((input.element as HTMLInputElement).value).toBe('');
      await wrapper.get('.custom-select-trigger').trigger('click');
      await wrapper.findAll('.custom-select-option')[1]!.trigger('click');
      await wrapper.findAll('.available input')[1]!.setValue(true);
      await wrapper.get('.btn-confirm').trigger('click');
      await flushPromises();
      expect(request).toHaveBeenCalledWith('/api/tasks/execution-queue', {
        method: 'PUT', body: { taskIds: ['one', 'two'], enabled: true, scheduledAt: null },
      });
      expect(wrapper.emitted('close')).toHaveLength(1);
    } finally {
      wrapper?.unmount();
      vi.useRealTimers();
    }
  });

  it('shows every concurrently running task', async () => {
    state = { enabled: true, taskIds: ['one', 'two'], activeTaskId: 'one', error: '', activeTaskIds: ['one', 'two'] } as typeof state;
    await open();
    expect(wrapper.text()).toContain('Running: Current task');
    expect(wrapper.text()).toContain('Running: Other task');
  });

  it('saves a local start time as UTC and restores the pending plan for editing', async () => {
    await open();
    await wrapper.get('.available input').setValue(true);
    await wrapper.get('input[role="switch"]').setValue(true);
    const future = new Date(Date.now() + 86_400_000);
    future.setSeconds(0, 0);
    const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await wrapper.get('input[type="datetime-local"]').setValue(local);
    await wrapper.get('.btn-confirm').trigger('click');
    await flushPromises();
    expect(state.scheduledAt).toBe(future.toISOString());
    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect((wrapper.get('input[type="datetime-local"]').element as HTMLInputElement).value).toBe(local);
    expect(wrapper.get('button[aria-label="Remove from queue"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('input[role="switch"]').setValue(false);
    await wrapper.get('.btn-confirm').trigger('click');
    await flushPromises();
    expect(state.scheduledAt).toBeNull();
    expect(state.enabled).toBe(false);
  });

  it('rejects a past scheduled time without saving', async () => {
    await open();
    await wrapper.get('input[role="switch"]').setValue(true);
    await wrapper.get('input[type="datetime-local"]').setValue('2020-01-01T10:00');
    await wrapper.get('.btn-confirm').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Choose a future start time.');
    expect(request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });

  it('displays a paused queue error and lets users remove failed tasks', async () => {
    state = { enabled: false, taskIds: ['one'], activeTaskId: null, error: 'Commit failed' };
    await open();
    expect(wrapper.get('[role="alert"]').text()).toBe('Commit failed');
    await wrapper.get('button[aria-label="Remove from queue"]').trigger('click');
    expect(wrapper.findAll('.execution-list li')).toHaveLength(0);
  });
});
