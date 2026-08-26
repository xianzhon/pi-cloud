import { complete } from '@earendil-works/pi-ai/compat';
import {
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { dirname, join } from 'node:path';
import type { AgentProfile } from '../types.js';
import { evaluateDurableSignal, type ExtractionGateResult } from './extraction-gate.js';
import {
  buildExtractionPrompt as buildLegacyExtractionPrompt,
  buildExtractionSource as buildLegacyExtractionSource,
  parseExtractionOutput as parseLegacyExtractionOutput,
} from './legacy-extraction.js';
import { toFtsQuery as toLegacyFtsQuery } from './legacy-recall.js';
import { ADAPTIVE_MEMORY_POLICY, type MemoryEfficiencyPolicy } from './policy.js';
import {
  buildExtractionPrompt,
  buildExtractionSource,
  EXTRACTION_PROMPT_FORMAT_VERSION,
  parseExtractionOutput,
  type ExtractionSource,
} from './extraction-format.js';
import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  extractionStructuredOutput,
  type ExtractionStructuredOutputAdapter,
} from './extraction-provider.js';
import { buildExtractionQueries } from './extraction-query.js';
import { estimateTokens, TOKEN_ESTIMATOR_VERSION } from './recall.js';
import { MemoryStore } from './store.js';
import type { MemoryExtractionRun, MemoryRecord, ValidatedExtractionCandidate } from './types.js';

interface ModelRegistryLike {
  find(provider: string, modelId: string): any;
  getApiKeyAndHeaders(model: any): Promise<any>;
}

interface MemoryExtractorDependencies {
  store: MemoryStore;
  resolveProfile(profileId: string): Promise<AgentProfile | undefined>;
  runWithProxy<T>(agentDir: string, work: () => Promise<T>): Promise<T>;
  completeModel?: typeof complete;
  loadBranch?: (run: MemoryExtractionRun) => SessionEntry[];
  createModelRegistry?: (profile: AgentProfile) => ModelRegistryLike | Promise<ModelRegistryLike>;
  evaluateGate?: (source: ExtractionSource) => ExtractionGateResult;
  policy?: MemoryEfficiencyPolicy;
}

export interface MemoryExtractorResult {
  candidates: ValidatedExtractionCandidate[];
  emittedCount: number;
  discarded: number;
  gateDecision: 'extract' | 'skip';
}

const EXTRACTION_TIMEOUT_MS = 45_000;

type RetryableExtractionKind = 'transport' | 'schema';

export class RetryableExtractionError extends Error {
  readonly retryable = true;

  constructor(readonly kind: RetryableExtractionKind, message: string) {
    super(message);
    this.name = 'RetryableExtractionError';
  }
}

export function isRetryableExtractionError(error: unknown): error is RetryableExtractionError {
  return error instanceof RetryableExtractionError;
}

interface PreparedExtraction {
  profile: AgentProfile;
  registry: ModelRegistryLike;
  model: any;
  source: ExtractionSource;
  existingMemories: MemoryRecord[];
  prompt: string;
  gate: ExtractionGateResult;
  timestamp: number;
  structuredOutput: ExtractionStructuredOutputAdapter;
}

export class MemoryExtractor {
  private readonly completeModel: typeof complete;
  private readonly loadBranch: (run: MemoryExtractionRun) => SessionEntry[];
  private readonly createModelRegistry: (profile: AgentProfile) => ModelRegistryLike | Promise<ModelRegistryLike>;
  private readonly evaluateGate: (source: ExtractionSource) => ExtractionGateResult;
  private readonly policy: MemoryEfficiencyPolicy;
  private readonly preparedRuns = new Map<string, Promise<PreparedExtraction | { source: ExtractionSource; gate: ExtractionGateResult }>>();

  constructor(private readonly dependencies: MemoryExtractorDependencies) {
    this.completeModel = dependencies.completeModel ?? complete;
    this.loadBranch = dependencies.loadBranch ?? ((run) => (
      SessionManager.open(run.sourceSessionPath, dirname(run.sourceSessionPath)).getBranch(run.endingLeafId)
    ));
    this.createModelRegistry = dependencies.createModelRegistry ?? (async (profile) => {
      const runtime = await ModelRuntime.create({
        authPath: join(profile.path, 'auth.json'),
        modelsPath: join(profile.path, 'models.json'),
      });
      return new ModelRegistry(runtime);
    });
    this.evaluateGate = dependencies.evaluateGate ?? evaluateDurableSignal;
    this.policy = dependencies.policy ?? ADAPTIVE_MEMORY_POLICY;
  }

