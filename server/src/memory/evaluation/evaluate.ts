import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { openPiCloudDatabase } from '../../db/database.js';
import { evaluateDurableSignal } from '../extraction-gate.js';
import { buildExtractionSource, type ExtractionEvidence, type ExtractionSource } from '../extraction-format.js';
import { ADAPTIVE_MEMORY_POLICY, LEGACY_MEMORY_POLICY } from '../policy.js';
import { MemoryProjectResolver } from '../project-resolver.js';
import { estimateTokens } from '../recall.js';
import { MemoryService } from '../service.js';
import { MemoryStore } from '../store.js';
import type { MemoryCategory, MemoryPinnedApplicability, MemoryScope } from '../types.js';

interface GoldenMemory {
  id: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags: string[];
  pinned?: boolean;
  pinnedApplicability?: MemoryPinnedApplicability;
  status?: 'active' | 'archived';
  updatedAt?: string;
}

interface RecallFixture {
  id: string;
  prompt: string;
  relevantIds: string[];
  memories: GoldenMemory[];
}

interface ExtractionFixture {
  id: string;
  expectedDecision: 'extract' | 'skip';
  evidence: Array<Omit<ExtractionEvidence, 'id'>>;
}

interface GoldenFixtureSet {
  version: string;
  recall: RecallFixture[];
  extraction: ExtractionFixture[];
}

export interface MemoryEvaluationReport {
  fixtureVersion: string;
  representativeTraceIncluded: boolean;
  representativeTracePassed: boolean;
  policyVersion: 'adaptive-lexical-v1';
  metrics: {
    recallRetention: number;
    baselinePrecision: number;
    proposedPrecision: number;
    medianTokenReduction: number;
    transientGateAvoidance: number;
    baselineIrrelevantInjectionRate: number;
    proposedIrrelevantInjectionRate: number;
  };
  passed: boolean;
  deploymentAcceptancePassed: boolean;
  recallCases: Array<{
    id: string;
    relevantIds: string[];
    baselineSelectedIds: string[];
    proposedSelectedIds: string[];
    baselineTokens: number;
    proposedTokens: number;
  }>;
  extractionCases: Array<{
    id: string;
    expectedDecision: 'extract' | 'skip';
    actualDecision: 'extract' | 'skip';
  }>;
}

export function evaluateMemoryGoldenSet(representativeTracePath?: string): MemoryEvaluationReport {
  const loaded = loadFixtures(representativeTracePath);
  const recallCases = loaded.fixtures.recall.map(evaluateRecallFixture);
  const extractionCases = loaded.fixtures.extraction.map((fixture) => {
    const source = buildFixtureExtractionSource(fixture);
    return {
      id: fixture.id,
      expectedDecision: fixture.expectedDecision,
      actualDecision: evaluateDurableSignal(source).decision,
    };
  });
  const summary = summarizeCases(recallCases, extractionCases);
  const representativeRecall = recallCases.filter((item) => loaded.representativeRecallIds.has(item.id));
  const representativeExtraction = extractionCases.filter((item) => loaded.representativeExtractionIds.has(item.id));
  const representativeTracePassed = loaded.representativeTraceIncluded
    && summarizeCases(representativeRecall, representativeExtraction).passed;

  return {
    fixtureVersion: loaded.fixtures.version,
    representativeTraceIncluded: loaded.representativeTraceIncluded,
    representativeTracePassed,
    policyVersion: 'adaptive-lexical-v1',
    metrics: summary.metrics,
    passed: summary.passed,
    deploymentAcceptancePassed: summary.passed && representativeTracePassed,
    recallCases,
    extractionCases,
  };
}

function summarizeCases(
  recallCases: MemoryEvaluationReport['recallCases'],
  extractionCases: MemoryEvaluationReport['extractionCases'],
): { metrics: MemoryEvaluationReport['metrics']; passed: boolean } {
  const baselineRelevantHits = sum(recallCases.map((item) => intersectionSize(item.baselineSelectedIds, item.relevantIds)));
  const proposedRelevantHits = sum(recallCases.map((item) => intersectionSize(item.proposedSelectedIds, item.relevantIds)));
  const baselineSelected = sum(recallCases.map((item) => item.baselineSelectedIds.length));
  const proposedSelected = sum(recallCases.map((item) => item.proposedSelectedIds.length));
  const irrelevantCases = recallCases.filter((item) => item.relevantIds.length === 0);
  const baselineMedian = median(recallCases.map((item) => item.baselineTokens));
  const proposedMedian = median(recallCases.map((item) => item.proposedTokens));
  const transientCases = extractionCases.filter((item) => item.expectedDecision === 'skip');
  const metrics = {
    recallRetention: baselineRelevantHits === 0 ? 1 : proposedRelevantHits / baselineRelevantHits,
    baselinePrecision: baselineSelected === 0 ? 1 : baselineRelevantHits / baselineSelected,
    proposedPrecision: proposedSelected === 0 ? 1 : proposedRelevantHits / proposedSelected,
    medianTokenReduction: baselineMedian === 0 ? 0 : (baselineMedian - proposedMedian) / baselineMedian,
    transientGateAvoidance: transientCases.length === 0
      ? 1
      : transientCases.filter((item) => item.actualDecision === 'skip').length / transientCases.length,
    baselineIrrelevantInjectionRate: irrelevantCases.length === 0
      ? 0
      : irrelevantCases.filter((item) => item.baselineSelectedIds.length > 0).length / irrelevantCases.length,
    proposedIrrelevantInjectionRate: irrelevantCases.length === 0
      ? 0
      : irrelevantCases.filter((item) => item.proposedSelectedIds.length > 0).length / irrelevantCases.length,
  };
  const extractionAccurate = extractionCases.length > 0
    && extractionCases.every((item) => item.actualDecision === item.expectedDecision);
  const passed = recallCases.length > 0
    && metrics.recallRetention >= 0.95
    && metrics.medianTokenReduction >= 0.6
    && metrics.transientGateAvoidance >= 0.5
    && metrics.proposedPrecision >= metrics.baselinePrecision
    && metrics.proposedIrrelevantInjectionRate <= metrics.baselineIrrelevantInjectionRate
    && extractionAccurate;
  return { metrics, passed };
}

