import {
  buildMemoryPrompt as buildLegacyMemoryPrompt,
  estimateTokens as estimateLegacyTokens,
  MAX_RELEVANT_MEMORIES as LEGACY_MAX_RELEVANT_MEMORIES,
  PINNED_MEMORY_TOKEN_BUDGET as LEGACY_PINNED_BUDGET,
  RELEVANT_MEMORY_TOKEN_BUDGET as LEGACY_RELEVANT_BUDGET,
  takeWithinBudget as takeWithinLegacyBudget,
  toFtsQuery as toLegacyFtsQuery,
} from './legacy-recall.js';
import { ADAPTIVE_MEMORY_POLICY, type MemoryEfficiencyPolicy } from './policy.js';
import { MemoryProjectResolver } from './project-resolver.js';
import {
  analyzeMemoryQuery,
  buildMemoryPrompt,
  determineMemoryBudget,
  estimateTokens,
  MAX_RECALL_CANDIDATES,
  MEMORY_PROMPT_FORMAT_VERSION,
  MIN_RECALL_SCORE,
  RECALL_POLICY_VERSION,
  scoreMemoryCandidate,
  selectDiverseMemories,
  STRONG_RECALL_SCORE,
  takeWithinBudget,
  TOKEN_ESTIMATOR_VERSION,
  toFtsQuery,
  type ScoredMemoryCandidate,
} from './recall.js';
import { MemoryStore } from './store.js';
import type {
  MemoryContext,
  MemoryCounts,
  MemoryListQuery,
  MemoryPatch,
  MemoryRecallDiagnostics,
  MemoryRecallItem,
  MemoryRecallResult,
  MemoryRecord,
  MemoryScope,
  SaveMemoryInput,
} from './types.js';

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly projects: MemoryProjectResolver,
    readonly policy: MemoryEfficiencyPolicy = ADAPTIVE_MEMORY_POLICY,
  ) {}

  async resolveContext(input: {
    profileId: string;
    cwd: string;
    sessionId?: string;
    sessionPath?: string;
  }): Promise<MemoryContext> {
    const project = await this.projects.resolve(input);
    return {
      profileId: input.profileId,
      project,
      sessionId: input.sessionId,
      sessionPath: input.sessionPath,
    };
  }

  save(
    context: MemoryContext,
    input: SaveMemoryInput,
    source: 'explicit' | 'manual_ui' = 'explicit',
  ): MemoryRecord {
    if (source !== 'explicit' && source !== 'manual_ui') throw new Error('Invalid explicit save source');
    const scope = input.scope ?? 'project';
    return this.store.createMemory({
      profileId: context.profileId,
      projectId: scope === 'project' ? context.project.id : undefined,
      scope,
      category: input.category,
      content: input.content,
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      pinnedApplicability: input.pinnedApplicability,
      status: 'active',
      source,
      sourceSessionId: context.sessionId,
    });
  }

  search(context: MemoryContext, query: string, scope?: MemoryScope, limit = 20): MemoryRecord[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) return [];
    return this.store.searchMemories({
      profileId: context.profileId,
      projectId: context.project.id,
      statuses: ['active'],
      query: ftsQuery,
      limit,
    }).filter((memory) => !scope || memory.scope === scope);
  }

  update(context: MemoryContext, id: string, expectedRevision: number, patch: MemoryPatch): MemoryRecord {
    this.requireAccessible(context, id);
    const replacesContent = patch.content !== undefined || patch.category !== undefined || patch.tags !== undefined;
    if (!replacesContent) return this.store.updateMemory(id, expectedRevision, patch);
    return this.store.replaceMemory(id, expectedRevision, {
      ...patch,
      source: 'explicit',
      status: 'active',
      sourceSessionId: context.sessionId,
    });
  }

  forget(context: MemoryContext, id: string, expectedRevision: number): MemoryRecord {
    this.requireAccessible(context, id);
    return this.store.archiveMemory(id, expectedRevision);
  }

  restore(context: MemoryContext, id: string, expectedRevision: number): MemoryRecord {
    this.requireAccessible(context, id);
    return this.store.restoreMemory(id, expectedRevision);
  }

  delete(context: MemoryContext, id: string, expectedRevision: number): void {
    this.requireAccessible(context, id);
    this.store.deleteMemory(id, expectedRevision);
  }

  list(
    context: MemoryContext,
    query: Omit<MemoryListQuery, 'profileId' | 'projectId'>,
  ): { items: MemoryRecord[]; total: number } {
    return this.store.listMemories({
      ...query,
      profileId: context.profileId,
      projectId: context.project.id,
    });
  }

  counts(context: MemoryContext): MemoryCounts {
    const counts = this.store.getCounts(context.profileId, context.project.id);
    const pinned = this.store.listPinned(context.profileId, context.project.id)
      .filter((memory) => (
        this.policy !== ADAPTIVE_MEMORY_POLICY || memory.pinnedApplicability === 'always'
      ));
    const selectedPinned = this.policy === ADAPTIVE_MEMORY_POLICY
      ? takeWithinBudget(pinned, 400)
      : takeWithinLegacyBudget(pinned, LEGACY_PINNED_BUDGET);
    return { ...counts, pinnedOverflow: selectedPinned.length < pinned.length };
  }

  /** @deprecated Use buildRecall() when callers also need trace metadata for UI/debugging. */
  buildRecallPrompt(context: MemoryContext, prompt: string): string {
    return this.buildRecall(context, prompt).prompt;
  }

  buildRecall(context: MemoryContext, prompt: string): MemoryRecallResult {
    if (this.policy !== ADAPTIVE_MEMORY_POLICY) return this.buildLegacyRecall(context, prompt);

    const queryProfile = analyzeMemoryQuery(prompt);
    const pinned = this.store.listPinned(context.profileId, context.project.id);
    const candidatePool = queryProfile.substantive
      ? this.store.searchRecallCandidates({
          profileId: context.profileId,
          projectId: context.project.id,
          categories: ['fact', 'decision', 'pitfall'],
          ftsQuery: queryProfile.explicitInspection ? null : queryProfile.ftsQuery,
          fallbackTerms: queryProfile.explicitInspection ? [] : queryProfile.terms,
          limit: MAX_RECALL_CANDIDATES,
        })
      : [];
    const pinnedIds = new Set(pinned.map((memory) => memory.id));
    const pinnedHashes = new Set(pinned.map((memory) => memory.contentHash));
    const referenceScores = candidatePool
      .filter(({ memory }) => !pinnedIds.has(memory.id) && !pinnedHashes.has(memory.contentHash))
      .map(({ memory, bm25Rank }) => scoreMemoryCandidate(memory, queryProfile, bm25Rank));
    const instructionScores = pinned.map((memory, index) => scoreMemoryCandidate(memory, queryProfile, index));
    const applicableInstructions = instructionScores.filter((candidate) => (
      candidate.memory.pinnedApplicability === 'always'
      || (queryProfile.substantive && candidate.score >= MIN_RECALL_SCORE)
    )).sort((left, right) => (
      Number(right.memory.pinnedApplicability === 'always') - Number(left.memory.pinnedApplicability === 'always')
    ));
    const confidentReferences = referenceScores.filter((candidate) => candidate.score >= MIN_RECALL_SCORE);
    const strongReferenceCount = confidentReferences.filter((candidate) => candidate.score >= STRONG_RECALL_SCORE).length;
    let strongMatchCount = 0;
    if (strongReferenceCount >= 3) strongMatchCount = strongReferenceCount;
    else if (confidentReferences.length > 0) strongMatchCount = 1;
    const budgetCeiling = determineMemoryBudget({
      explicitInspection: queryProfile.explicitInspection,
      instructionCount: applicableInstructions.length,
      strongMatchCount,
    });

    const selectedInstructions: ScoredMemoryCandidate[] = [];
    let instructionOverflow = false;
    for (const candidate of applicableInstructions) {
      const trial = buildMemoryPrompt(
        [...selectedInstructions, candidate].map((item) => item.memory),
        [],
      );
      if (estimateTokens(trial) <= budgetCeiling) selectedInstructions.push(candidate);
      else instructionOverflow = true;
    }

    const instructionPromptTokens = estimateTokens(buildMemoryPrompt(
      selectedInstructions.map((candidate) => candidate.memory),
      [],
    ));
    const diversity = selectDiverseMemories(referenceScores, Math.max(0, budgetCeiling - instructionPromptTokens));
    const selectedReferences: ScoredMemoryCandidate[] = [];
    let referenceOverflow = diversity.budgetRejectedIds.length > 0;
    for (const candidate of diversity.selected) {
      const trial = buildMemoryPrompt(
        selectedInstructions.map((item) => item.memory),
        [...selectedReferences, candidate].map((item) => item.memory),
      );
      if (estimateTokens(trial) <= budgetCeiling) selectedReferences.push(candidate);
      else referenceOverflow = true;
    }

    const instructions = selectedInstructions.map((candidate) => candidate.memory);
    const references = selectedReferences.map((candidate) => candidate.memory);
    const selected = [...selectedInstructions, ...selectedReferences];
    const memoryPrompt = buildMemoryPrompt(instructions, references);
    const tokenCount = estimateTokens(memoryPrompt);
    const belowThreshold = [
      ...instructionScores
        .filter((candidate) => candidate.memory.pinnedApplicability === 'matched' && candidate.score < MIN_RECALL_SCORE)
        .map((candidate) => candidate.memory.id),
      ...diversity.rejectedBelowThresholdIds,
    ];
    let skipReason: MemoryRecallDiagnostics['skipReason'];
    if (!memoryPrompt) {
      if (!queryProfile.substantive) skipReason = 'not-substantive';
      else if (budgetCeiling > 0 && (instructionOverflow || referenceOverflow)) skipReason = 'budget-exhausted';
      else skipReason = 'no-confident-match';
    }
    const diagnostics: MemoryRecallDiagnostics = {
      candidateIds: Array.from(new Set([
        ...pinned.map((memory) => memory.id),
        ...candidatePool.map(({ memory }) => memory.id),
      ])),
      rejectedBelowThresholdIds: Array.from(new Set(belowThreshold)),
      redundancyRejectedIds: diversity.redundancyRejectedIds,
      selected: selected.map((candidate) => ({
        id: candidate.memory.id,
        score: candidate.score,
        components: candidate.components,
      })),
      budgetCeiling,
      usedTokens: tokenCount,
      overflow: instructionOverflow || referenceOverflow,
      countingMethod: TOKEN_ESTIMATOR_VERSION,
      rankingPolicyVersion: RECALL_POLICY_VERSION,
      promptFormatVersion: MEMORY_PROMPT_FORMAT_VERSION,
      skipReason,
    };

    this.recordRecall(
      context,
      selected.map((candidate) => candidate.memory.id),
      diagnostics,
      Boolean(memoryPrompt),
    );

    return {
      prompt: memoryPrompt,
      memories: [
        ...instructions.map((memory): MemoryRecallItem => toRecallItem(memory, 'pinned')),
        ...references.map((memory): MemoryRecallItem => toRecallItem(memory, 'query-match')),
      ],
      tokenCount,
      diagnostics,
    };
  }

  private buildLegacyRecall(context: MemoryContext, prompt: string): MemoryRecallResult {
    const pinned = this.store.listPinned(context.profileId, context.project.id);
    const instructions = takeWithinLegacyBudget(pinned, LEGACY_PINNED_BUDGET);
    const query = toLegacyFtsQuery(prompt);
    const instructionIds = new Set(instructions.map((memory) => memory.id));
    const instructionHashes = new Set(instructions.map((memory) => memory.contentHash));
    const matches = query
      ? this.store.searchMemories({
          profileId: context.profileId,
          projectId: context.project.id,
          statuses: ['active'],
          categories: ['fact', 'decision', 'pitfall'],
          query,
          limit: LEGACY_MAX_RELEVANT_MEMORIES * 2,
        }).filter((memory) => !instructionIds.has(memory.id) && !instructionHashes.has(memory.contentHash))
      : [];
    const references = takeWithinLegacyBudget(matches, LEGACY_RELEVANT_BUDGET, LEGACY_MAX_RELEVANT_MEMORIES);
    const selected = [...instructions, ...references];
    const memoryPrompt = buildLegacyMemoryPrompt(instructions, references);
    const tokenCount = estimateLegacyTokens(memoryPrompt);
    let skipReason: MemoryRecallDiagnostics['skipReason'];
    if (!memoryPrompt) skipReason = query ? 'no-confident-match' : 'not-substantive';
    const diagnostics: MemoryRecallDiagnostics = {
      candidateIds: Array.from(new Set([...pinned, ...matches].map((memory) => memory.id))),
      rejectedBelowThresholdIds: [],
      redundancyRejectedIds: [],
      selected: selected.map((memory) => ({
        id: memory.id,
        score: 1,
        components: {
          bm25: 0,
          exactPhrase: 0,
          exactEntity: 0,
          lexicalOverlap: 0,
          projectScope: 0,
          categoryIntent: 0,
          pinnedApplicability: memory.pinned ? 1 : 0,
          freshness: 0,
          utility: 0,
          weakMatchPenalty: 0,
          stalenessPenalty: 0,
        },
      })),
      budgetCeiling: LEGACY_PINNED_BUDGET + LEGACY_RELEVANT_BUDGET,
      usedTokens: tokenCount,
      overflow: instructions.length < pinned.length || references.length < matches.length,
      countingMethod: 'legacy-length-div4',
      rankingPolicyVersion: 'legacy',
      promptFormatVersion: 'memory-prompt-v1',
      skipReason,
    };

    this.recordRecall(
      context,
      selected.map((memory) => memory.id),
      diagnostics,
      Boolean(memoryPrompt),
    );

    return {
      prompt: memoryPrompt,
      memories: [
        ...instructions.map((memory): MemoryRecallItem => toRecallItem(memory, 'pinned')),
        ...references.map((memory): MemoryRecallItem => toRecallItem(memory, 'query-match')),
      ],
      tokenCount,
      diagnostics,
    };
  }

  private recordRecall(
    context: MemoryContext,
    selectedIds: string[],
    diagnostics: MemoryRecallDiagnostics,
    injected: boolean,
  ): void {
    if (selectedIds.length > 0) {
      try {
        this.store.markUsed(selectedIds);
      } catch (error) {
        console.warn('[memory] failed to record recall use:', errorName(error));
      }
    }
    try {
      this.store.recordRecallEvent({
        ...diagnostics,
        profileId: context.profileId,
        projectId: context.project.id,
        sessionId: context.sessionId,
        injected,
      });
    } catch (error) {
      console.warn('[memory] failed to record recall diagnostics:', errorName(error));
    }
  }

  approve(context: MemoryContext, id: string, expectedRevision: number, patch?: MemoryPatch): MemoryRecord {
    this.requireAccessible(context, id);
    return this.store.approveMemory(id, expectedRevision, patch);
  }

  reject(context: MemoryContext, id: string, expectedRevision: number): MemoryRecord {
    this.requireAccessible(context, id);
    return this.store.rejectMemory(id, expectedRevision);
  }

  private requireAccessible(context: MemoryContext, id: string): MemoryRecord {
    const memory = this.store.getMemory(id);
    const accessible = memory?.profileId === context.profileId
      && (memory.scope === 'global' || memory.projectId === context.project.id);
    if (!memory || !accessible) throw new Error('Memory not found in this scope');
    return memory;
  }
}

function toRecallItem(memory: MemoryRecord, reason: MemoryRecallItem['reason']): MemoryRecallItem {
  return {
    id: memory.id,
    scope: memory.scope,
    category: memory.category,
    content: memory.content,
    reason,
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
