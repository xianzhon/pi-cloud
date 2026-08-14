export type MemoryScope = 'project' | 'global';
export type MemoryCategory = 'rule' | 'preference' | 'decision' | 'fact' | 'pitfall';
export type MemoryStatus = 'active' | 'pending' | 'archived';
export type MemoryPinnedApplicability = 'always' | 'matched';

export interface MemoryRecord {
  id: string;
  profileId: string;
  projectId?: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags: string[];
  pinned: boolean;
  pinnedApplicability?: MemoryPinnedApplicability;
  status: MemoryStatus;
  source: 'explicit' | 'automatic' | 'session_import' | 'manual_ui';
  sourceSessionId?: string;
  extractionRunId?: string;
  evidence?: string;
  supersedesId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryCounts {
  projectActive: number;
  globalActive: number;
  globalPending: number;
  archived: number;
  failedExtractions: number;
  pinnedOverflow: boolean;
}

export interface MemoryExtractionRun {
  id: string;
  sourceKind: 'automatic' | 'session_import';
  sourceSessionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  modelProvider?: string;
  modelId?: string;
  attempts: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MemoryUpdatedEvent {
  type: 'memory_updated';
  profileId: string;
  projectId: string;
  extractionRunId: string;
  activeProjectCount: number;
  pendingGlobalCount: number;
  failed: boolean;
}

export interface MemoryListResponse {
  memories: MemoryRecord[];
  total: number;
}

export interface MemoryFilters {
  scope: MemoryScope;
  statuses: MemoryStatus[];
  categories: MemoryCategory[];
  query: string;
  extractionRunId?: string;
  limit: number;
  offset: number;
}

export interface CreateMemoryPayload {
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags: string[];
  pinned: boolean;
  pinnedApplicability?: MemoryPinnedApplicability;
}

export type MemoryPatchPayload = Partial<Pick<MemoryRecord, 'category' | 'content' | 'tags' | 'pinned' | 'pinnedApplicability'>>;

export interface MemoryToastState {
  extractionRunId: string;
  activeProjectCount: number;
  pendingGlobalCount: number;
  failed: boolean;
}