  async execute(run: MemoryExtractionRun, signal: AbortSignal): Promise<MemoryExtractorResult> {
    if (this.policy !== ADAPTIVE_MEMORY_POLICY) return this.executeLegacy(run, signal);
    const providerSignal = withTimeoutSignal(signal, EXTRACTION_TIMEOUT_MS);

    let preparedPromise = this.preparedRuns.get(run.id);
    if (!preparedPromise) {
      preparedPromise = this.prepare(run);
      this.preparedRuns.set(run.id, preparedPromise);
      this.evictOldPreparedRuns();
    }

    let prepared: Awaited<typeof preparedPromise>;
    try {
      prepared = await preparedPromise;
    } catch (error) {
      this.preparedRuns.delete(run.id);
      throw error;
    }

    if (prepared.gate.decision === 'skip') {
      this.preparedRuns.delete(run.id);
      return { candidates: [], emittedCount: 0, discarded: 0, gateDecision: 'skip' };
    }

    const preparedInput = prepared as PreparedExtraction;
    const { profile, registry, model, source, existingMemories, prompt, timestamp } = preparedInput;
    let response: Awaited<ReturnType<typeof complete>>;
    try {
      response = await this.dependencies.runWithProxy(profile.path, async () => {
        const auth = await registry.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error(auth.error || 'Memory extraction authentication failed');
        if (!auth.apiKey) throw new Error(`No API key available for ${model.provider}/${model.id}`);
        return this.completeModel(
          model,
          {
            messages: [{
              role: 'user' as const,
              content: [{ type: 'text' as const, text: prompt }],
              timestamp,
            }],
          },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            env: auth.env,
            maxTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
            maxRetries: 0,
            cacheRetention: 'short',
            sessionId: `memory-extraction:${run.id}`,
            onPayload: preparedInput.structuredOutput.onPayload,
            signal: providerSignal,
          },
        );
      });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      if (isAbort(error, providerSignal)) {
        throw new RetryableExtractionError('transport', 'Memory extraction timed out');
      }
      this.classifyAdaptiveProviderFailure(run, model, preparedInput, error);
    }

    const output = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    this.recordUsage(run.id, prompt, output, response.usage);

    if (response.stopReason === 'aborted' || signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (response.stopReason === 'error') {
      this.classifyAdaptiveProviderFailure(
        run,
        model,
        preparedInput,
        providerResponseError(response.errorMessage),
      );
    }
    if (response.stopReason === 'length') {
      const failure = new RetryableExtractionError('schema', 'Memory extraction output was truncated');
      this.warnFailure(run, model, failure);
      throw failure;
    }

    try {
      const parsed = parseExtractionOutput(output, source, existingMemories);
      this.preparedRuns.delete(run.id);
      return {
        candidates: parsed.valid,
        emittedCount: parsed.emittedCount,
        discarded: parsed.discarded,
        gateDecision: 'extract',
      };
    } catch {
      const failure = new RetryableExtractionError('schema', 'Memory extraction output failed schema validation');
      this.warnFailure(run, model, failure);
      throw failure;
    }
  }

  private classifyAdaptiveProviderFailure(
    run: MemoryExtractionRun,
    model: any,
    prepared: PreparedExtraction,
    error: unknown,
  ): never {
    if (prepared.structuredOutput.method === 'native-json-schema' && isUnsupportedSchemaError(error)) {
      prepared.structuredOutput = { method: 'prompt-json' };
      const failure = new RetryableExtractionError('schema', 'Memory extraction native schema is unsupported');
      this.warnFailure(run, model, failure);
      throw failure;
    }
    if (isRetryableTransportError(error)) {
      const failure = new RetryableExtractionError('transport', 'Memory extraction transport failed');
      this.warnFailure(run, model, failure);
      throw failure;
    }
    this.preparedRuns.delete(run.id);
    throw error instanceof Error ? error : new Error('Memory extraction provider failed');
  }

