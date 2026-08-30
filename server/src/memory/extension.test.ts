import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryExtension } from './extension.js';

function resolveAutoExtractionEnabled(value: boolean | (() => boolean) | undefined): boolean {
  if (typeof value === 'function') return value();
  return value !== false;
}

function setup(options: { autoExtractionEnabled?: boolean | (() => boolean) } = {}) {
  const handlers: Record<string, Function> = {};
  let tool: any;
  const pi = {
    on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
    registerTool: vi.fn((definition: any) => { tool = definition; }),
  };
  const memoryContext = {
    profileId: 'default',
    project: { id: 'project-1', profileId: 'default', canonicalPath: '/repo', createdAt: '', updatedAt: '' },
    sessionId: 'session-1',
    sessionPath: '/sessions/session-1.jsonl',
  };
  const service = {
    resolveContext: vi.fn(async () => memoryContext),
    buildRecallPrompt: vi.fn(() => '# remembered'),
    buildRecall: vi.fn((): any => ({
      prompt: '# remembered',
      tokenCount: 12,
      memories: [{ id: 'memory-1', scope: 'project', category: 'fact', content: 'Remembered', reason: 'query-match' }],
    })),
    save: vi.fn(() => ({ id: 'memory-1', revision: 1, content: 'Remembered' })),
    search: vi.fn(() => [{ id: 'memory-1', revision: 1, content: 'Remembered' }]),
    update: vi.fn(() => ({ id: 'memory-1', revision: 2, content: 'Updated' })),
    forget: vi.fn(() => ({ id: 'memory-1', revision: 2, status: 'archived' })),
  };
  const enqueueAutomatic = vi.fn(async () => ({ id: 'run-1' }));
  const onRecall = vi.fn();
  const inline = createMemoryExtension({
    profileId: 'default',
    service: service as any,
    enqueueAutomatic,
    isAutoExtractionEnabled: () => resolveAutoExtractionEnabled(options.autoExtractionEnabled),
    onRecall,
  });
  if (typeof inline === 'function') throw new Error('Expected a named inline extension');
  inline.factory(pi as any);

  let leafId: string | null = 'leaf-before';
  const context = {
    cwd: '/repo',
    sessionManager: {
      getLeafId: () => leafId,
      getSessionId: () => 'session-1',
      getSessionFile: () => '/sessions/session-1.jsonl',
    },
    model: { provider: 'openai-codex', id: 'gpt-5.5' },
  } as any;

  return {
    handlers,
    get tool() { return tool; },
    inline,
    pi,
    service,
    enqueueAutomatic,
    onRecall,
    context,
    setLeaf: (value: string | null) => { leafId = value; },
  };
}

