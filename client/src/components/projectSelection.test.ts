import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import SessionSidebar from './SessionSidebar.vue';
import TaskEditorDialog from './TaskEditorDialog.vue';
import FolderPickerModal from './FolderPickerModal.vue';
import { invalidateLaunchResourceCache } from '../composables/useLaunchResourceCache';

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

it('keeps project ordering and full-path/home-alias search consistent in all three contexts', async () => {
  invalidateLaunchResourceCache();
  const paths = ['/Users/test/zebra', '/Users/test/app', '/Users/test/favorite'];
  const profile = { id: 'default', label: 'default', isDefault: true };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    let data: object = { sessions: [] };
    if (url.includes('/project-history')) data = { projects: [
      { path: paths[1], lastAccessed: Date.now(), sessionCount: 1 },
      { path: paths[2], lastAccessed: Date.now(), sessionCount: 1, isFavorite: true },
      { path: paths[0], lastAccessed: Date.now(), sessionCount: 1 },
    ] };
    else if (url.includes('/project-paths')) data = { projectPaths: paths };
    else if (url.includes('/project-path')) data = { projectPath: paths[1] };
    else if (url.includes('/agent-profiles') && !url.includes('/models') && !url.includes('/skills')) data = { profiles: [profile] };
    else if (url.includes('/agent-profile')) data = { profile };
    else if (url.includes('/files/tree')) data = { path: paths[1], tree: [] };
    return { ok: true, json: async () => data };
  }));
  const global = { stubs: { Teleport: true, Transition: false } };
  const sidebar = mount(SessionSidebar, { props: { clientId: 'client-1' }, global });
  const task = mount(TaskEditorDialog, { props: { visible: true, clientId: 'client-1', currentProjectPath: paths[1], selectedAgentProfileId: 'default', presets: [] }, global });
  const history = mount(FolderPickerModal, { props: { visible: true, clientId: 'client-1', initialPath: paths[1] }, global });
  await vi.waitFor(() => expect(history.findAll('.project-history-row')).toHaveLength(3));
  await vi.waitFor(() => expect(task.find('#task-project').exists()).toBe(true));
  await sidebar.get('.project-path-input').trigger('focus');
  await task.get('#task-project').trigger('focus');
  const lists = () => [
    sidebar.findAll('.recent-project-option').map((node) => node.text()),
    task.findAll('.project-control .custom-select-option').map((node) => node.text()),
    history.findAll('.project-history-path').map((node) => node.text().replace('/Users/test', '~')),
  ];
  await vi.waitFor(() => expect(lists()).toEqual(Array(3).fill(['~/favorite', '~/zebra', '~/app'])));
  for (const query of ['  ~/APP  ', '/USERS/TEST/APP', 'missing', '']) {
    await sidebar.get('.project-path-input').setValue(query);
    await task.get('#task-project').setValue(query);
    await history.get('.project-history-list .search-input').setValue(query);
    const expected = query === '' ? ['~/favorite', '~/zebra', '~/app'] : query === 'missing' ? [] : ['~/app'];
    expect(lists()).toEqual(Array(3).fill(expected));
  }
  await task.get('#task-project').setValue('zebra');
  await task.get('#task-project').trigger('keydown', { key: 'Enter' });
  expect((task.get('#task-project').element as HTMLInputElement).value).toBe('~/zebra');
});