  private async executeLegacy(run: MemoryExtractionRun, signal: AbortSignal): Promise<MemoryExtractorResult> {
    const providerSignal = withTimeoutSignal(signal, EXTRACTION_TIMEOUT_MS);
    const source = buildLegacyExtractionSource(
      this.loadBranch(run),
      run.startingLeafId,
      run.endingLeafId,
    );
    this.dependencies.store.updateExtractionRunTelemetry(run.id, {
      gateDecision: source.text.trim() ? 'extract' : 'skip',
      gateReasonCode: source.text.trim() ? 'legacy-policy' : 'no-evidence',
      normalizedEvidenceCount: source.evidence.length,
      promptFormatVersion: 'extraction-v1',
    });
    if (!source.text.trim()) {
      return { candidates: [], emittedCount: 0, discarded: 0, gateDecision: 'skip' };
    }

    const profile = await this.dependencies.resolveProfile(run.profileId);
    if (!profile) throw new Error(`Memory extraction profile is unavailable: ${run.profileId}`);
    const query = toLegacyFtsQuery(source.text);
    const existingMemories = query
      ? this.dependencies.store.searchMemories({
          profileId: run.profileId,
          projectId: run.projectId,
          statuses: ['active', 'pending'],
          query,
          limit: 12,
        })
      : [];
    const prompt = buildLegacyExtractionPrompt(source, existingMemories);
    const registry = await this.createModelRegistry(profile);
    const model = this.selectModel(profile, registry);
    this.dependencies.store.updateExtractionRunTelemetry(run.id, {
      modelProvider: model.provider,
      modelId: model.id,
    });

    let response: Awaited<ReturnType<typeof complete>>;
    try {
      response = await this.dependencies.runWithProxy(profile.path, async () => {
        const auth = await registry.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error(auth.error || 'Memory extraction authentication failed');
        if (!auth.apiKey) throw new Error(`No API key available for ${model.provider}/${model.id}`);
        return this.completeModel(
          model,
          {
            messages: [{
              role: 'user' as const,
              content: [{ type: 'text' as const, text: prompt }],
              timestamp: Date.parse(run.createdAt) || 0,
            }],
          },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            env: auth.env,
            maxTokens: 2_048,
            maxRetries: 0,
            signal: providerSignal,
          },
        );
      });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      if (isAbort(error, providerSignal)) {
        throw new RetryableExtractionError('transport', 'Memory extraction timed out');
      }
      if (isRetryableTransportError(error)) {
        throw new RetryableExtractionError('transport', 'Memory extraction transport failed');
      }
      throw error;
    }
    const output = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    this.recordUsage(run.id, prompt, output, response.usage);
    if (response.stopReason === 'aborted' || signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (response.stopReason === 'error') {
      const error = providerResponseError(response.errorMessage);
      if (isRetryableTransportError(error)) {
        throw new RetryableExtractionError('transport', 'Memory extraction transport failed');
      }
      throw error;
    }
    if (response.stopReason === 'length') {
      throw new RetryableExtractionError('schema', 'Memory extraction output was truncated');
    }
    let parsed: ReturnType<typeof parseLegacyExtractionOutput>;
    try {
      parsed = parseLegacyExtractionOutput(output, source, existingMemories);
    } catch {
      throw new RetryableExtractionError('schema', 'Memory extraction output failed schema validation');
    }
    return {
      candidates: parsed.valid,
      emittedCount: parsed.valid.length + parsed.discarded,
      discarded: parsed.discarded,
      gateDecision: 'extract',
    };
  }

  private async prepare(
    run: MemoryExtractionRun,
  ): Promise<PreparedExtraction | { source: ExtractionSource; gate: ExtractionGateResult }> {
    const branch = this.loadBranch(run);
    const source = buildExtractionSource(branch, run.startingLeafId, run.endingLeafId);
    let gate: ExtractionGateResult;
    if (run.sourceKind === 'session_import') {
      gate = { decision: 'extract', reasonCode: 'explicit-import' };
    } else {
      try {
        gate = this.evaluateGate(source);
      } catch {
        gate = { decision: 'extract', reasonCode: 'gate-error' };
      }
    }
    this.dependencies.store.updateExtractionRunTelemetry(run.id, {
      gateDecision: gate.decision,
      gateReasonCode: gate.reasonCode,
      normalizedEvidenceCount: source.evidence.length,
      promptFormatVersion: EXTRACTION_PROMPT_FORMAT_VERSION,
    });
    if (!source.text.trim() || gate.decision === 'skip') return { source, gate: { ...gate, decision: 'skip' } };

    const profile = await this.dependencies.resolveProfile(run.profileId);
    if (!profile) throw new Error(`Memory extraction profile is unavailable: ${run.profileId}`);
    const existingMemories = this.collectExistingMemories(run, source);
    const prompt = buildExtractionPrompt(source, existingMemories);
    const registry = await this.createModelRegistry(profile);
    const model = this.selectModel(profile, registry);
    this.dependencies.store.updateExtractionRunTelemetry(run.id, {
      modelProvider: model.provider,
      modelId: model.id,
    });

    return {
      profile,
      registry,
      model,
      source,
      existingMemories,
      prompt,
      gate,
      timestamp: Date.parse(run.createdAt) || 0,
      structuredOutput: extractionStructuredOutput(model),
    };
  }

