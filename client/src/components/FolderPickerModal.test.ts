import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./CloneRepositoryModal.vue', () => ({
  default: {
    name: 'CloneRepositoryModal',
    props: ['visible', 'clientId', 'embedded'],
    emits: ['close', 'cloned'],
    template: '<div data-testid="embedded-clone"><button data-testid="mock-cloned" @click="$emit(\'cloned\', { projectPath: \'/workspace/cloned\' })">mock cloned</button></div>',
  },
}));

import FolderPickerModal from './FolderPickerModal.vue';

enableAutoUnmount(afterEach);

describe('FolderPickerModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('supports renaming the current project without selecting a different parent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ path: '/workspace/old-name', tree: [] }),
    })));

    const wrapper = mount(FolderPickerModal, {
      props: {
        visible: true,
        initialPath: '/workspace/old-name',
        currentProjectPath: '/workspace/old-name',
        clientId: 'client-1',
      },
      global: { stubs: { Teleport: true } },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Rename project');
    });

    const renameRadio = wrapper.find('.action-item input[value="rename"]');
    expect(renameRadio.exists()).toBe(true);
    await wrapper.find('.project-name-field input').setValue('new-name');
    await wrapper.find('.use-btn').trigger('click');

    expect(wrapper.emitted('select')?.[0]).toEqual([{
      path: '/workspace',
      moveMode: 'rename',
      projectName: 'new-name',
    }]);
  });

  it('browses an entered path and treats a bare Windows drive as its root', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const requestedPath = new URL(input, 'http://localhost').searchParams.get('path');
      const path = requestedPath === 'D:\\' ? 'D:\\' : 'C:\\Users\\test';
      return {
        ok: true,
        json: async () => ({ path, parentPath: null, tree: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(FolderPickerModal, {
      props: {
        visible: true,
        initialPath: 'C:\\Users\\test',
      },
      global: { stubs: { Teleport: true } },
    });

    await vi.waitFor(() => expect(wrapper.find('.path-input').element).toHaveProperty('value', 'C:\\Users\\test'));
    await wrapper.find('.path-input').setValue('D:');
    await wrapper.find('.path-input').trigger('keydown.enter');

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('path=D%3A%5C'));
      expect(wrapper.find('.path-input').element).toHaveProperty('value', 'D:\\');
    });
  });

  it('uses the server-provided parent path for navigation', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const requestedPath = new URL(input, 'http://localhost').searchParams.get('path');
      return {
        ok: true,
        json: async () => requestedPath === 'D:\\Projects'
          ? { path: 'D:\\Projects', parentPath: 'D:\\', tree: [] }
          : { path: 'D:\\', parentPath: null, tree: [] },
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(FolderPickerModal, {
      props: { visible: true, initialPath: 'D:\\Projects' },
      global: { stubs: { Teleport: true } },
    });

    await vi.waitFor(() => expect(wrapper.find('.directory-row').attributes('disabled')).toBeUndefined());
    await wrapper.find('.directory-row').trigger('click');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('path=D%3A%5C')));
  });

  it('shows clone repository as a tab and emits the cloned path as a project selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ path: '/workspace', tree: [] }),
    })));

    const wrapper = mount(FolderPickerModal, {
      props: {
        visible: true,
        initialPath: '/workspace',
        currentProjectPath: '/workspace',
        clientId: 'client-1',
      },
      global: { stubs: { Teleport: true } },
    });

    await wrapper.findAll('.project-dialog-tabs button')[1].trigger('click');

    expect(wrapper.find('[data-testid="embedded-clone"]').exists()).toBe(true);
    await wrapper.find('[data-testid="mock-cloned"]').trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([{ path: '/workspace/cloned', refreshProjectPaths: true }]);
  });

  it('offers move options without a rename field for a different folder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ path: '/alias/project', tree: [] }),
    })));

    const wrapper = mount(FolderPickerModal, {
      props: {
        visible: true,
        initialPath: '/alias/project',
        currentProjectPath: '/workspace/project',
        clientId: 'client-1',
      },
      global: { stubs: { Teleport: true } },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Move project here');
      expect(wrapper.text()).toContain('Move sessions here');
    });
    expect(wrapper.find('.project-name-field').exists()).toBe(false);

    await wrapper.find('input[value="move-sessions"]').setValue(true);
    await wrapper.find('.use-btn').trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([{
      path: '/alias/project',
      moveMode: 'move-sessions',
      projectName: 'project',
    }]);
  });
});
