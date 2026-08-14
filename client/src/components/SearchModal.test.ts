import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import SearchModal from './SearchModal.vue';
import type { SearchResult } from '../composables/useSearch';

const query = ref('hello');
const scope = ref<'project' | 'all'>('all');
const results = ref<SearchResult[]>([]);
const total = ref(0);
const isLoading = ref(false);
const displayCount = ref(10);
const search = vi.fn();
const debouncedSearch = vi.fn();
const loadMore = vi.fn();
const setScope = vi.fn((value: 'project' | 'all') => {
  scope.value = value;
});

vi.mock('../composables/useSearch', () => ({
  useSearch: () => ({
    query,
    scope,
    results,
    total,
    isLoading,
    displayCount,
    search,
    debouncedSearch,
    loadMore,
    setScope,
  }),
}));

describe('SearchModal', () => {
  beforeEach(() => {
    query.value = 'hello';
    scope.value = 'all';
    results.value = [
      {
        id: 'session-1',
        name: 'Session One',
        path: '/workspace',
        cwd: '/workspace',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
        messageCount: 3,
        firstMessage: 'hello there',
        snippet: 'hello result snippet',
        matchCount: 1,
      },
      {
        id: 'session-2',
        name: 'Session Two',
        path: '/workspace',
        cwd: '/workspace',
        created: '2026-01-02T00:00:00.000Z',
        modified: '2026-01-02T00:00:00.000Z',
        messageCount: 4,
        firstMessage: 'another hello',
        snippet: 'another hello result snippet',
        matchCount: 2,
      },
    ];
    total.value = 1;
    isLoading.value = false;
    displayCount.value = 10;
    search.mockReset();
    debouncedSearch.mockReset();
    loadMore.mockReset();
    setScope.mockClear();
  });

  it('marks the active scope and closes from the close button', async () => {
    const wrapper = mount(SearchModal, {
      props: {
        isOpen: true,
        projectPath: '/workspace',
      },
      global: {
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    });

    const scopeButtons = wrapper.findAll('.scope-toggle button');
    expect(scopeButtons[0].attributes('aria-pressed')).toBe('false');
    expect(scopeButtons[1].attributes('aria-pressed')).toBe('true');

    await wrapper.find('.search-close-btn').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('selects the focused result when Enter is pressed from the search input', async () => {
    const wrapper = mount(SearchModal, {
      props: {
        isOpen: true,
        projectPath: '/workspace',
      },
      attachTo: document.body,
      global: {
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    });

    await flushPromises();

    const input = wrapper.find('.search-input');
    (input.element as HTMLInputElement).focus();

    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('selectSession')).toEqual([['session-1']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('softens the input highlight while a result is keyboard-focused', async () => {
    const wrapper = mount(SearchModal, {
      props: {
        isOpen: true,
        projectPath: '/workspace',
      },
      attachTo: document.body,
      global: {
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    });

    await flushPromises();

    const input = wrapper.find('.search-input');
    const inputWrapper = wrapper.find('.search-input-wrapper');

    expect(inputWrapper.classes()).not.toContain('result-focused');

    await input.trigger('keydown', { key: 'ArrowDown' });

    expect(inputWrapper.classes()).toContain('result-focused');
  });

  it('switches to keyboard navigation mode after arrowing away from a hovered result', async () => {
    const wrapper = mount(SearchModal, {
      props: {
        isOpen: true,
        projectPath: '/workspace',
      },
      attachTo: document.body,
      global: {
        stubs: {
          Teleport: true,
          Transition: false,
        },
      },
    });

    await flushPromises();

    const input = wrapper.find('.search-input');
    const items = wrapper.findAll('.result-item');
    const resultsList = wrapper.find('.results-list');

    await items[0].trigger('mouseenter');
    expect(resultsList.classes()).not.toContain('keyboard-navigation');

    await input.trigger('keydown', { key: 'ArrowDown' });

    expect(resultsList.classes()).toContain('keyboard-navigation');
    expect(items[1].classes()).toContain('focused');
  });
});