  private collectExistingMemories(run: MemoryExtractionRun, source: ExtractionSource): MemoryRecord[] {
    const lexical: MemoryRecord[] = [];
    const lexicalIds = new Set<string>();
    for (const query of buildExtractionQueries(source)) {
      for (const memory of this.dependencies.store.searchMemories({
        profileId: run.profileId,
        projectId: run.projectId,
        statuses: ['active', 'pending'],
        query,
        limit: 8,
      })) {
        if (lexical.length >= 8 || lexicalIds.has(memory.id)) continue;
        lexicalIds.add(memory.id);
        lexical.push(memory);
      }
      if (lexical.length >= 8) break;
    }

    const weakPinned = this.dependencies.store.listPinned(run.profileId, run.projectId)
      .filter((memory) => !lexicalIds.has(memory.id))
      .slice(0, 2);
    const selected = lexical.slice(0, 8 - weakPinned.length);
    selected.push(...weakPinned);
    for (const memory of lexical) {
      if (selected.length >= 8) break;
      if (!selected.some((item) => item.id === memory.id)) selected.push(memory);
    }
    return selected;
  }

  private selectModel(profile: AgentProfile, registry: ModelRegistryLike): any {
    const automationModel = profile.automationProvider && profile.automationModel
      ? registry.find(profile.automationProvider, profile.automationModel)
      : undefined;
    const fallbackModel = profile.defaultProvider && profile.defaultModel
      ? registry.find(profile.defaultProvider, profile.defaultModel)
      : undefined;
    const model = automationModel ?? fallbackModel;
    if (!model) throw new Error('No memory extraction model is available');
    return model;
  }

  private recordUsage(runId: string, prompt: string, output: string, usage: unknown): void {
    if (isUsage(usage)) {
      this.dependencies.store.updateExtractionRunTelemetry(runId, {
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        tokenAccountingMethod: 'provider-usage',
      });
      return;
    }
    this.dependencies.store.updateExtractionRunTelemetry(runId, {
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(output),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokenAccountingMethod: TOKEN_ESTIMATOR_VERSION,
    });
  }

  private warnFailure(run: MemoryExtractionRun, model: any, error: RetryableExtractionError): void {
    console.warn('[memory] extraction failed:', {
      runId: run.id,
      modelProvider: model.provider,
      modelId: model.id,
      kind: error.kind,
      error: error.message,
    });
  }

  private evictOldPreparedRuns(): void {
    if (this.preparedRuns.size <= 100) return;
    const first = this.preparedRuns.keys().next().value;
    if (first) this.preparedRuns.delete(first);
  }
}

function withTimeoutSignal(parent: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController();
  if (parent.aborted) {
    controller.abort();
    return controller.signal;
  }

  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  timer.unref?.();
  parent.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
  }, { once: true });
  return controller.signal;
}

function isUsage(value: unknown): value is {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Record<string, unknown>;
  return ['input', 'output', 'cacheRead', 'cacheWrite']
    .every((key) => typeof usage[key] === 'number' && Number.isFinite(usage[key]));
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function providerResponseError(message: string | undefined): Error {
  return new Error(message?.trim() || 'Memory extraction provider failed');
}

function isUnsupportedSchemaError(error: unknown): boolean {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (status === 400 || status === 422 || status === undefined)
    && /(?:response[_ .-]?format|output[_ .-]?config|text\.format|json[_ .-]?schema|structured output|responseJsonSchema|unknown (?:field|parameter)).*(?:unsupported|unknown|invalid|not (?:allowed|supported))|(?:unsupported|unknown|invalid|not (?:allowed|supported)).*(?:response[_ .-]?format|output[_ .-]?config|text\.format|json[_ .-]?schema|structured output|responseJsonSchema)/i.test(message);
}

function isRetryableTransportError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined) return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  if (!(error instanceof Error)) return false;
  return /(?:timeout|timed out|network|connection|socket|fetch failed|temporarily unavailable|rate limit|overloaded)/i.test(error.message);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; message?: unknown };
  const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  if (typeof status === 'number') return status;
  if (typeof candidate.message === 'string') {
    const match = candidate.message.match(/(?:^|\D)([45]\d\d)(?:\D|$)/);
    if (match) return Number(match[1]);
  }
  return undefined;
}