function buildFixtureExtractionSource(fixture: ExtractionFixture): ExtractionSource {
  const entries = fixture.evidence.map((record, index) => {
    const entry = {
      type: 'message',
      id: `fixture-${index + 1}`,
      parentId: index === 0 ? null : `fixture-${index}`,
      timestamp: '',
    };
    if (record.role === 'user') {
      return { ...entry, message: { role: 'user', content: record.text, timestamp: index + 1 } };
    }

    const content = record.role === 'tool'
      ? [{ type: 'toolCall', id: `tool-${index + 1}`, name: record.tool || 'edit', arguments: { path: record.path } }]
      : [{ type: 'text', text: record.text }];
    return { ...entry, message: { role: 'assistant', content, timestamp: index + 1 } };
  });
  return buildExtractionSource(entries as SessionEntry[], undefined, entries.at(-1)!.id);
}

function evaluateRecallFixture(fixture: RecallFixture): MemoryEvaluationReport['recallCases'][number] {
  const db = openPiCloudDatabase(':memory:');
  try {
    const store = new MemoryStore(db);
    const project = store.getOrCreateProject('default', '/fixture/project');
    const reverseIds = new Map<string, string>();
    for (const memory of fixture.memories) {
      const created = store.createMemory({
        profileId: 'default',
        projectId: memory.scope === 'project' ? project.id : undefined,
        scope: memory.scope,
        category: memory.category,
        content: memory.content,
        tags: memory.tags,
        pinned: memory.pinned ?? false,
        pinnedApplicability: memory.pinnedApplicability,
        status: memory.status ?? 'active',
        source: 'manual_ui',
      });
      reverseIds.set(created.id, memory.id);
      if (memory.updatedAt) {
        db.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?')
          .run(memory.updatedAt, memory.updatedAt, created.id);
      }
    }
    const resolver = new MemoryProjectResolver(store, { get: () => null });
    const baseline = new MemoryService(store, resolver, LEGACY_MEMORY_POLICY)
      .buildRecall({ profileId: 'default', project }, fixture.prompt);
    const proposed = new MemoryService(store, resolver, ADAPTIVE_MEMORY_POLICY)
      .buildRecall({ profileId: 'default', project }, fixture.prompt);
    return {
      id: fixture.id,
      relevantIds: fixture.relevantIds,
      baselineSelectedIds: baseline.memories
        .map((memory) => reverseIds.get(memory.id))
        .filter((id): id is string => id !== undefined),
      proposedSelectedIds: proposed.memories
        .map((memory) => reverseIds.get(memory.id))
        .filter((id): id is string => id !== undefined),
      baselineTokens: estimateTokens(baseline.prompt),
      proposedTokens: proposed.tokenCount,
    };
  } finally {
    db.close();
  }
}

function loadFixtures(representativeTracePath?: string): {
  fixtures: GoldenFixtureSet;
  representativeTraceIncluded: boolean;
  representativeRecallIds: Set<string>;
  representativeExtractionIds: Set<string>;
} {
  const golden = JSON.parse(
    readFileSync(new URL('./fixtures/v1.json', import.meta.url), 'utf8'),
  ) as GoldenFixtureSet;
  if (!representativeTracePath) {
    return {
      fixtures: golden,
      representativeTraceIncluded: false,
      representativeRecallIds: new Set(),
      representativeExtractionIds: new Set(),
    };
  }
  const traces = JSON.parse(readFileSync(representativeTracePath, 'utf8')) as GoldenFixtureSet;
  if (!Array.isArray(traces.recall) || traces.recall.length === 0
    || !Array.isArray(traces.extraction) || traces.extraction.length === 0) {
    throw new Error('Representative trace fixtures must include nonempty recall and extraction cases');
  }
  const prefix = `trace:${traces.version}:`;
  const recall = traces.recall.map((fixture) => ({ ...fixture, id: `${prefix}${fixture.id}` }));
  const extraction = traces.extraction.map((fixture) => ({ ...fixture, id: `${prefix}${fixture.id}` }));
  return {
    fixtures: {
      version: `${golden.version}+${traces.version}`,
      recall: [...golden.recall, ...recall],
      extraction: [...golden.extraction, ...extraction],
    },
    representativeTraceIncluded: true,
    representativeRecallIds: new Set(recall.map((fixture) => fixture.id)),
    representativeExtractionIds: new Set(extraction.map((fixture) => fixture.id)),
  };
}

function intersectionSize(left: string[], right: string[]): number {
  const expected = new Set(right);
  return left.filter((value) => expected.has(value)).length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
