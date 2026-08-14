import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import MemoryCenter from './MemoryCenter.vue';
import type { MemoryRecord } from '../types/memory';

function record(index: number, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: `memory-${index}`,
    profileId: 'default',
    projectId: 'project-1',
    scope: 'project',
    category: index % 2 ? 'fact' : 'decision',
    content: `Memory ${index}`,
    tags: [`tag-${index}`],
    pinned: index === 0,
    pinnedApplicability: 'always',
    status: 'active',
    source: 'manual_ui',
    sourceSessionId: `session-${index}`,
    revision: 1,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function createController(records: MemoryRecord[] = [record(0), record(1)]) {
  return {
    memories: ref(records),
    total: ref(records.length),
    counts: ref({
      projectActive: records.filter((item) => item.scope === 'project' && item.status === 'active').length,
      globalActive: records.filter((item) => item.scope === 'global' && item.status === 'active').length,
      globalPending: records.filter((item) => item.scope === 'global' && item.status === 'pending').length,
      archived: records.filter((item) => item.status === 'archived').length,
      failedExtractions: 0,
      pinnedOverflow: false,
    }),
    filters: ref({ scope: 'project', statuses: ['active'], categories: [], query: '', limit: 50, offset: 0 }),
    failedExtractions: ref([]),
    loading: ref(false),
    error: ref<string | null>(null),
    warning: ref<string | null>(null),
    toast: ref(null),
    setContext: vi.fn(),
    loadMemories: vi.fn(async () => {}),
    loadCounts: vi.fn(async () => {}),
    createMemory: vi.fn(async () => record(20)),
    updateMemory: vi.fn(async () => record(0, { revision: 2 })),
    archiveMemory: vi.fn(async () => record(0, { status: 'archived', revision: 2 })),
    deleteMemory: vi.fn(async () => {}),
    approveMemory: vi.fn(async () => record(0, { scope: 'global', status: 'active', revision: 2 })),
    rejectMemory: vi.fn(async () => {}),
    extractSession: vi.fn(async () => {}),
    retryExtraction: vi.fn(async () => {}),
    clearExtractionFailure: vi.fn(async () => {}),
    undoExtraction: vi.fn(async () => {}),
    dismissToast: vi.fn(),
  };
}

function mountCenter(controller = createController(), props: Record<string, unknown> = {}) {
  return mount(MemoryCenter, {
    props: {
      visible: true,
      controller: controller as any,
      profileLabel: 'default (~/.pi/agent)',
      projectPath: '/repo/app',
      sessionId: 'session-current',
      ...props,
    },
    attachTo: document.body,
    global: { stubs: { Teleport: true, Transition: false } },
  });
}

describe('MemoryCenter', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders only when visible, shows context, focuses search, and restores focus on close', async () => {
    const hidden = mountCenter(createController(), { visible: false });
    expect(hidden.find('.memory-center-dialog').exists()).toBe(false);
    hidden.unmount();

    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mountCenter();
    await flushPromises();

    expect(wrapper.find('.memory-center-dialog').text()).toContain('Memory Center');
    expect(wrapper.find('.memory-context').text()).toContain('default (~/.pi/agent)');
    expect(wrapper.find('.memory-context').text()).toContain('/repo/app');
    expect(document.activeElement).toBe(wrapper.find('.memory-search').element);

    await wrapper.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);
  });

  it('loads Project, Global, and Review filters and responds to search/category/state controls', async () => {
    const controller = createController();
    const wrapper = mountCenter(controller, { reviewRunId: 'run-1' });
    await flushPromises();
    controller.loadMemories.mockClear();

    await wrapper.find('[data-tab="project"]').trigger('click');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'project', statuses: ['active'], extractionRunId: undefined,
    }));
    await wrapper.find('[data-tab="global"]').trigger('click');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'global', statuses: ['active'], extractionRunId: undefined,
    }));
    await wrapper.find('[data-tab="review"]').trigger('click');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'global', statuses: ['pending'], extractionRunId: 'run-1',
    }));

    await wrapper.find('.memory-search').setValue('SQLite');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'SQLite' }));
    await wrapper.find('.memory-category-select .custom-select-trigger').trigger('click');
    await wrapper.findAll('.memory-category-select .custom-select-option')[3].trigger('click');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ['decision'] }));
    await wrapper.find('.memory-state-select .custom-select-trigger').trigger('click');
    await wrapper.findAll('.memory-state-select .custom-select-option')[3].trigger('click');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['archived'] }));
  });

  it('adds, edits, pins, and archives project memories', async () => {
    const controller = createController();
    const wrapper = mountCenter(controller);
    await flushPromises();

    await wrapper.find('.memory-add-button').trigger('click');
    await wrapper.find('.memory-add-editor textarea').setValue('A durable project fact');
    await wrapper.find('.memory-add-editor input[type="checkbox"]').setValue(true);
    await wrapper.find('[aria-label="New pinned applicability"]').setValue('matched');
    await wrapper.find('.memory-add-editor').trigger('submit');
    expect(controller.createMemory).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'project', category: 'fact', content: 'A durable project fact',
      pinned: true, pinnedApplicability: 'matched',
    }));

    await wrapper.find('.memory-action-edit').trigger('click');
    await wrapper.find('.memory-edit-editor textarea').setValue('Updated memory text');
    await wrapper.find('[aria-label="Edit pinned applicability"]').setValue('matched');
    await wrapper.find('.memory-edit-editor').trigger('submit');
    expect(controller.updateMemory).toHaveBeenCalledWith('memory-0', 1, expect.objectContaining({
      content: 'Updated memory text', pinnedApplicability: 'matched',
    }));

    await wrapper.find('.memory-action-pin').trigger('click');
    expect(controller.updateMemory).toHaveBeenCalledWith('memory-0', 1, { pinned: false });
    await wrapper.find('.memory-action-archive').trigger('click');
    expect(controller.archiveMemory).toHaveBeenCalledWith('memory-0', 1);

    const confirmSpy = vi.spyOn(window, 'confirm');
    await wrapper.find('.memory-action-delete').trigger('click');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(controller.deleteMemory).toHaveBeenCalledWith('memory-0', 1);
  });

  it('shows review evidence and supports approve, edit-and-approve, reject, source navigation, and extraction', async () => {
    const pending = record(0, {
      scope: 'global', projectId: undefined, status: 'pending', source: 'automatic',
      evidence: 'Please use concise answers.', content: 'Prefer concise answers', extractionRunId: 'run-1',
    });
    const controller = createController([pending]);
    const wrapper = mountCenter(controller, { reviewRunId: 'run-1' });
    await flushPromises();

    expect(wrapper.find('.memory-evidence').text()).toContain('Please use concise answers.');
    await wrapper.find('.memory-review-approve').trigger('click');
    expect(controller.approveMemory).toHaveBeenCalledWith('memory-0', 1);

    await wrapper.find('.memory-review-edit').trigger('click');
    await wrapper.find('.memory-review-editor textarea').setValue('Prefer brief answers');
    await wrapper.find('.memory-review-editor').trigger('submit');
    expect(controller.approveMemory).toHaveBeenCalledWith('memory-0', 1, expect.objectContaining({ content: 'Prefer brief answers' }));

    await wrapper.find('.memory-review-reject').trigger('click');
    expect(controller.rejectMemory).toHaveBeenCalledWith('memory-0', 1);
    await wrapper.find('.memory-source-session').trigger('click');
    expect(wrapper.emitted('openSession')).toEqual([['session-0']]);
    await wrapper.find('.memory-extract-button').trigger('click');
    expect(controller.extractSession).toHaveBeenCalledWith('session-current');
  });

  it('renders loading, empty, error, overflow, and responsive states', async () => {
    const controller = createController([]);
    controller.loading.value = true;
    controller.error.value = 'Could not load memory';
    controller.counts.value.pinnedOverflow = true;
    const wrapper = mountCenter(controller);
    await flushPromises();

    expect(wrapper.find('.memory-loading').exists()).toBe(true);
    controller.loading.value = false;
    await nextTick();
    expect(wrapper.find('.memory-error').text()).toContain('Could not load memory');
    expect(wrapper.find('.memory-pinned-warning').exists()).toBe(true);
    controller.error.value = null;
    await nextTick();
    expect(wrapper.find('.memory-empty').exists()).toBe(true);
    expect(wrapper.find('.memory-center-dialog').classes()).toContain('memory-center-dialog--responsive');
  });

  it('resets stale review filters when profile or project context changes', async () => {
    const pending = record(0, {
      scope: 'global', projectId: undefined, status: 'pending', source: 'automatic', extractionRunId: 'run-1',
    });
    const controller = createController([pending]);
    const wrapper = mountCenter(controller, { reviewRunId: 'run-1' });
    await flushPromises();
    await wrapper.find('.memory-search').setValue('stale batch');
    controller.loadMemories.mockClear();

    await wrapper.setProps({
      profileLabel: 'work (~/.pi/work)',
      projectPath: '/repo/other',
      reviewRunId: undefined,
    });
    await flushPromises();

    expect(wrapper.find('[data-tab="project"]').classes()).toContain('is-active');
    expect((wrapper.find('.memory-search').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.memory-state-select .custom-select-value').text()).toBe('Active');
    expect(controller.loadMemories).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'project', statuses: ['active'], extractionRunId: undefined,
    }));
  });

  it('handles Escape and traps Tab focus inside the dialog', async () => {
    const wrapper = mountCenter();
    await flushPromises();
    const dialog = wrapper.find('.memory-center-dialog');

    await dialog.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    const focusable = Array.from(dialog.element.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'));
    focusable.at(-1)!.focus();
    await dialog.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('clamps keyboard selection to displayed memories and scrolls the active row', async () => {
    const controller = createController(Array.from({ length: 12 }, (_, index) => record(index)));
    const wrapper = mountCenter(controller);
    await flushPromises();
    const dialog = wrapper.find('.memory-center-dialog');

    for (let index = 0; index < 15; index += 1) {
      await dialog.trigger('keydown', { key: 'ArrowDown' });
    }
    const rows = wrapper.findAll('[data-memory-row]');
    expect(rows).toHaveLength(12);
    expect(rows[11].classes()).toContain('is-focused');
    await dialog.trigger('keydown', { key: 'ArrowUp' });
    expect(rows[10].classes()).toContain('is-focused');
    await dialog.trigger('keydown', { key: 'ArrowDown' });
    expect(rows[11].classes()).toContain('is-focused');

    await wrapper.find('.memory-search').setValue('Memory 0');
    expect(wrapper.findAll('[data-memory-row]')).toHaveLength(1);
    expect(wrapper.findAll('[data-memory-row]')[0].classes()).toContain('is-focused');
    await dialog.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.findAll('[data-memory-row]')[0].classes()).toContain('is-focused');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
