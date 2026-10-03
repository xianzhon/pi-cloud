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
let state = { enabled: false, taskIds: [] as string[], activeTaskId: null as string | null, error: '' };
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
    expect(request).toHaveBeenCalledWith('/api/tasks/execution-queue', { method: 'PUT', body: { taskIds: ['two', 'one'], enabled: true } });
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

  it('shows every concurrently running task', async () => {
    state = { enabled: true, taskIds: ['one', 'two'], activeTaskId: 'one', error: '', activeTaskIds: ['one', 'two'] } as typeof state;
    await open();
    expect(wrapper.text()).toContain('Running: Current task');
    expect(wrapper.text()).toContain('Running: Other task');
  });

  it('displays a paused queue error and lets users remove failed tasks', async () => {
    state = { enabled: false, taskIds: ['one'], activeTaskId: null, error: 'Commit failed' };
    await open();
    expect(wrapper.get('[role="alert"]').text()).toBe('Commit failed');
    await wrapper.get('button[aria-label="Remove from queue"]').trigger('click');
    expect(wrapper.findAll('.execution-list li')).toHaveLength(0);
  });
});
