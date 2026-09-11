import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useSessionRuntime } from './useSessionRuntime';

function setup(overrides: Record<string, unknown> = {}) {
  const notify = vi.fn();
  const options = {
    sessionId: () => 's1', clientId: () => 'c1', modelInfo: () => '', isStreaming: ref(false),
    configureNewSession: vi.fn(), notify, t: (key: string) => key, ...overrides,
  };
  return { runtime: useSessionRuntime(options as any), options, notify };
}

describe('useSessionRuntime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refreshes status and derives model and thinking labels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: { id: 'openai / gpt' }, thinkingLevels: ['low', 'high'] }), { status: 200 })));
    const { runtime } = setup();
    await runtime.refreshSessionStatus();
    expect(runtime.composerModelLabel.value).toBe('gpt');
    expect(runtime.thinkingLevels.value).toEqual(['low', 'high']);
    runtime.openThinkingSelector();
    expect(runtime.thinkingSelectorOpen.value).toBe(true);
    runtime.closeThinkingSelector();
  });

  it('clears status for missing identity and failed requests', async () => {
    const missing = setup({ sessionId: () => undefined });
    await missing.runtime.refreshSessionStatus();
    expect(missing.runtime.sessionStatus.value).toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const failed = setup();
    await failed.runtime.refreshSessionStatus();
    expect(failed.runtime.sessionStatus.value).toBeNull();
  });

  it('loads, filters, navigates, and selects models', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ provider: 'openai', id: 'gpt', name: 'GPT', current: true }, { provider: 'x', id: 'other' }, { bad: true }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: { provider: 'x', id: 'other' }, thinkingLevels: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { runtime, notify } = setup();
    const focus = vi.fn();
    runtime.modelSearchRef.value = { focus } as any;
    await runtime.openModelSelector('gp');
    expect(focus).toHaveBeenCalled();
    expect(runtime.filteredModels.value).toHaveLength(1);
    expect(runtime.activeModelIndex.value).toBe(0);
    runtime.handleModelSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    runtime.handleModelSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    runtime.handleModelSearchKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    await nextTick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' })));
    expect(runtime.modelSelectorOpen.value).toBe(false);
  });

  it('handles model loading and selection failures and selector fallbacks', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'load failed' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'change failed' }), { status: 400 })));
    const { runtime } = setup();
    await runtime.openModelSelector();
    expect(runtime.modelSelectorError.value).toBe('load failed');
    runtime.modelOptions.value = [{ provider: 'p', id: 'm' }];
    await runtime.selectModel(runtime.modelOptions.value[0]);
    expect(runtime.modelSelectorError.value).toBe('change failed');
    runtime.handleModelSearchKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    const configure = vi.fn();
    setup({ sessionId: () => undefined, configureNewSession: configure }).runtime.handleModelSelectorClick();
    expect(configure).toHaveBeenCalled();
  });

  it('changes thinking level and reports provider failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ thinkingLevel: 'high' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'no level' }), { status: 400 })));
    const { runtime, notify } = setup();
    await runtime.selectThinkingLevel('high');
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success' }));
    await runtime.selectThinkingLevel('low');
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failure', content: 'no level' }));
    await runtime.selectThinkingLevel('');
  });

  it('prevents thinking selection while unavailable or streaming', () => {
    const first = setup();
    first.runtime.openThinkingSelector();
    expect(first.runtime.thinkingSelectorOpen.value).toBe(false);
    first.runtime.sessionStatus.value = { thinkingLevels: ['low'] };
    first.options.isStreaming.value = true;
    first.runtime.openThinkingSelector();
    expect(first.runtime.thinkingSelectorOpen.value).toBe(false);
    expect(setup({ modelInfo: () => 'fallback' }).runtime.composerModelLabel.value).toBe('fallback');
  });
});
