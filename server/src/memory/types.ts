export type MemoryScope = 'project' | 'global';
export type MemoryCategory = 'rule' | 'preference' | 'decision' | 'fact' | 'pitfall';
export type MemoryStatus = 'active' | 'pending' | 'archived';
export type MemoryPinnedApplicability = 'always' | 'matched';
export type MemorySource = 'explicit' | 'automatic' | 'session_import' | 'manual_ui';
export type ExtractionSourceKind = 'automatic' | 'session_import';
export type ExtractionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ExtractionOperation = 'new' | 'duplicate' | 'replace';

export interface MemoryProject {
  id: string;
  profileId: string;
  canonicalPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  profileId: string;
  projectId?: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  contentHash: string;
  tags: string[];
  pinned: boolean;
  pinnedApplicability: MemoryPinnedApplicability;
  status: MemoryStatus;
  source: MemorySource;
  sourceSessionId?: string;
  sourceEntryId?: string;
  evidence?: string;
  extractionRunId?: string;
  supersedesId?: string;
  supersedesRevision?: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  positiveUtilityCount: number;
  negativeUtilityCount: number;
  lastUtilityAt?: string;
}

export interface MemoryContext {
  profileId: string;
  project: MemoryProject;
  sessionId?: string;
  sessionPath?: string;
}

export interface ExtractionCandidate {
  operation: ExtractionOperation;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags: string[];
  evidenceIds: string[];
  existingMemoryId?: string;
}

export interface ValidatedExtractionCandidate extends ExtractionCandidate {
  evidence: string;
}

export interface MemoryExtractionRun {
  id: string;
  profileId: string;
  projectId: string;
  sourceSessionId: string;
  sourceSessionPath: string;
  sourceKind: ExtractionSourceKind;
  startingLeafId?: string;
  endingLeafId: string;
  status: ExtractionStatus;
  modelProvider?: string;
  modelId?: string;
  attempts: number;
  discardedCount: number;
  gateDecision?: 'extract' | 'skip';
  gateReasonCode?: string;
  normalizedEvidenceCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  tokenAccountingMethod?: string;
  promptFormatVersion?: string;
  emittedCount: number;
  validatedCount: number;
  createdCount: number;
  duplicateCount: number;
  replacedCount: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MemoryRecallItem {
  id: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  reason: 'pinned' | 'query-match';
}

export interface MemoryRecallScoreComponents {
  bm25: number;
  exactPhrase: number;
  exactEntity: number;
  lexicalOverlap: number;
  projectScope: number;
  categoryIntent: number;
  pinnedApplicability: number;
  freshness: number;
  utility: number;
  weakMatchPenalty: number;
  stalenessPenalty: number;
}

export interface MemoryRecallSelectionDiagnostic {
  id: string;
  score: number;
  components: MemoryRecallScoreComponents;
}

export interface MemoryRecallDiagnostics {
  candidateIds: string[];
  rejectedBelowThresholdIds: string[];
  redundancyRejectedIds: string[];
  selected: MemoryRecallSelectionDiagnostic[];
  budgetCeiling: number;
  usedTokens: number;
  overflow: boolean;
  countingMethod: string;
  rankingPolicyVersion: string;
  promptFormatVersion: string;
  skipReason?: string;
}

export interface MemoryRecallResult {
  prompt: string;
  memories: MemoryRecallItem[];
  tokenCount: number;
  diagnostics?: MemoryRecallDiagnostics;
}

export interface MemoryRecallEvent {
  profileId: string;
  projectId: string;
  sessionId?: string;
  prompt: string;
  injected: boolean;
  memories: MemoryRecallItem[];
  tokenCount: number;
  diagnostics?: MemoryRecallDiagnostics;
  createdAt: string;
}

export interface MemoryUpdatedEvent {
  profileId: string;
  projectId: string;
  extractionRunId: string;
  activeProjectCount: number;
  pendingGlobalCount: number;
  failed: boolean;
}

export interface CreateMemoryInput {
  profileId: string;
  projectId?: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags: string[];
  pinned: boolean;
  pinnedApplicability?: MemoryPinnedApplicability;
  status: MemoryStatus;
  source: MemorySource;
  sourceSessionId?: string;
  sourceEntryId?: string;
  evidence?: string;
  extractionRunId?: string;
  supersedesId?: string;
  supersedesRevision?: number;
}

export interface SaveMemoryInput {
  scope?: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags?: string[];
  pinned?: boolean;
  pinnedApplicability?: MemoryPinnedApplicability;
}

export interface MemoryPatch {
  category?: MemoryCategory;
  content?: string;
  tags?: string[];
  pinned?: boolean;
  pinnedApplicability?: MemoryPinnedApplicability;
}

export interface ExtractionRunTelemetryUpdate {
  modelProvider?: string;
  modelId?: string;
  gateDecision?: 'extract' | 'skip';
  gateReasonCode?: string;
  normalizedEvidenceCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  tokenAccountingMethod?: string;
  promptFormatVersion?: string;
  emittedCount?: number;
  validatedCount?: number;
  createdCount?: number;
  duplicateCount?: number;
  replacedCount?: number;
}

export interface RecordMemoryRecallEventInput extends MemoryRecallDiagnostics {
  profileId: string;
  projectId: string;
  sessionId?: string;
  injected: boolean;
}

export interface MemoryListQuery {
  profileId: string;
  projectId?: string;
  scope?: MemoryScope;
  statuses?: MemoryStatus[];
  categories?: MemoryCategory[];
  extractionRunId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface MemorySearchQuery {
  profileId: string;
  projectId: string;
  statuses: MemoryStatus[];
  categories?: MemoryCategory[];
  query: string;
  limit: number;
}

export interface MemoryRecallCandidate {
  memory: MemoryRecord;
  bm25Rank: number;
}

export interface MemoryRecallSearchQuery {
  profileId: string;
  projectId: string;
  categories: MemoryCategory[];
  ftsQuery: string | null;
  fallbackTerms: string[];
  limit: number;
}

export interface MemoryCounts {
  projectActive: number;
  globalActive: number;
  globalPending: number;
  archived: number;
  failedExtractions: number;
  pinnedOverflow: boolean;
}

export interface EnqueueExtractionRunInput {
  profileId: string;
  projectId: string;
  sourceSessionId: string;
  sourceSessionPath: string;
  sourceKind: ExtractionSourceKind;
  startingLeafId?: string;
  endingLeafId: string;
  modelProvider?: string;
  modelId?: string;
}

export interface ExtractionApplyResult {
  createdIds: string[];
  activeProjectCount: number;
  pendingGlobalCount: number;
  discardedCount: number;
}

export interface ExtractionUndoResult {
  archivedIds: string[];
  restoredIds: string[];
  skippedIds: string[];
}
