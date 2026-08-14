import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { MemoryExtractor } from './extractor.js';
import { LEGACY_MEMORY_POLICY } from './policy.js';
import { MemoryStore } from './store.js';

function branch() {
  return [
    {
      type: 'message', id: 'leaf-before', parentId: null, timestamp: '',
      message: { role: 'user', content: 'Earlier message', timestamp: 1 },
    },
    {
      type: 'message', id: 'leaf-user', parentId: 'leaf-before', timestamp: '',
      message: { role: 'user', content: 'Remember that managed worktrees share memory.', timestamp: 2 },
    },
    {
      type: 'message', id: 'leaf-after', parentId: 'leaf-user', timestamp: '',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Managed worktrees use the base project identity.' }],
        timestamp: 3,
      },
    },
  ] as any[];
}

describe('MemoryExtractor', () => {
  let db: PiuiDatabase;
  let store: MemoryStore;
  let run: ReturnType<MemoryStore['enqueueExtractionRun']>['run'];
  let completeModel: any;
  let registry: { find: any; getApiKeyAndHeaders: any };
  let runWithProxy: any;

  beforeEach(() => {
    db = openPiuiDatabase(':memory:');
    store = new MemoryStore(db);
    const project = store.getOrCreateProject('default', '/repo/app');
    store.createMemory({
      profileId: 'default', projectId: project.id, scope: 'project', category: 'decision',
      content: 'Use project path identity', tags: ['project'], pinned: false, status: 'active', source: 'manual_ui',
    });
    run = store.enqueueExtractionRun({
      profileId: 'default', projectId: project.id,
      sourceSessionId: 'session-1', sourceSessionPath: '/sessions/session-1.jsonl', sourceKind: 'automatic',
      startingLeafId: 'leaf-before', endingLeafId: 'leaf-after',
      modelProvider: 'openai-codex', modelId: 'gpt-5.5',
    }).run;
    run = store.claimNextExtractionRun('default')!;
    completeModel = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ candidates: [{
        operation: 'new', scope: 'project', category: 'fact',
        content: 'Managed worktrees use the base project identity', tags: ['worktree'],
        evidenceIds: ['e1', 'e2'],
      }] }) }],
      usage: { input: 120, output: 24, cacheRead: 80, cacheWrite: 4, totalTokens: 228 },
      stopReason: 'stop',
    }));
    registry = {
      find: vi.fn((provider: string, id: string) => ({ provider, id, api: 'anthropic-messages' })),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: 'test-key', headers: {}, env: {} })),
    };
    runWithProxy = vi.fn(async (_agentDir: string, work: () => Promise<unknown>) => work());
  });

  afterEach(() => {
    db.close();
  });

  function createExtractor(overrides: Record<string, unknown> = {}) {
    return new MemoryExtractor({
      store,
      resolveProfile: vi.fn(async () => ({
        id: 'default', label: 'default', path: '/profiles/default', isDefault: true,
        defaultProvider: 'anthropic', defaultModel: 'claude-sonnet',
        automationProvider: 'anthropic', automationModel: 'claude-haiku',
      })),
      runWithProxy,
      completeModel: completeModel as any,
      loadBranch: vi.fn(() => branch()),
      createModelRegistry: vi.fn(() => registry as any),
      ...overrides,
    });
  }

  it('uses the profile automation model, bounded options, profile proxy, and nearby memories', async () => {
    const signal = new AbortController().signal;

    const result = await createExtractor().execute(run, signal);

    expect(registry.find).toHaveBeenCalledWith('anthropic', 'claude-haiku');
    expect(runWithProxy).toHaveBeenCalledWith('/profiles/default', expect.any(Function));
    expect(completeModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', id: 'claude-haiku' }),
      expect.objectContaining({ messages: expect.any(Array) }),
      expect.objectContaining({ maxTokens: 4_096, maxRetries: 0, signal: expect.any(AbortSignal), apiKey: 'test-key' }),
    );
    const prompt = completeModel.mock.calls[0][1].messages[0].content[0].text;
    expect(prompt).toContain('Use project path identity');
    expect(prompt).toContain('managed worktrees share memory');
    expect(result).toMatchObject({ emittedCount: 1, discarded: 0, gateDecision: 'extract' });
    expect(result.candidates).toHaveLength(1);
    expect(store.getExtractionRun(run.id)).toMatchObject({
      modelProvider: 'anthropic',
      modelId: 'claude-haiku',
      gateDecision: 'extract',
      normalizedEvidenceCount: 2,
      inputTokens: 120,
      outputTokens: 24,
      cacheReadTokens: 80,
      cacheWriteTokens: 4,
      tokenAccountingMethod: 'provider-usage',
      promptFormatVersion: 'extraction-v2',
    });
  });

  it('reserves conflict context for weakly matched pinned instructions', async () => {
    for (let index = 0; index < 8; index += 1) {
      store.createMemory({
        profileId: 'default', projectId: run.projectId, scope: 'project', category: 'fact',
        content: `Managed worktrees conflict fact ${index}`, tags: ['worktree'], pinned: false,
        status: 'active', source: 'manual_ui',
      });
    }
    const pinned = store.createMemory({
      profileId: 'default', projectId: run.projectId, scope: 'project', category: 'rule',
      content: 'Never archive audit records', tags: ['audit'], pinned: true,
      status: 'active', source: 'manual_ui',
    });

    await createExtractor().execute(run, new AbortController().signal);

    const prompt = completeModel.mock.calls[0][1].messages[0].content[0].text;
    expect(prompt).toContain(pinned.content);
  });

  it('falls back to the profile default model', async () => {
    registry.find.mockImplementation((provider: string, id: string) => (
      provider === 'anthropic' && id === 'claude-sonnet' ? { provider, id, api: 'anthropic-messages' } : undefined
    ));

    await createExtractor().execute(run, new AbortController().signal);

    expect(completeModel.mock.calls[0][0]).toMatchObject({ provider: 'anthropic', id: 'claude-sonnet' });
  });

  it('reports missing models and authentication failures', async () => {
    registry.find.mockReturnValue(undefined);
    await expect(createExtractor().execute(run, new AbortController().signal)).rejects.toThrow(/model.*available/i);

    registry.find.mockReturnValue({ provider: 'anthropic', id: 'claude-haiku', api: 'anthropic-messages' });
    registry.getApiKeyAndHeaders.mockResolvedValue({ ok: false, error: 'Authentication failed' });
    await expect(createExtractor().execute(run, new AbortController().signal)).rejects.toThrow(/authentication failed/i);
  });

  it('skips clearly transient automatic deltas without calling a model', async () => {
    const transientBranch = [
      {
        type: 'message', id: 'leaf-before', parentId: null, timestamp: '',
        message: { role: 'user', content: 'Earlier message', timestamp: 1 },
      },
      {
        type: 'message', id: 'leaf-after', parentId: 'leaf-before', timestamp: '',
        message: { role: 'user', content: 'No need to write a plan, just implement this feature.', timestamp: 2 },
      },
    ] as any[];

    const result = await createExtractor({ loadBranch: vi.fn(() => transientBranch) })
      .execute(run, new AbortController().signal);

    expect(result).toMatchObject({ candidates: [], discarded: 0, gateDecision: 'skip' });
    expect(completeModel).not.toHaveBeenCalled();
    expect(store.getExtractionRun(run.id)).toMatchObject({
      gateDecision: 'skip',
      gateReasonCode: 'transient-task',
      normalizedEvidenceCount: 1,
    });
  });

  it('can roll extraction back to the legacy full-slice policy with the shared switch', async () => {
    completeModel.mockResolvedValue({
      content: [{ type: 'text', text: '{"candidates":[]}' }],
      usage: { input: 12, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 16 },
      stopReason: 'stop',
    });
    const transientBranch = [
      {
        type: 'message', id: 'leaf-before', parentId: null, timestamp: '',
        message: { role: 'user', content: 'Earlier message', timestamp: 1 },
      },
      {
        type: 'message', id: 'leaf-after', parentId: 'leaf-before', timestamp: '',
        message: { role: 'user', content: 'No need to write a plan, just implement this feature.', timestamp: 2 },
      },
    ] as any[];

    const result = await createExtractor({
      policy: LEGACY_MEMORY_POLICY,
      loadBranch: vi.fn(() => transientBranch),
    }).execute(run, new AbortController().signal);

    expect(result.gateDecision).toBe('extract');
    expect(completeModel).toHaveBeenCalledTimes(1);
    expect(completeModel.mock.calls[0][1].messages[0].content[0].text).toContain('<conversation_json>');
    expect(store.getExtractionRun(run.id)).toMatchObject({ promptFormatVersion: 'extraction-v1' });
  });

  it('fails open to extraction when the durable-signal gate throws', async () => {
    await createExtractor({ evaluateGate: vi.fn(() => { throw new Error('gate failed'); }) })
      .execute(run, new AbortController().signal);

    expect(completeModel).toHaveBeenCalledTimes(1);
    expect(store.getExtractionRun(run.id)).toMatchObject({
      gateDecision: 'extract',
      gateReasonCode: 'gate-error',
    });
  });

  it('classifies malformed model output for one coordinator retry without logging output text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    completeModel.mockResolvedValue({
      content: [{ type: 'text', text: 'malformed secret-bearing output' }],
      usage: { input: 12, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 16 },
      stopReason: 'stop',
    });

    await expect(createExtractor().execute(run, new AbortController().signal))
      .rejects.toMatchObject({ retryable: true, kind: 'schema' });
    expect(warn).toHaveBeenCalledWith('[memory] extraction failed:', expect.not.objectContaining({
      outputPreview: expect.anything(),
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-bearing');
    warn.mockRestore();
  });

  it('uses its single retry to fall back when native structured output is unsupported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    completeModel
      .mockResolvedValueOnce({
        content: [],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'error',
        errorMessage: '400 Unknown parameter: output_config.format is not supported',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"candidates":[]}' }],
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
        stopReason: 'stop',
      });
    const extractor = createExtractor();

    await expect(extractor.execute(run, new AbortController().signal))
      .rejects.toMatchObject({ retryable: true, kind: 'schema' });
    store.requeueRun(run.id, 'schema fallback');
    run = store.claimNextExtractionRun('default')!;
    await extractor.execute(run, new AbortController().signal);

    expect(completeModel.mock.calls[0][2].onPayload).toEqual(expect.any(Function));
    expect(completeModel.mock.calls[1][2].onPayload).toBeUndefined();
    expect(completeModel.mock.calls[1][1]).toEqual(completeModel.mock.calls[0][1]);
    warn.mockRestore();
  });

  it('does not retry deterministic provider authentication failures', async () => {
    completeModel.mockResolvedValue({
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'error',
      errorMessage: '401 invalid_api_key',
    });

    await expect(createExtractor().execute(run, new AbortController().signal))
      .rejects.toThrow('401 invalid_api_key');
  });

  it('classifies legacy transport and schema failures for the coordinator retry', async () => {
    completeModel.mockResolvedValueOnce({
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'error',
      errorMessage: '503 service temporarily unavailable',
    });
    await expect(createExtractor({ policy: LEGACY_MEMORY_POLICY }).execute(run, new AbortController().signal))
      .rejects.toMatchObject({ retryable: true, kind: 'transport' });

    completeModel.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }],
      usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
      stopReason: 'stop',
    });
    await expect(createExtractor({ policy: LEGACY_MEMORY_POLICY }).execute(run, new AbortController().signal))
      .rejects.toMatchObject({ retryable: true, kind: 'schema' });
  });

  it('reuses identical normalized input, model, schema, and timestamp for its one retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    completeModel
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not json' }],
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
        stopReason: 'stop',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"candidates":[]}' }],
        usage: { input: 10, output: 2, cacheRead: 10, cacheWrite: 0, totalTokens: 22 },
        stopReason: 'stop',
      });
    const extractor = createExtractor();

    await expect(extractor.execute(run, new AbortController().signal)).rejects.toMatchObject({ retryable: true });
    store.requeueRun(run.id, 'schema retry');
    run = store.claimNextExtractionRun('default')!;
    await extractor.execute(run, new AbortController().signal);

    const [firstModel, firstContext, firstOptions] = completeModel.mock.calls[0];
    const [secondModel, secondContext, secondOptions] = completeModel.mock.calls[1];
    expect(secondModel).toBe(firstModel);
    expect(secondContext).toEqual(firstContext);
    expect(secondOptions.sessionId).toBe(firstOptions.sessionId);
    expect(secondOptions.maxTokens).toBe(firstOptions.maxTokens);
    expect(secondOptions.onPayload({ model: 'test' })).toEqual(firstOptions.onPayload({ model: 'test' }));
    expect(store.getExtractionRun(run.id)).toMatchObject({
      inputTokens: 20,
      outputTokens: 4,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
    });
    warn.mockRestore();
  });

  it('passes an abortable signal through to the provider call', async () => {
    const controller = new AbortController();
    completeModel.mockImplementation(async (_model: any, _context: any, options: any) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      controller.abort();
      await vi.waitFor(() => expect(options.signal.aborted).toBe(true));
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(createExtractor().execute(run, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
