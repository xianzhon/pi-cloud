import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
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
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

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

  it('renders loading, empty, and query hint states', async () => {
    isLoading.value = true;
    const wrapper = mount(SearchModal, { props: { isOpen: true }, global: { stubs: { Teleport: true, Transition: false } } });
    expect(wrapper.find('.loading-state').exists()).toBe(true);
    isLoading.value = false;
    results.value = [];
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    query.value = ' ';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.hint-state').exists()).toBe(true);
  });

  it('formats fallback titles, paths, dates, counts, and escaped highlights', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-08T00:00:00Z'));
    results.value = [
      { ...results.value[0], name: '', firstMessage: '<skill name="review">', created: '2026-01-08T00:00:00Z', snippet: '<hello>', matchCount: 1 },
      { ...results.value[1], name: '', firstMessage: 'A long first message', cwd: '/home/user/repo', created: '2026-01-07T23:30:00Z' },
      { ...results.value[1], id: 'abcdefghijk', name: '', firstMessage: '', cwd: '/Users/name/repo', created: '2025-12-01T00:00:00Z' },
    ];
    total.value = 3;
    const wrapper = mount(SearchModal, { props: { isOpen: true }, global: { stubs: { Teleport: true, Transition: false } } });
    await flushPromises();
    expect(wrapper.findAll('.result-title').map((item) => item.text())).toEqual(['review', 'A long first message', 'abcdefgh']);
    expect(wrapper.html()).toContain('&lt;<mark>hello</mark>&gt;');
    expect(wrapper.findAll('.result-path').map((item) => item.text())).toEqual(expect.arrayContaining(['~/repo']));
    vi.useRealTimers();
  });

  it('loads more at the end, stops at boundaries, and closes with Escape', async () => {
    displayCount.value = 1;
    total.value = 2;
    const wrapper = mount(SearchModal, { props: { isOpen: true }, attachTo: document.body, global: { stubs: { Teleport: true, Transition: false } } });
    const modal = wrapper.get('.search-modal');
    await modal.trigger('keydown', { key: 'ArrowUp' });
    await modal.trigger('keydown', { key: 'ArrowDown' });
    expect(loadMore).toHaveBeenCalled();
    await wrapper.get('.load-more-btn').trigger('click');
    await modal.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toBeTruthy();
    wrapper.unmount();
  });

  it('traps focus in both tab directions and selects results by mouse', async () => {
    const wrapper = mount(SearchModal, { props: { isOpen: true }, attachTo: document.body, global: { stubs: { Teleport: true, Transition: false } } });
    await flushPromises();
    const focusable = wrapper.findAll('input, button');
    (focusable.at(-1)!.element as HTMLElement).focus();
    await wrapper.get('.search-modal').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0].element);
    (focusable[0].element as HTMLElement).focus();
    await wrapper.get('.search-modal').trigger('keydown', { key: 'Tab', shiftKey: true });
    await wrapper.findAll('.result-item')[0].trigger('click');
    expect(wrapper.emitted('selectSession')).toEqual([['session-1']]);
    wrapper.unmount();
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
