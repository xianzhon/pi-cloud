import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import FileSearchMenu from './FileSearchMenu.vue';
import type { FileSearchResult } from '../types/fileSearch';

describe('FileSearchMenu', () => {
  const mockFiles: FileSearchResult[] = [
    { path: 'src/components/ChatPanel.vue', name: 'ChatPanel.vue', directory: 'src/components', type: '.vue', score: 0.95, isRecent: false },
    { path: 'src/composables/useChat.ts', name: 'useChat.ts', directory: 'src/composables', type: '.ts', score: 0.85, isRecent: true },
  ];

  it('renders nothing when not open', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: [],
        activeIndex: 0,
        isLoading: false,
        query: '',
        isOpen: false
      }
    });
    expect(wrapper.find('.file-search-menu').exists()).toBe(false);
  });

  it('renders menu when open', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 0,
        isLoading: false,
        query: 'chat',
        isOpen: true
      }
    });
    expect(wrapper.find('.file-search-menu').exists()).toBe(true);
  });

  it('displays file names', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 0,
        isLoading: false,
        query: 'chat',
        isOpen: true
      }
    });
    expect(wrapper.text()).toContain('ChatPanel.vue');
    expect(wrapper.text()).toContain('useChat.ts');
  });

  it('displays file paths', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 0,
        isLoading: false,
        query: 'chat',
        isOpen: true
      }
    });
    expect(wrapper.text()).toContain('src/components/');
    expect(wrapper.text()).toContain('src/composables/');
  });

  it('emits select event on click', async () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 0,
        isLoading: false,
        query: 'chat',
        isOpen: true
      }
    });
    await wrapper.find('.file-search-item').trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')![0]).toEqual([mockFiles[0]]);
  });

  it('highlights active item', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 1,
        isLoading: false,
        query: 'chat',
        isOpen: true
      }
    });
    const items = wrapper.findAll('.file-search-item');
    expect(items[1].classes()).toContain('active');
  });

  it('scrolls the active item into view when activeIndex changes', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    const files = Array.from({ length: 10 }, (_, index): FileSearchResult => ({
      path: `src/file-${index}.ts`,
      name: `file-${index}.ts`,
      directory: 'src',
      type: '.ts',
      score: 1,
      isRecent: false,
    }));
    const wrapper = mount(FileSearchMenu, {
      props: {
        files,
        activeIndex: 0,
        isLoading: false,
        query: '',
        isOpen: true,
      },
    });

    await wrapper.setProps({ activeIndex: 7 });
    await nextTick();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('shows loading state', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: [],
        activeIndex: 0,
        isLoading: true,
        query: '',
        isOpen: true
      }
    });
    expect(wrapper.find('.loading-indicator').exists()).toBe(true);
  });

  it('shows empty state when no results', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: [],
        activeIndex: 0,
        isLoading: false,
        query: 'xyz',
        isOpen: true
      }
    });
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.text()).toContain('No files found');
  });

  it('shows recent files header when query is empty', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 0,
        isLoading: false,
        query: '',
        isOpen: true
      }
    });
    expect(wrapper.text()).toContain('Recent Files');
  });

  it('shows search results header when query is present', () => {
    const wrapper = mount(FileSearchMenu, {
      props: {
        files: mockFiles,
        activeIndex: 0,
        isLoading: false,
        query: 'chat',
        isOpen: true
      }
    });
    expect(wrapper.text()).toContain('Search Results');
  });
});
