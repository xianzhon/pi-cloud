import { randomUUID } from 'node:crypto';
import type { PiuiDatabase } from '../db/database.js';
import type {
  CreateMemoryInput,
  EnqueueExtractionRunInput,
  ExtractionApplyResult,
  ExtractionRunTelemetryUpdate,
  ExtractionUndoResult,
  MemoryCounts,
  MemoryExtractionRun,
  MemoryListQuery,
  MemoryPatch,
  MemoryProject,
  MemoryRecallCandidate,
  MemoryRecallSearchQuery,
  MemoryRecord,
  MemorySearchQuery,
  MemorySource,
  MemoryStatus,
  RecordMemoryRecallEventInput,
  ValidatedExtractionCandidate,
} from './types.js';
import { assertMemoryContent, hashMemoryContent, normalizeMemoryTags } from './validation.js';

interface MemoryProjectRow {
  id: string;
  profile_id: string;
  canonical_path: string;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  id: string;
  profile_id: string;
  project_id: string | null;
  scope: MemoryRecord['scope'];
  category: MemoryRecord['category'];
  content: string;
  content_hash: string;
  tags_json: string;
  pinned: number;
  pinned_applicability: MemoryRecord['pinnedApplicability'];
  status: MemoryRecord['status'];
  source: MemoryRecord['source'];
  source_session_id: string | null;
  source_entry_id: string | null;
  evidence: string | null;
  extraction_run_id: string | null;
  supersedes_id: string | null;
  supersedes_revision: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
  positive_utility_count: number;
  negative_utility_count: number;
  last_utility_at: string | null;
}

interface MemoryExtractionRunRow {
  id: string;
  profile_id: string;
  project_id: string;
  source_session_id: string;
  source_session_path: string;
  source_kind: MemoryExtractionRun['sourceKind'];
  starting_leaf_id: string | null;
  ending_leaf_id: string;
  status: MemoryExtractionRun['status'];
  model_provider: string | null;
  model_id: string | null;
  attempts: number;
  discarded_count: number;
  gate_decision: MemoryExtractionRun['gateDecision'] | null;
  gate_reason_code: string | null;
  normalized_evidence_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  token_accounting_method: string | null;
  prompt_format_version: string | null;
  emitted_count: number;
  validated_count: number;
  created_count: number;
  duplicate_count: number;
  replaced_count: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface CountRow {
  count: number;
}

export class MemoryStore {
  constructor(private readonly db: PiuiDatabase) {}

  isAutoExtractionEnabled(): boolean {
    const row = this.db.prepare('SELECT value FROM security_settings WHERE key = ?').get('memory.autoExtract') as { value: string } | undefined;
    return row?.value !== 'false';
  }

