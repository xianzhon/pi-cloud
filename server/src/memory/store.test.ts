import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { MemoryStore } from './store.js';
import type { CreateMemoryInput } from './types.js';

function memoryInput(overrides: Partial<CreateMemoryInput> = {}): CreateMemoryInput {
  return {
    profileId: 'default',
    projectId: 'project-1',
    scope: 'project',
    category: 'fact',
    content: 'The server uses Fastify',
    tags: ['server'],
    pinned: false,
    status: 'active',
    source: 'manual_ui',
    ...overrides,
  };
}

describe('MemoryStore', () => {
  let db: PiCloudDatabase;
  let store: MemoryStore;

  beforeEach(() => {
    db = openPiCloudDatabase(':memory:');
    store = new MemoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('uses profile and canonical path as the project identity', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const sameProject = store.getOrCreateProject('default', '/repo/app');
    const otherProfileProject = store.getOrCreateProject('work', '/repo/app');

    expect(sameProject.id).toBe(project.id);
    expect(otherProfileProject.id).not.toBe(project.id);
    expect(store.getProjectById(project.id)).toEqual(project);
  });

  it('creates, lists, and rejects exact live duplicates', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const first = store.createMemory(memoryInput({
      projectId: project.id,
      category: 'pitfall',
      content: 'Clamp keyboard selection to visible results',
      tags: ['keyboard'],
    }));

    expect(store.listMemories({
      profileId: 'default',
      projectId: project.id,
      scope: 'project',
    })).toEqual({ items: [first], total: 1 });

    expect(() => store.createMemory(memoryInput({
      projectId: project.id,
      category: 'pitfall',
      content: '  clamp keyboard selection to visible results ',
      tags: [],
      source: 'automatic',
    }))).toThrow(/already exists/i);
  });

  it('searches active project and profile-global memory with FTS', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const otherProject = store.getOrCreateProject('default', '/repo/other');
    const projectMemory = store.createMemory(memoryInput({
      projectId: project.id,
      category: 'pitfall',
      content: 'Clamp keyboard selection to visible results',
      tags: ['keyboard'],
    }));
    const globalMemory = store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer keyboard accessible interfaces',
      tags: ['accessibility'],
    }));
    store.createMemory(memoryInput({
      projectId: otherProject.id,
      content: 'Keyboard shortcuts use Control',
    }));
    store.createMemory(memoryInput({
      projectId: project.id,
      content: 'Archived keyboard note',
      status: 'archived',
    }));

    expect(store.searchMemories({
      profileId: 'default',
      projectId: project.id,
      statuses: ['active'],
      query: 'keyboard',
      limit: 8,
    }).map((memory) => memory.id)).toEqual([projectMemory.id, globalMemory.id]);
  });

  it('builds a capped recall pool with CJK substring fallback and scope isolation', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const otherProject = store.getOrCreateProject('default', '/repo/other');
    const chinese = store.createMemory(memoryInput({
      projectId: project.id,
      content: '本项目的 API 错误必须包含 code 和 message',
    }));
    store.createMemory(memoryInput({
      projectId: otherProject.id,
      content: '其他项目错误处理方式',
    }));
    store.createMemory(memoryInput({
      profileId: 'work',
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: '错误处理偏好',
    }));

    const cjkPool = store.searchRecallCandidates({
      profileId: 'default',
      projectId: project.id,
      categories: ['fact'],
      ftsQuery: '"错误"',
      fallbackTerms: ['错误', 'message'],
      limit: 24,
    });
    expect(cjkPool.map((candidate) => candidate.memory.id)).toEqual([chinese.id]);

    for (let index = 0; index < 30; index += 1) {
      store.createMemory(memoryInput({ projectId: project.id, content: `Keyboard recall fact ${index}` }));
    }
    expect(store.searchRecallCandidates({
      profileId: 'default',
      projectId: project.id,
      categories: ['fact'],
      ftsQuery: '"Keyboard"',
      fallbackTerms: ['Keyboard'],
      limit: 24,
    })).toHaveLength(24);
  });

  it('isolates global memory by profile and supports filters and pagination', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer concise responses',
    }));
    store.createMemory(memoryInput({
      profileId: 'work',
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer detailed responses',
    }));
    store.createMemory(memoryInput({ projectId: project.id, content: 'Project fact one' }));
    store.createMemory(memoryInput({ projectId: project.id, content: 'Project fact two' }));

    const page = store.listMemories({
      profileId: 'default',
      projectId: project.id,
      scope: 'project',
      categories: ['fact'],
      statuses: ['active'],
      limit: 1,
      offset: 1,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(store.listMemories({ profileId: 'default', scope: 'global' }).items.map((memory) => memory.content))
      .toEqual(['Prefer concise responses']);
  });

  it('returns effective-scope counts and pinned records', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    store.createMemory(memoryInput({ projectId: project.id, category: 'rule', content: 'Run tests', pinned: true }));
    store.createMemory(memoryInput({ projectId: project.id, content: 'Archived fact', status: 'archived' }));
    store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer concise output',
      pinned: true,
    }));
    store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Use dark themes',
      status: 'pending',
    }));

    expect(store.getCounts('default', project.id)).toEqual({
      projectActive: 1,
      globalActive: 1,
      globalPending: 1,
      archived: 1,
      failedExtractions: 0,
      pinnedOverflow: false,
    });
    expect(store.listPinned('default', project.id).map((memory) => memory.content))
      .toEqual(['Run tests', 'Prefer concise output']);
  });

  it('defaults pinned applicability to matched and keeps utility neutral', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const existingPin = store.createMemory(memoryInput({
      projectId: project.id,
      category: 'rule',
      content: 'Run tests before completion',
      pinned: true,
    }));
    const matchedPin = store.createMemory(memoryInput({
      projectId: project.id,
      category: 'preference',
      content: 'Use Vue patterns for client work',
      pinned: true,
      pinnedApplicability: 'matched',
    }));

    expect(existingPin).toMatchObject({
      pinnedApplicability: 'matched',
      positiveUtilityCount: 0,
      negativeUtilityCount: 0,
    });
    expect(existingPin.lastUtilityAt).toBeUndefined();
    expect(matchedPin.pinnedApplicability).toBe('matched');

    expect(store.updateMemory(existingPin.id, existingPin.revision, {
      pinnedApplicability: 'matched',
    }).pinnedApplicability).toBe('matched');
  });

  it('marks selected memories as used without treating injection as utility', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const memory = store.createMemory(memoryInput({ projectId: project.id }));

    store.markUsed([memory.id]);

    expect(store.getMemory(memory.id)).toMatchObject({
      useCount: 1,
      positiveUtilityCount: 0,
      negativeUtilityCount: 0,
    });
    expect(store.getMemory(memory.id)?.lastUsedAt).toBeTruthy();
    expect(store.getMemory(memory.id)?.lastUtilityAt).toBeUndefined();
  });

  it('relocates project identity and deletes all profile memory', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    store.createMemory(memoryInput({ projectId: project.id }));
    store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer concise output',
    }));

    const relocated = store.relocateProject(project.id, '/archive/app');
    expect(relocated.canonicalPath).toBe('/archive/app');

    store.deleteProfile('default');
    expect(store.getProjectById(project.id)).toBeNull();
    expect(store.listMemories({ profileId: 'default', projectId: project.id }).total).toBe(0);
  });

  it('merges into an existing project when relocating to its path', () => {
    const source = store.getOrCreateProject('default', '/repo/source');
    const destination = store.getOrCreateProject('default', '/repo/destination');
    const sourceMemory = store.createMemory(memoryInput({
      projectId: source.id,
      content: 'Memory from source project',
    }));

    const relocated = store.relocateProject(source.id, '/repo/destination');

    expect(relocated.id).toBe(destination.id);
    expect(store.getProjectById(source.id)).toBeNull();
    expect(store.getMemory(sourceMemory.id)).toMatchObject({ projectId: destination.id });
  });

  it('archives duplicate memories while merging projects', () => {
    const source = store.getOrCreateProject('default', '/repo/source');
    const destination = store.getOrCreateProject('default', '/repo/destination');
    const content = 'The server uses Fastify';
    store.createMemory(memoryInput({ projectId: source.id, content }));
    store.createMemory(memoryInput({ projectId: destination.id, content }));

    store.relocateProject(source.id, '/repo/destination');

    expect(store.listMemories({ profileId: 'default', projectId: destination.id, scope: 'project', statuses: ['active'] }).total)
      .toBe(1);
    expect(store.listMemories({ profileId: 'default', projectId: destination.id, scope: 'project', statuses: ['archived'] }).total)
      .toBe(1);
  });

  it('updates and archives with optimistic revisions', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const memory = store.createMemory(memoryInput({ projectId: project.id }));

    const updated = store.updateMemory(memory.id, memory.revision, { pinned: true });
    expect(updated).toMatchObject({ pinned: true, revision: 2 });
    expect(() => store.updateMemory(memory.id, memory.revision, { pinned: false })).toThrow(/modified/i);

    const archived = store.archiveMemory(updated.id, updated.revision);
    expect(archived).toMatchObject({ status: 'archived', revision: 3 });

    const restored = store.restoreMemory(archived.id, archived.revision);
    expect(restored).toMatchObject({ status: 'active', revision: 4 });
    expect(() => store.restoreMemory(archived.id, archived.revision)).toThrow(/modified/i);
    expect(() => store.restoreMemory(restored.id, restored.revision)).toThrow(/not archived/i);

    store.deleteMemory(restored.id, restored.revision);
    expect(store.getMemory(restored.id)).toBeNull();
    expect(() => store.deleteMemory(restored.id, restored.revision)).toThrow(/not found/i);
  });

  it('replaces an active memory while preserving its predecessor', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const original = store.createMemory(memoryInput({
      projectId: project.id,
      content: 'Project paths identify memory',
    }));

    const replacement = store.replaceMemory(original.id, original.revision, {
      content: 'Stable project IDs preserve memory across project moves',
      tags: ['project'],
      pinned: true,
      source: 'explicit',
      status: 'active',
    });

    expect(store.getMemory(original.id)?.status).toBe('archived');
    expect(replacement).toMatchObject({
      supersedesId: original.id,
      supersedesRevision: 2,
      pinned: true,
      status: 'active',
    });
  });

  it('approves or rejects pending global memories safely', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const activeGlobal = store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer short answers',
    }));
    const pending = store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Prefer concise responses',
      status: 'pending',
      source: 'automatic',
      supersedesId: activeGlobal.id,
    }));

    const approved = store.approveMemory(pending.id, pending.revision);
    expect(approved.status).toBe('active');
    expect(store.getMemory(activeGlobal.id)?.status).toBe('archived');

    const rejectedCandidate = store.createMemory(memoryInput({
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Always use verbose output',
      status: 'pending',
    }));
    expect(store.rejectMemory(rejectedCandidate.id, rejectedCandidate.revision).status).toBe('archived');
    expect(project.id).toBeTruthy();
  });

  it('rejects supersession across profiles or projects', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const otherProject = store.getOrCreateProject('default', '/repo/other');
    const original = store.createMemory(memoryInput({ projectId: project.id }));

    expect(() => store.createMemory(memoryInput({
      projectId: otherProject.id,
      content: 'Other project replacement',
      supersedesId: original.id,
    }))).toThrow(/supersede/i);
    expect(() => store.createMemory(memoryInput({
      profileId: 'work',
      projectId: undefined,
      scope: 'global',
      category: 'preference',
      content: 'Cross profile replacement',
      supersedesId: original.id,
    }))).toThrow(/supersede/i);
  });

  it('queues extraction runs idempotently and claims them in order', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const input = {
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic' as const,
      startingLeafId: 'leaf-before',
      endingLeafId: 'leaf-after',
      modelProvider: 'openai-codex',
      modelId: 'gpt-5.5',
    };

    const first = store.enqueueExtractionRun(input);
    const duplicate = store.enqueueExtractionRun(input);
    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ run: first.run, created: false });

    const claimed = store.claimNextExtractionRun('default');
    expect(claimed).toMatchObject({ id: first.run.id, status: 'running', attempts: 1 });
    store.requeueRun(claimed!.id, 'foreground');
    expect(store.claimNextExtractionRun('default')).toMatchObject({ id: first.run.id, attempts: 2 });
  });

  it('persists extraction accounting and recall diagnostics without source text', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const run = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-telemetry',
      sourceSessionPath: '/sessions/telemetry.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-telemetry',
    }).run;
    store.claimNextExtractionRun('default');

    store.updateExtractionRunTelemetry(run.id, {
      gateDecision: 'extract',
      gateReasonCode: 'durable-language',
      normalizedEvidenceCount: 3,
      inputTokens: 120,
      outputTokens: 18,
      cacheReadTokens: 80,
      cacheWriteTokens: 4,
      tokenAccountingMethod: 'provider-usage',
      promptFormatVersion: 'extraction-v2',
      emittedCount: 4,
      validatedCount: 3,
      createdCount: 2,
      duplicateCount: 1,
      replacedCount: 1,
    });

    expect(store.getExtractionRun(run.id)).toMatchObject({
      gateDecision: 'extract',
      gateReasonCode: 'durable-language',
      normalizedEvidenceCount: 3,
      inputTokens: 120,
      outputTokens: 18,
      cacheReadTokens: 80,
      cacheWriteTokens: 4,
      tokenAccountingMethod: 'provider-usage',
      promptFormatVersion: 'extraction-v2',
      emittedCount: 4,
      validatedCount: 3,
      createdCount: 2,
      duplicateCount: 1,
      replacedCount: 1,
    });

    store.recordRecallEvent({
      profileId: 'default',
      projectId: project.id,
      sessionId: 'session-telemetry',
      injected: false,
      candidateIds: ['memory-1'],
      rejectedBelowThresholdIds: ['memory-1'],
      redundancyRejectedIds: [],
      selected: [],
      budgetCeiling: 0,
      usedTokens: 0,
      overflow: false,
      countingMethod: 'local-unicode-v1',
      rankingPolicyVersion: 'adaptive-lexical-v1',
      promptFormatVersion: 'memory-prompt-v2',
      skipReason: 'not-substantive',
    });

    const recall = db.prepare('SELECT * FROM memory_recall_events').get() as Record<string, unknown>;
    expect(JSON.parse(recall.candidate_ids_json as string)).toEqual(['memory-1']);
    expect(JSON.parse(recall.rejected_below_threshold_ids_json as string)).toEqual(['memory-1']);
    expect(recall).not.toHaveProperty('prompt');
    expect(recall).not.toHaveProperty('content');
    expect(recall).not.toHaveProperty('evidence');
  });

  it('recovers interrupted extraction runs', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const queued = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-after',
    }).run;
    store.claimNextExtractionRun('default');

    store.recoverInterruptedRuns();

    expect(store.getExtractionRun(queued.id)?.status).toBe('queued');
    expect(store.listQueuedProfiles()).toEqual(['default']);
  });

  it('applies project and global extraction candidates transactionally', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const existing = store.createMemory(memoryInput({ projectId: project.id, content: 'Use path-based project IDs' }));
    const run = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-after',
    }).run;
    store.claimNextExtractionRun('default');

    const result = store.applyExtractionCandidates(run.id, [
      {
        operation: 'replace',
        scope: 'project',
        category: 'decision',
        content: 'Use stable project IDs',
        tags: ['project'],
        evidenceIds: ['e1'],
        evidence: 'Use stable project IDs.',
        existingMemoryId: existing.id,
      },
      {
        operation: 'new',
        scope: 'global',
        category: 'preference',
        content: 'Prefer concise answers',
        tags: ['style'],
        evidenceIds: ['e1'],
        evidence: 'I prefer concise answers.',
      },
    ], 3);

    expect(result).toMatchObject({ activeProjectCount: 1, pendingGlobalCount: 1, discardedCount: 0 });
    expect(result.createdIds).toHaveLength(2);
    expect(store.getExtractionRun(run.id)).toMatchObject({
      emittedCount: 3,
      validatedCount: 2,
      createdCount: 2,
      duplicateCount: 0,
      replacedCount: 1,
    });
    expect(store.getMemory(existing.id)?.status).toBe('archived');
    expect(store.getMemory(result.createdIds[0])).toMatchObject({ status: 'active', evidence: 'Use stable project IDs.' });
    expect(store.getMemory(result.createdIds[1])).toMatchObject({ status: 'pending', scope: 'global' });
  });

  it('discards exact duplicate new extraction candidates without failing the run', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const existing = store.createMemory(memoryInput({ projectId: project.id, content: 'Use stable project IDs' }));
    const run = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-after',
    }).run;
    store.claimNextExtractionRun('default');

    const result = store.applyExtractionCandidates(run.id, [
      {
        operation: 'new', scope: 'project', category: 'fact', content: '  use stable project IDs ', tags: [], evidenceIds: ['e1'], evidence: 'Use stable project IDs.',
      },
      {
        operation: 'new', scope: 'project', category: 'fact', content: 'Extraction keeps processing after duplicates', tags: [], evidenceIds: ['e1'], evidence: 'Extraction keeps processing after duplicates.',
      },
    ]);

    expect(result).toMatchObject({ activeProjectCount: 1, pendingGlobalCount: 0, discardedCount: 1 });
    expect(store.getMemory(existing.id)?.status).toBe('active');
    expect(store.listMemories({ profileId: 'default', projectId: project.id, scope: 'project', statuses: ['active'] }).total)
      .toBe(2);
  });

  it('rolls back the whole extraction batch when a replacement is invalid', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const run = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-after',
    }).run;
    store.claimNextExtractionRun('default');

    expect(() => store.applyExtractionCandidates(run.id, [
      {
        operation: 'new', scope: 'project', category: 'fact', content: 'First fact', tags: [], evidenceIds: ['e1'], evidence: 'First fact.',
      },
      {
        operation: 'replace', scope: 'project', category: 'fact', content: 'Invalid replacement', tags: [], evidenceIds: ['e1'], evidence: 'Invalid.', existingMemoryId: 'missing',
      },
    ])).toThrow(/existing memory/i);
    expect(store.listMemories({ profileId: 'default', projectId: project.id }).total).toBe(0);
  });

  it('rethrows non-duplicate new extraction candidate errors and rolls back the batch', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const run = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-after',
    }).run;
    store.claimNextExtractionRun('default');

    expect(() => store.applyExtractionCandidates(run.id, [
      {
        operation: 'new', scope: 'project', category: 'fact', content: 'First fact', tags: [], evidenceIds: ['e1'], evidence: 'First fact.',
      },
      {
        operation: 'new', scope: 'project', category: 'fact', content: '', tags: [], evidenceIds: ['e1'], evidence: 'Empty content.',
      },
    ])).toThrow(/content is required/i);
    expect(store.listMemories({ profileId: 'default', projectId: project.id }).total).toBe(0);
  });

  it('undoes untouched extraction replacements and skips manually edited records', () => {
    const project = store.getOrCreateProject('default', '/repo/app');
    const original = store.createMemory(memoryInput({ projectId: project.id, content: 'Use path IDs' }));
    const run = store.enqueueExtractionRun({
      profileId: 'default',
      projectId: project.id,
      sourceSessionId: 'session-1',
      sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic',
      endingLeafId: 'leaf-after',
    }).run;
    store.claimNextExtractionRun('default');
    const applied = store.applyExtractionCandidates(run.id, [{
      operation: 'replace', scope: 'project', category: 'decision', content: 'Use stable IDs', tags: [], evidenceIds: ['e1'], evidence: 'Use stable IDs.', existingMemoryId: original.id,
    }]);
    store.completeRun(run.id);

    const undo = store.undoExtractionRun(run.id);
    expect(undo.archivedIds).toEqual(applied.createdIds);
    expect(undo.restoredIds).toEqual([original.id]);
    expect(store.getMemory(original.id)?.status).toBe('active');

    const secondRun = store.enqueueExtractionRun({
      profileId: 'default', projectId: project.id, sourceSessionId: 'session-1', sourceSessionPath: '/sessions/session-1.jsonl',
      sourceKind: 'automatic', endingLeafId: 'leaf-next',
    }).run;
    store.claimNextExtractionRun('default');
    const secondApplied = store.applyExtractionCandidates(secondRun.id, [{
      operation: 'new', scope: 'project', category: 'fact', content: 'Editable fact', tags: [], evidenceIds: ['e1'], evidence: 'Editable fact.',
    }]);
    store.completeRun(secondRun.id);
    const edited = store.updateMemory(secondApplied.createdIds[0], 1, { pinned: true });

    const secondUndo = store.undoExtractionRun(secondRun.id);
    expect(edited.revision).toBe(2);
    expect(secondUndo.skippedIds).toEqual(secondApplied.createdIds);
  });
});