describe('createMemoryExtension', () => {
  let harness: ReturnType<typeof setup>;

  beforeEach(() => {
    harness = setup();
  });

  it('registers a named durable-memory tool', () => {
    expect(harness.inline.name).toBe('pi-cloud-memory');
    expect(harness.pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'memory',
      promptSnippet: expect.stringContaining('durable'),
      executionMode: 'sequential',
    }));
  });

  it('injects recalled memory before an agent starts', async () => {
    const result = await harness.handlers.before_agent_start({
      type: 'before_agent_start',
      prompt: 'How should keyboard selection work?',
      systemPrompt: 'base',
    }, harness.context);

    expect(harness.service.resolveContext).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'default', cwd: '/repo', sessionId: 'session-1',
    }));
    expect(harness.service.buildRecall).toHaveBeenCalledWith(expect.any(Object), 'How should keyboard selection work?');
    expect(harness.onRecall).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'default',
      projectId: 'project-1',
      sessionId: 'session-1',
      prompt: 'How should keyboard selection work?',
      injected: true,
      tokenCount: 12,
      memories: [expect.objectContaining({ id: 'memory-1', reason: 'query-match' })],
    }));
    expect(result).toEqual({ systemPrompt: 'base\n\n# remembered' });
  });

  it('emits a zero-injection trace without changing the system prompt', async () => {
    harness.service.buildRecall.mockReturnValueOnce({
      prompt: '',
      tokenCount: 0,
      memories: [],
      diagnostics: { skipReason: 'not-substantive' },
    });

    await expect(harness.handlers.before_agent_start({
      type: 'before_agent_start', prompt: 'thanks', systemPrompt: 'base',
    }, harness.context)).resolves.toBeUndefined();
    expect(harness.onRecall).toHaveBeenCalledWith(expect.objectContaining({
      injected: false,
      tokenCount: 0,
      memories: [],
      diagnostics: { skipReason: 'not-substantive' },
    }));
  });

  it('fails open and emits bounded diagnostics when recall throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    harness.service.buildRecall.mockImplementationOnce(() => { throw new Error('database busy'); });

    await expect(harness.handlers.before_agent_start({
      type: 'before_agent_start', prompt: 'hello', systemPrompt: 'base',
    }, harness.context)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[memory] recall failed:', 'Error');
    expect(harness.onRecall).toHaveBeenCalledWith(expect.objectContaining({
      injected: false,
      tokenCount: 0,
      memories: [],
      diagnostics: expect.objectContaining({ skipReason: 'recall-error' }),
    }));
    expect(JSON.stringify(harness.onRecall.mock.calls)).not.toContain('database busy');
    warn.mockRestore();
  });

  it('enqueues only a changed settled leaf and advances its baseline', async () => {
    await harness.handlers.session_start({ type: 'session_start', reason: 'startup' }, harness.context);
    await harness.handlers.agent_settled({ type: 'agent_settled' }, harness.context);
    expect(harness.enqueueAutomatic).not.toHaveBeenCalled();

    harness.setLeaf('leaf-after');
    await harness.handlers.agent_settled({ type: 'agent_settled' }, harness.context);
    expect(harness.enqueueAutomatic).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'default',
      projectId: 'project-1',
      sourceSessionId: 'session-1',
      startingLeafId: 'leaf-before',
      endingLeafId: 'leaf-after',
      modelProvider: 'openai-codex',
      modelId: 'gpt-5.5',
    }));

    await harness.handlers.agent_settled({ type: 'agent_settled' }, harness.context);
    expect(harness.enqueueAutomatic).toHaveBeenCalledTimes(1);
  });

  it('skips automatic extraction when disabled and advances its baseline', async () => {
    let enabled = false;
    harness = setup({ autoExtractionEnabled: () => enabled });
    await harness.handlers.session_start({ type: 'session_start', reason: 'startup' }, harness.context);
    harness.setLeaf('leaf-disabled');

    await harness.handlers.agent_settled({ type: 'agent_settled' }, harness.context);
    expect(harness.enqueueAutomatic).not.toHaveBeenCalled();

    enabled = true;
    harness.setLeaf('leaf-enabled');
    await harness.handlers.agent_settled({ type: 'agent_settled' }, harness.context);
    expect(harness.enqueueAutomatic).toHaveBeenCalledWith(expect.objectContaining({
      startingLeafId: 'leaf-disabled', endingLeafId: 'leaf-enabled',
    }));
  });

  it('resets the extraction baseline after tree navigation', async () => {
    await harness.handlers.session_start({ type: 'session_start', reason: 'startup' }, harness.context);
    await harness.handlers.session_tree({ type: 'session_tree', newLeafId: 'branch-leaf', oldLeafId: 'leaf-before' }, harness.context);
    harness.setLeaf('branch-next');

    await harness.handlers.agent_settled({ type: 'agent_settled' }, harness.context);

    expect(harness.enqueueAutomatic).toHaveBeenCalledWith(expect.objectContaining({
      startingLeafId: 'branch-leaf', endingLeafId: 'branch-next',
    }));
  });

  it('routes explicit tool operations through the scoped service', async () => {
    const execute = harness.tool.execute;
    const save = await execute('call-1', {
      operation: 'save', content: 'Remember this', category: 'fact', tags: ['project'], scope: 'project',
      pinned: true, pinnedApplicability: 'matched',
    }, undefined, undefined, harness.context);
    const search = await execute('call-2', { operation: 'search', query: 'remember' }, undefined, undefined, harness.context);
    const update = await execute('call-3', {
      operation: 'update', id: 'memory-1', expectedRevision: 1, content: 'Updated', category: 'decision',
      pinnedApplicability: 'always',
    }, undefined, undefined, harness.context);
    const forget = await execute('call-4', {
      operation: 'forget', id: 'memory-1', expectedRevision: 2,
    }, undefined, undefined, harness.context);

    expect(harness.service.save).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      pinnedApplicability: 'matched',
    }));
    expect(harness.service.search).toHaveBeenCalled();
    expect(harness.service.update).toHaveBeenCalledWith(expect.any(Object), 'memory-1', 1, expect.objectContaining({
      pinnedApplicability: 'always',
    }));
    expect(harness.service.forget).toHaveBeenCalled();
    expect([save, search, update, forget].every((result) => result.content[0].type === 'text')).toBe(true);
  });

  it('rejects missing operation-specific parameters', async () => {
    await expect(harness.tool.execute('call-1', { operation: 'save' }, undefined, undefined, harness.context))
      .rejects.toThrow(/content and category/i);
    await expect(harness.tool.execute('call-2', { operation: 'forget', id: 'memory-1' }, undefined, undefined, harness.context))
      .rejects.toThrow(/revision/i);
  });
});