  getOrCreateProject(profileId: string, canonicalPath: string): MemoryProject {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO memory_projects (id, profile_id, canonical_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, canonical_path) DO NOTHING
    `).run(randomUUID(), profileId, canonicalPath, now, now);

    return this.getProjectByPath(profileId, canonicalPath)!;
  }

  getProjectById(id: string): MemoryProject | null {
    const row = this.db.prepare('SELECT * FROM memory_projects WHERE id = ?').get(id) as MemoryProjectRow | undefined;
    return row ? mapProjectRow(row) : null;
  }

  getProjectByPath(profileId: string, canonicalPath: string): MemoryProject | null {
    const row = this.db.prepare(
      'SELECT * FROM memory_projects WHERE profile_id = ? AND canonical_path = ?',
    ).get(profileId, canonicalPath) as MemoryProjectRow | undefined;
    return row ? mapProjectRow(row) : null;
  }

  relocateProject(projectId: string, canonicalPath: string): MemoryProject {
    const project = this.getProjectById(projectId);
    if (!project) throw new Error('Memory project not found');

    const destination = this.getProjectByPath(project.profileId, canonicalPath);
    if (destination && destination.id !== projectId) {
      this.db.transaction(() => {
        const now = new Date().toISOString();
        this.db.prepare(`
          UPDATE memories
          SET status = 'archived', updated_at = ?
          WHERE project_id = ? AND status IN ('active', 'pending')
            AND EXISTS (
              SELECT 1 FROM memories destination_memory
              WHERE destination_memory.project_id = ?
                AND destination_memory.scope = memories.scope
                AND destination_memory.content_hash = memories.content_hash
                AND destination_memory.status IN ('active', 'pending')
            )
        `).run(now, projectId, destination.id);
        this.db.prepare('UPDATE memories SET project_id = ?, updated_at = ? WHERE project_id = ?')
          .run(destination.id, now, projectId);
        this.db.prepare('UPDATE memory_extraction_runs SET project_id = ? WHERE project_id = ?')
          .run(destination.id, projectId);
        this.db.prepare('DELETE FROM memory_projects WHERE id = ?').run(projectId);
      })();
      return destination;
    }

    const result = this.db.prepare(`
      UPDATE memory_projects SET canonical_path = ?, updated_at = ? WHERE id = ?
    `).run(canonicalPath, new Date().toISOString(), projectId);
    if (result.changes !== 1) throw new Error('Memory project not found');
    return this.getProjectById(projectId)!;
  }

  deleteProfile(profileId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM memories WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM memory_projects WHERE profile_id = ?').run(profileId);
    })();
  }

  createMemory(input: CreateMemoryInput): MemoryRecord {
    this.assertScope(input.profileId, input.projectId, input.scope);
    const superseded = input.supersedesId ? this.getMemory(input.supersedesId) : null;
    if (input.supersedesId) this.assertCanSupersede(input, superseded);
    const content = assertMemoryContent(input.content);
    const evidence = input.evidence ? assertMemoryContent(input.evidence) : null;
    const tags = normalizeMemoryTags(input.tags);
    const now = new Date().toISOString();
    const id = randomUUID();

    try {
      this.db.prepare(`
        INSERT INTO memories (
          id, profile_id, project_id, scope, category, content, content_hash, tags_json,
          pinned, pinned_applicability, status, source, source_session_id, source_entry_id, evidence, extraction_run_id,
          supersedes_id, supersedes_revision, revision, created_at, updated_at
        ) VALUES (
          @id, @profileId, @projectId, @scope, @category, @content, @contentHash, @tagsJson,
          @pinned, @pinnedApplicability, @status, @source, @sourceSessionId, @sourceEntryId, @evidence, @extractionRunId,
          @supersedesId, @supersedesRevision, 1, @createdAt, @updatedAt
        )
      `).run({
        id,
        profileId: input.profileId,
        projectId: input.projectId ?? null,
        scope: input.scope,
        category: input.category,
        content,
        contentHash: hashMemoryContent(content),
        tagsJson: JSON.stringify(tags),
        pinned: input.pinned ? 1 : 0,
        // Pinned memories are matched by default so pinning does not add every rule to every turn.
        // Callers can explicitly choose `always` for genuinely global instructions.
        pinnedApplicability: input.pinnedApplicability ?? 'matched',
        status: input.status,
        source: input.source,
        sourceSessionId: input.sourceSessionId ?? null,
        sourceEntryId: input.sourceEntryId ?? null,
        evidence,
        extractionRunId: input.extractionRunId ?? null,
        supersedesId: input.supersedesId ?? null,
        supersedesRevision: input.supersedesRevision ?? superseded?.revision ?? null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new DuplicateMemoryError();
      }
      throw error;
    }

    return this.getMemory(id)!;
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? mapMemoryRow(row) : null;
  }

  listMemories(query: MemoryListQuery): { items: MemoryRecord[]; total: number } {
    const { where, params } = buildListFilter(query);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const offset = Math.max(0, query.offset ?? 0);
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM memories m ${where}`).get(...params) as CountRow).count;
    const rows = this.db.prepare(`
      SELECT m.* FROM memories m ${where}
      ORDER BY m.pinned DESC, m.updated_at DESC, m.id
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as MemoryRow[];

    return { items: rows.map(mapMemoryRow), total };
  }

  searchMemories(query: MemorySearchQuery): MemoryRecord[] {
    if (!query.query.trim() || query.statuses.length === 0) return [];
    const params: unknown[] = [query.query, query.profileId, query.projectId];
    const statusPlaceholders = query.statuses.map(() => '?').join(', ');
    params.push(...query.statuses);
    const categoryClause = query.categories?.length
      ? `AND m.category IN (${query.categories.map(() => '?').join(', ')})`
      : '';
    if (query.categories?.length) params.push(...query.categories);
    params.push(Math.min(100, Math.max(1, query.limit)));

    const rows = this.db.prepare(`
      SELECT m.*
      FROM memory_fts
      JOIN memories m ON m.id = memory_fts.memory_id
      WHERE memory_fts MATCH ?
        AND m.profile_id = ?
        AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))
        AND m.status IN (${statusPlaceholders})
        ${categoryClause}
      ORDER BY bm25(memory_fts), CASE m.scope WHEN 'project' THEN 0 ELSE 1 END, m.updated_at DESC, m.id
      LIMIT ?
    `).all(...params) as MemoryRow[];

    return rows.map(mapMemoryRow);
  }

  searchRecallCandidates(query: MemoryRecallSearchQuery): MemoryRecallCandidate[] {
    if (query.categories.length === 0) return [];
    const limit = Math.min(24, Math.max(1, query.limit));
    const selected: MemoryRecord[] = [];
    const seen = new Set<string>();
    const append = (rows: MemoryRow[]) => {
      for (const row of rows) {
        if (selected.length >= limit) break;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        selected.push(mapMemoryRow(row));
      }
    };
    const categoryPlaceholders = query.categories.map(() => '?').join(', ');

    if (query.ftsQuery?.trim()) {
      append(this.db.prepare(`
        SELECT m.*
        FROM memory_fts
        JOIN memories m ON m.id = memory_fts.memory_id
        WHERE memory_fts MATCH ?
          AND m.profile_id = ?
          AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))
          AND m.status = 'active'
          AND m.category IN (${categoryPlaceholders})
        ORDER BY bm25(memory_fts), CASE m.scope WHEN 'project' THEN 0 ELSE 1 END, m.updated_at DESC, m.id
        LIMIT ?
      `).all(
        query.ftsQuery,
        query.profileId,
        query.projectId,
        ...query.categories,
        limit,
      ) as MemoryRow[]);
    }

    const fallbackTerms = Array.from(new Set(query.fallbackTerms.map((term) => term.trim()).filter(Boolean))).slice(0, 12);
    if (selected.length < limit && fallbackTerms.length > 0) {
      const termClause = fallbackTerms.map(() => '(instr(lower(m.content), lower(?)) > 0 OR instr(lower(m.tags_json), lower(?)) > 0)').join(' OR ');
      const termParams = fallbackTerms.flatMap((term) => [term, term]);
      append(this.db.prepare(`
        SELECT m.* FROM memories m
        WHERE m.profile_id = ?
          AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))
          AND m.status = 'active'
          AND m.category IN (${categoryPlaceholders})
          AND (${termClause})
        ORDER BY CASE m.scope WHEN 'project' THEN 0 ELSE 1 END, m.updated_at DESC, m.id
        LIMIT ?
      `).all(
        query.profileId,
        query.projectId,
        ...query.categories,
        ...termParams,
        limit,
      ) as MemoryRow[]);
    }

    if (selected.length < limit && !query.ftsQuery && fallbackTerms.length === 0) {
      append(this.db.prepare(`
        SELECT m.* FROM memories m
        WHERE m.profile_id = ?
          AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))
          AND m.status = 'active'
          AND m.category IN (${categoryPlaceholders})
        ORDER BY CASE m.scope WHEN 'project' THEN 0 ELSE 1 END, m.pinned DESC, m.updated_at DESC, m.id
        LIMIT ?
      `).all(query.profileId, query.projectId, ...query.categories, limit) as MemoryRow[]);
    }

    return selected.map((memory, bm25Rank) => ({ memory, bm25Rank }));
  }

  listPinned(profileId: string, projectId: string): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE profile_id = ?
        AND status = 'active'
        AND pinned = 1
        AND category IN ('rule', 'preference')
        AND (scope = 'global' OR (scope = 'project' AND project_id = ?))
      ORDER BY CASE scope WHEN 'project' THEN 0 ELSE 1 END, updated_at DESC, id
    `).all(profileId, projectId) as MemoryRow[];
    return rows.map(mapMemoryRow);
  }

  getCounts(profileId: string, projectId?: string): MemoryCounts {
    const projectActive = projectId
      ? this.count("profile_id = ? AND project_id = ? AND scope = 'project' AND status = 'active'", profileId, projectId)
      : 0;
    const globalActive = this.count("profile_id = ? AND scope = 'global' AND status = 'active'", profileId);
    const globalPending = this.count("profile_id = ? AND scope = 'global' AND status = 'pending'", profileId);
    const archived = projectId
      ? this.count("profile_id = ? AND status = 'archived' AND (scope = 'global' OR project_id = ?)", profileId, projectId)
      : this.count("profile_id = ? AND scope = 'global' AND status = 'archived'", profileId);
    const failedExtractions = projectId
      ? this.countRuns("profile_id = ? AND project_id = ? AND status = 'failed'", profileId, projectId)
      : 0;

    return { projectActive, globalActive, globalPending, archived, failedExtractions, pinnedOverflow: false };
  }

  markUsed(ids: string[]): void {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;
    const placeholders = uniqueIds.map(() => '?').join(', ');
    this.db.prepare(`
      UPDATE memories
      SET use_count = use_count + 1, last_used_at = ?
      WHERE id IN (${placeholders})
    `).run(new Date().toISOString(), ...uniqueIds);
  }

  updateMemory(id: string, expectedRevision: number, patch: MemoryPatch): MemoryRecord {
    const current = this.requireMemory(id, expectedRevision);
    const content = patch.content === undefined ? current.content : assertMemoryContent(patch.content);
    const tags = patch.tags === undefined ? current.tags : normalizeMemoryTags(patch.tags);
    const category = patch.category ?? current.category;
    const pinned = patch.pinned ?? current.pinned;
    const pinnedApplicability = patch.pinnedApplicability ?? current.pinnedApplicability;

    try {
      const result = this.db.prepare(`
        UPDATE memories
        SET category = ?, content = ?, content_hash = ?, tags_json = ?, pinned = ?, pinned_applicability = ?,
            revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?
      `).run(
        category,
        content,
        hashMemoryContent(content),
        JSON.stringify(tags),
        pinned ? 1 : 0,
        pinnedApplicability,
        new Date().toISOString(),
        id,
        expectedRevision,
      );
      if (result.changes !== 1) throw new Error('Memory was modified');
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new DuplicateMemoryError();
      }
      throw error;
    }

    return this.getMemory(id)!;
  }

  archiveMemory(id: string, expectedRevision: number): MemoryRecord {
    this.requireMemory(id, expectedRevision);
    const result = this.db.prepare(`
      UPDATE memories
      SET status = 'archived', revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(new Date().toISOString(), id, expectedRevision);
    if (result.changes !== 1) throw new Error('Memory was modified');
    return this.getMemory(id)!;
  }

  restoreMemory(id: string, expectedRevision: number): MemoryRecord {
    const memory = this.requireMemory(id, expectedRevision);
    if (memory.status !== 'archived') throw new Error('Memory is not archived');
    const result = this.db.prepare(`
      UPDATE memories
      SET status = 'active', revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(new Date().toISOString(), id, expectedRevision);
    if (result.changes !== 1) throw new Error('Memory was modified');
    return this.getMemory(id)!;
  }

  deleteMemory(id: string, expectedRevision: number): void {
    this.requireMemory(id, expectedRevision);
    const result = this.db.prepare('DELETE FROM memories WHERE id = ? AND revision = ?').run(id, expectedRevision);
    if (result.changes !== 1) throw new Error('Memory was modified');
  }

  replaceMemory(
    id: string,
    expectedRevision: number,
    input: MemoryPatch & {
      source: MemorySource;
      status: MemoryStatus;
      sourceSessionId?: string;
      sourceEntryId?: string;
      extractionRunId?: string;
      evidence?: string;
    },
  ): MemoryRecord {
    return this.db.transaction(() => {
      const current = this.requireMemory(id, expectedRevision);
      const archived = this.archiveMemory(id, expectedRevision);
      return this.createMemory({
        profileId: current.profileId,
        projectId: current.projectId,
        scope: current.scope,
        category: input.category ?? current.category,
        content: input.content ?? current.content,
        tags: input.tags ?? current.tags,
        pinned: input.pinned ?? current.pinned,
        pinnedApplicability: input.pinnedApplicability ?? current.pinnedApplicability,
        status: input.status,
        source: input.source,
        sourceSessionId: input.sourceSessionId ?? current.sourceSessionId,
        sourceEntryId: input.sourceEntryId ?? current.sourceEntryId,
        evidence: input.evidence,
        extractionRunId: input.extractionRunId,
        supersedesId: current.id,
        supersedesRevision: archived.revision,
      });
    })();
  }

  approveMemory(id: string, expectedRevision: number, patch?: MemoryPatch): MemoryRecord {
    return this.db.transaction(() => {
      let candidate = this.requireMemory(id, expectedRevision);
      if (candidate.status !== 'pending') throw new Error('Memory is not pending');
      if (patch && Object.keys(patch).length > 0) {
        candidate = this.updateMemory(id, expectedRevision, patch);
      }

      let supersedesRevision = candidate.supersedesRevision ?? null;
      if (candidate.supersedesId) {
        const predecessor = this.getMemory(candidate.supersedesId);
        this.assertCanSupersede(candidate, predecessor);
        if (!predecessor || predecessor.status !== 'active' || predecessor.revision !== candidate.supersedesRevision) {
          throw new Error('Superseded memory was modified');
        }
        supersedesRevision = this.archiveMemory(predecessor.id, predecessor.revision).revision;
      }

      const result = this.db.prepare(`
        UPDATE memories
        SET status = 'active', supersedes_revision = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND status = 'pending'
      `).run(supersedesRevision, new Date().toISOString(), id, candidate.revision);
      if (result.changes !== 1) throw new Error('Memory was modified');
      return this.getMemory(id)!;
    })();
  }

  rejectMemory(id: string, expectedRevision: number): MemoryRecord {
    const memory = this.requireMemory(id, expectedRevision);
    if (memory.status !== 'pending') throw new Error('Memory is not pending');
    return this.archiveMemory(id, expectedRevision);
  }

  enqueueExtractionRun(input: EnqueueExtractionRunInput): { run: MemoryExtractionRun; created: boolean } {
    const project = this.getProjectById(input.projectId);
    if (!project || project.profileId !== input.profileId) throw new Error('Memory project not found for profile');
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO memory_extraction_runs (
        id, profile_id, project_id, source_session_id, source_session_path, source_kind,
        starting_leaf_id, ending_leaf_id, status, model_provider, model_id, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?)
      ON CONFLICT(source_session_id, ending_leaf_id, source_kind) DO NOTHING
    `).run(
      randomUUID(),
      input.profileId,
      input.projectId,
      input.sourceSessionId,
      input.sourceSessionPath,
      input.sourceKind,
      input.startingLeafId ?? null,
      input.endingLeafId,
      input.modelProvider ?? null,
      input.modelId ?? null,
      now,
    );
    const row = this.db.prepare(`
      SELECT * FROM memory_extraction_runs
      WHERE source_session_id = ? AND ending_leaf_id = ? AND source_kind = ?
    `).get(input.sourceSessionId, input.endingLeafId, input.sourceKind) as MemoryExtractionRunRow;
    return { run: mapExtractionRunRow(row), created: result.changes === 1 };
  }

  getExtractionRun(id: string): MemoryExtractionRun | null {
    const row = this.db.prepare('SELECT * FROM memory_extraction_runs WHERE id = ?').get(id) as MemoryExtractionRunRow | undefined;
    return row ? mapExtractionRunRow(row) : null;
  }

  updateExtractionRunTelemetry(id: string, update: ExtractionRunTelemetryUpdate): void {
    const result = this.db.prepare(`
      UPDATE memory_extraction_runs
      SET model_provider = COALESCE(@modelProvider, model_provider),
          model_id = COALESCE(@modelId, model_id),
          gate_decision = COALESCE(@gateDecision, gate_decision),
          gate_reason_code = COALESCE(@gateReasonCode, gate_reason_code),
          normalized_evidence_count = COALESCE(@normalizedEvidenceCount, normalized_evidence_count),
          input_tokens = CASE WHEN @inputTokens IS NULL THEN input_tokens ELSE COALESCE(input_tokens, 0) + @inputTokens END,
          output_tokens = CASE WHEN @outputTokens IS NULL THEN output_tokens ELSE COALESCE(output_tokens, 0) + @outputTokens END,
          cache_read_tokens = CASE WHEN @cacheReadTokens IS NULL THEN cache_read_tokens ELSE COALESCE(cache_read_tokens, 0) + @cacheReadTokens END,
          cache_write_tokens = CASE WHEN @cacheWriteTokens IS NULL THEN cache_write_tokens ELSE COALESCE(cache_write_tokens, 0) + @cacheWriteTokens END,
          token_accounting_method = COALESCE(@tokenAccountingMethod, token_accounting_method),
          prompt_format_version = COALESCE(@promptFormatVersion, prompt_format_version),
          emitted_count = COALESCE(@emittedCount, emitted_count),
          validated_count = COALESCE(@validatedCount, validated_count),
          created_count = COALESCE(@createdCount, created_count),
          duplicate_count = COALESCE(@duplicateCount, duplicate_count),
          replaced_count = COALESCE(@replacedCount, replaced_count)
      WHERE id = ? AND status = 'running'
    `).run({
      modelProvider: update.modelProvider ?? null,
      modelId: update.modelId ?? null,
      gateDecision: update.gateDecision ?? null,
      gateReasonCode: update.gateReasonCode ?? null,
      normalizedEvidenceCount: update.normalizedEvidenceCount ?? null,
      inputTokens: update.inputTokens ?? null,
      outputTokens: update.outputTokens ?? null,
      cacheReadTokens: update.cacheReadTokens ?? null,
      cacheWriteTokens: update.cacheWriteTokens ?? null,
      tokenAccountingMethod: update.tokenAccountingMethod ?? null,
      promptFormatVersion: update.promptFormatVersion ?? null,
      emittedCount: update.emittedCount ?? null,
      validatedCount: update.validatedCount ?? null,
      createdCount: update.createdCount ?? null,
      duplicateCount: update.duplicateCount ?? null,
      replacedCount: update.replacedCount ?? null,
    }, id);
    if (result.changes !== 1) throw new Error('Extraction run is not running');
  }

  recordRecallEvent(event: RecordMemoryRecallEventInput): void {
    this.db.prepare(`
      INSERT INTO memory_recall_events (
        profile_id, project_id, session_id, injected, candidate_ids_json,
        rejected_below_threshold_ids_json, redundancy_rejected_ids_json, selected_json,
        budget_ceiling, used_tokens, overflow, counting_method, ranking_policy_version,
        prompt_format_version, skip_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.profileId,
      event.projectId,
      event.sessionId ?? null,
      event.injected ? 1 : 0,
      JSON.stringify(event.candidateIds),
      JSON.stringify(event.rejectedBelowThresholdIds),
      JSON.stringify(event.redundancyRejectedIds),
      JSON.stringify(event.selected),
      event.budgetCeiling,
      event.usedTokens,
      event.overflow ? 1 : 0,
      event.countingMethod,
      event.rankingPolicyVersion,
      event.promptFormatVersion,
      event.skipReason ?? null,
      new Date().toISOString(),
    );
  }

  listFailedExtractionRuns(profileId: string, projectId: string): MemoryExtractionRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_extraction_runs
      WHERE profile_id = ? AND project_id = ? AND status = 'failed'
      ORDER BY completed_at DESC, created_at DESC, id
    `).all(profileId, projectId) as MemoryExtractionRunRow[];
    return rows.map(mapExtractionRunRow);
  }

  clearFailedRun(id: string): void {
    const result = this.db.prepare(`
      UPDATE memory_extraction_runs
      SET status = 'cancelled', completed_at = COALESCE(completed_at, ?)
      WHERE id = ? AND status = 'failed'
    `).run(new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error('Extraction run is not failed');
  }

  listQueuedProfiles(): string[] {
    return (this.db.prepare(`
      SELECT DISTINCT profile_id FROM memory_extraction_runs WHERE status = 'queued' ORDER BY profile_id
    `).all() as Array<{ profile_id: string }>).map((row) => row.profile_id);
  }

  claimNextExtractionRun(profileId: string): MemoryExtractionRun | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM memory_extraction_runs
        WHERE profile_id = ? AND status = 'queued'
        ORDER BY created_at, id LIMIT 1
      `).get(profileId) as MemoryExtractionRunRow | undefined;
      if (!row) return null;
      const result = this.db.prepare(`
        UPDATE memory_extraction_runs
        SET status = 'running', attempts = attempts + 1, started_at = ?, completed_at = NULL, error = NULL
        WHERE id = ? AND status = 'queued'
      `).run(new Date().toISOString(), row.id);
      return result.changes === 1 ? this.getExtractionRun(row.id) : null;
    })();
  }

  requeueRun(id: string, error?: string, restoreAttempt = false): void {
    const result = this.db.prepare(`
      UPDATE memory_extraction_runs
      SET status = 'queued',
          attempts = CASE WHEN ? = 1 THEN MAX(attempts - 1, 0) ELSE attempts END,
          started_at = NULL, completed_at = NULL, error = ?
      WHERE id = ? AND status IN ('running', 'failed', 'cancelled')
    `).run(restoreAttempt ? 1 : 0, error ?? null, id);
    if (result.changes !== 1) throw new Error('Extraction run cannot be requeued');
  }

  retryRun(id: string): void {
    const result = this.db.prepare(`
      UPDATE memory_extraction_runs
      SET status = 'queued', attempts = 0, discarded_count = 0, started_at = NULL, completed_at = NULL, error = NULL
      WHERE id = ? AND status = 'failed'
    `).run(id);
    if (result.changes !== 1) throw new Error('Extraction run is not failed');
  }

  completeRun(id: string, discardedCount = 0): void {
    this.setRunTerminalState(id, 'completed', undefined, discardedCount);
  }

  failRun(id: string, error: string): void {
    this.setRunTerminalState(id, 'failed', error);
  }

  recoverInterruptedRuns(): void {
    this.db.prepare(`
      UPDATE memory_extraction_runs
      SET status = 'queued', attempts = MAX(attempts - 1, 0), started_at = NULL,
          error = 'Interrupted by server shutdown'
      WHERE status = 'running'
    `).run();
  }

  applyExtractionCandidates(
    runId: string,
    candidates: ValidatedExtractionCandidate[],
    emittedCount = candidates.length,
  ): ExtractionApplyResult {
    return this.db.transaction(() => {
      const run = this.getExtractionRun(runId);
      if (!run || run.status !== 'running') throw new Error('Extraction run is not running');
      const createdIds: string[] = [];
      let activeProjectCount = 0;
      let pendingGlobalCount = 0;
      let discardedCount = 0;

      for (const candidate of candidates) {
        const existing = candidate.existingMemoryId ? this.getMemory(candidate.existingMemoryId) : null;
        if (candidate.operation === 'duplicate') {
          if (!existing) throw new Error('Extraction existing memory not found');
          this.assertCandidateExisting(run, candidate.scope, existing);
          continue;
        }
        if (candidate.operation === 'replace') {
          if (!existing) throw new Error('Extraction existing memory not found');
          this.assertCandidateExisting(run, candidate.scope, existing);
        }

        const status: MemoryStatus = candidate.scope === 'project' ? 'active' : 'pending';
        const source: MemorySource = run.sourceKind === 'automatic' ? 'automatic' : 'session_import';
        let created: MemoryRecord;
        if (candidate.operation === 'replace' && existing && candidate.scope === 'project') {
          created = this.replaceMemory(existing.id, existing.revision, {
            category: candidate.category,
            content: candidate.content,
            tags: candidate.tags,
            pinned: false,
            source,
            status,
            sourceSessionId: run.sourceSessionId,
            sourceEntryId: run.endingLeafId,
            extractionRunId: run.id,
            evidence: candidate.evidence,
          });
        } else {
          try {
            created = this.createMemory({
              profileId: run.profileId,
              projectId: candidate.scope === 'project' ? run.projectId : undefined,
              scope: candidate.scope,
              category: candidate.category,
              content: candidate.content,
              tags: candidate.tags,
              pinned: false,
              status,
              source,
              sourceSessionId: run.sourceSessionId,
              sourceEntryId: run.endingLeafId,
              evidence: candidate.evidence,
              extractionRunId: run.id,
              supersedesId: candidate.operation === 'replace' ? existing!.id : undefined,
              supersedesRevision: candidate.operation === 'replace' ? existing!.revision : undefined,
            });
          } catch (error) {
            if (candidate.operation === 'new' && isDuplicateMemoryError(error)) {
              discardedCount += 1;
              continue;
            }
            throw error;
          }
        }
        createdIds.push(created.id);
        if (created.scope === 'project') activeProjectCount += 1;
        else pendingGlobalCount += 1;
      }

      const duplicateCount = candidates.filter((candidate) => candidate.operation === 'duplicate').length + discardedCount;
      const replacedCount = candidates.filter((candidate) => candidate.operation === 'replace').length;
      const telemetry = this.db.prepare(`
        UPDATE memory_extraction_runs
        SET emitted_count = ?, validated_count = ?, created_count = ?, duplicate_count = ?, replaced_count = ?
        WHERE id = ? AND status = 'running'
      `).run(emittedCount, candidates.length, createdIds.length, duplicateCount, replacedCount, runId);
      if (telemetry.changes !== 1) throw new Error('Extraction run is not running');

      return { createdIds, activeProjectCount, pendingGlobalCount, discardedCount };
    })();
  }

  undoExtractionRun(runId: string): ExtractionUndoResult {
    return this.db.transaction(() => {
      const run = this.getExtractionRun(runId);
      if (!run || run.status !== 'completed') throw new Error('Extraction run is not completed');
      const records = (this.db.prepare(`
        SELECT * FROM memories WHERE extraction_run_id = ? ORDER BY created_at DESC, id DESC
      `).all(runId) as MemoryRow[]).map(mapMemoryRow);
      const archivedIds: string[] = [];
      const restoredIds: string[] = [];
      const skippedIds: string[] = [];

      for (const record of records) {
        if (record.revision !== 1 || (record.status !== 'active' && record.status !== 'pending')) {
          skippedIds.push(record.id);
          continue;
        }
        const predecessor = record.supersedesId ? this.getMemory(record.supersedesId) : null;
        if (record.supersedesId && (!predecessor || predecessor.revision !== record.supersedesRevision)) {
          skippedIds.push(record.id);
          continue;
        }

        this.archiveMemory(record.id, record.revision);
        archivedIds.push(record.id);
        if (predecessor?.status === 'archived') {
          const result = this.db.prepare(`
            UPDATE memories
            SET status = 'active', revision = revision + 1, updated_at = ?
            WHERE id = ? AND revision = ? AND status = 'archived'
          `).run(new Date().toISOString(), predecessor.id, predecessor.revision);
          if (result.changes !== 1) throw new Error('Superseded memory was modified');
          restoredIds.push(predecessor.id);
        }
      }

      return { archivedIds, restoredIds, skippedIds };
    })();
  }

  private setRunTerminalState(
    id: string,
    status: 'completed' | 'failed',
    error?: string,
    discardedCount = 0,
  ): void {
    const result = this.db.prepare(`
      UPDATE memory_extraction_runs
      SET status = ?, error = ?, discarded_count = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(status, error ?? null, discardedCount, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error('Extraction run is not running');
  }

  private requireMemory(id: string, expectedRevision?: number): MemoryRecord {
    const memory = this.getMemory(id);
    if (!memory) throw new Error('Memory not found');
    if (expectedRevision !== undefined && memory.revision !== expectedRevision) throw new Error('Memory was modified');
    return memory;
  }

  private assertCandidateExisting(run: MemoryExtractionRun, scope: MemoryRecord['scope'], memory: MemoryRecord): void {
    if (memory.profileId !== run.profileId || memory.scope !== scope) {
      throw new Error('Extraction existing memory is outside the run scope');
    }
    if (scope === 'project' && memory.projectId !== run.projectId) {
      throw new Error('Extraction existing memory is outside the run project');
    }
  }

  private count(where: string, ...params: unknown[]): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${where}`).get(...params) as CountRow).count;
  }

  private countRuns(where: string, ...params: unknown[]): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM memory_extraction_runs WHERE ${where}`).get(...params) as CountRow).count;
  }

  private assertCanSupersede(
    input: Pick<CreateMemoryInput | MemoryRecord, 'profileId' | 'projectId' | 'scope'>,
    superseded: MemoryRecord | null,
  ): void {
    if (!superseded) throw new Error('Memory to supersede was not found');
    if (superseded.profileId !== input.profileId || superseded.scope !== input.scope) {
      throw new Error('Memory cannot supersede a record in another profile or scope');
    }
    if (input.scope === 'project' && superseded.projectId !== input.projectId) {
      throw new Error('Memory cannot supersede a record in another project');
    }
  }

  private assertScope(profileId: string, projectId: string | undefined, scope: MemoryRecord['scope']): void {
    if (scope === 'global') {
      if (projectId) throw new Error('Global memory cannot have a project');
      return;
    }
    if (!projectId) throw new Error('Project memory requires a project');
    const project = this.getProjectById(projectId);
    if (!project || project.profileId !== profileId) throw new Error('Memory project not found for profile');
  }
}

class DuplicateMemoryError extends Error {
  constructor() {
    super('Memory already exists in this scope');
  }
}

function isDuplicateMemoryError(error: unknown): boolean {
  return error instanceof DuplicateMemoryError;
}

function buildListFilter(query: MemoryListQuery): { where: string; params: unknown[] } {
  const clauses = ['m.profile_id = ?'];
  const params: unknown[] = [query.profileId];

  if (query.scope === 'project') {
    if (!query.projectId) return { where: 'WHERE 0 = 1', params: [] };
    clauses.push("m.scope = 'project'", 'm.project_id = ?');
    params.push(query.projectId);
  } else if (query.scope === 'global') {
    clauses.push("m.scope = 'global'");
  } else if (query.projectId) {
    clauses.push("(m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))");
    params.push(query.projectId);
  } else {
    clauses.push("m.scope = 'global'");
  }

  if (query.statuses?.length) {
    clauses.push(`m.status IN (${query.statuses.map(() => '?').join(', ')})`);
    params.push(...query.statuses);
  }
  if (query.categories?.length) {
    clauses.push(`m.category IN (${query.categories.map(() => '?').join(', ')})`);
    params.push(...query.categories);
  }
  if (query.extractionRunId) {
    clauses.push('m.extraction_run_id = ?');
    params.push(query.extractionRunId);
  }
  if (query.query?.trim()) {
    clauses.push('(lower(m.content) LIKE ? OR lower(m.tags_json) LIKE ?)');
    const pattern = `%${query.query.trim().toLowerCase()}%`;
    params.push(pattern, pattern);
  }

  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

function mapProjectRow(row: MemoryProjectRow): MemoryProject {
  return {
    id: row.id,
    profileId: row.profile_id,
    canonicalPath: row.canonical_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemoryRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    projectId: row.project_id ?? undefined,
    scope: row.scope,
    category: row.category,
    content: row.content,
    contentHash: row.content_hash,
    tags: JSON.parse(row.tags_json) as string[],
    pinned: row.pinned === 1,
    pinnedApplicability: row.pinned_applicability,
    status: row.status,
    source: row.source,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceEntryId: row.source_entry_id ?? undefined,
    evidence: row.evidence ?? undefined,
    extractionRunId: row.extraction_run_id ?? undefined,
    supersedesId: row.supersedes_id ?? undefined,
    supersedesRevision: row.supersedes_revision ?? undefined,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    useCount: row.use_count,
    positiveUtilityCount: row.positive_utility_count,
    negativeUtilityCount: row.negative_utility_count,
    lastUtilityAt: row.last_utility_at ?? undefined,
  };
}

function mapExtractionRunRow(row: MemoryExtractionRunRow): MemoryExtractionRun {
  return {
    id: row.id,
    profileId: row.profile_id,
    projectId: row.project_id,
    sourceSessionId: row.source_session_id,
    sourceSessionPath: row.source_session_path,
    sourceKind: row.source_kind,
    startingLeafId: row.starting_leaf_id ?? undefined,
    endingLeafId: row.ending_leaf_id,
    status: row.status,
    modelProvider: row.model_provider ?? undefined,
    modelId: row.model_id ?? undefined,
    attempts: row.attempts,
    discardedCount: row.discarded_count,
    gateDecision: row.gate_decision ?? undefined,
    gateReasonCode: row.gate_reason_code ?? undefined,
    normalizedEvidenceCount: row.normalized_evidence_count ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    cacheWriteTokens: row.cache_write_tokens ?? undefined,
    tokenAccountingMethod: row.token_accounting_method ?? undefined,
    promptFormatVersion: row.prompt_format_version ?? undefined,
    emittedCount: row.emitted_count,
    validatedCount: row.validated_count,
    createdCount: row.created_count,
    duplicateCount: row.duplicate_count,
    replacedCount: row.replaced_count,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}
