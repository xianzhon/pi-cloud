import type { AgentSession } from '@earendil-works/pi-coding-agent';

// server/src/types.ts
export interface AgentProfile {
  id: string;
  label: string;
  path: string;
  isDefault: boolean;
  defaultProvider?: string;
  defaultModel?: string;
  automationProvider?: string;
  automationModel?: string;
}

export interface SessionActivityRecord {
  id: number;
  sessionId: string;
  kind: 'commit_created' | 'commit_amended' | 'pr_created' | 'branch_deleted';
  data: Record<string, unknown>;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  name?: string;
  path: string;
  created: string;
  modified: string;
  messageCount: number;
  cwd?: string;
  firstMessage?: string;
  allMessagesText?: string;
  isStreaming?: boolean;
  worktree?: SessionWorktreeInfo;
}

export type WorktreeBranchMode = 'new' | 'existing';
export type WorktreeStatus = 'active' | 'finished';

export interface SessionWorktreeInfo {
  sessionId: string;
  baseRepoPath: string;
  worktreePath: string;
  branchName: string;
  branchMode: WorktreeBranchMode;
  baseBranch?: string;
  worktreeManaged: true;
  worktreeStatus: WorktreeStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

interface WorktreeCopyOptions {
  copyFile?: string;
}

export type CreateSessionWorktreeOptions =
  | { mode: 'none' }
  | ({
      mode: 'managed';
      branchMode: 'new';
      branchName: string;
      baseBranch: string;
    } & WorktreeCopyOptions)
  | ({
      mode: 'managed';
      branchMode: 'existing';
      branchName: string;
    } & WorktreeCopyOptions);

export interface ResolvedWorktreeSession {
  cwd: string;
  metadata?: Omit<SessionWorktreeInfo, 'sessionId' | 'createdAt' | 'updatedAt' | 'finishedAt'>;
}

export interface SessionOptions {
  cwd?: string;
  modelProvider?: string;
  modelId?: string;
  enabledSkills?: string[];
  disabledSkills?: string[];
  presetId?: string;
  skillMode?: AppliedSkillPolicy['mode'];
  noSession?: boolean;
  memoryEnabled?: boolean;
}

export interface AppliedSkillPolicy {
  mode: 'all' | 'enabled' | 'disabled';
  appliedSkills: string[];
  ignoredSkills: string[];
  presetId?: string | null;
}

export interface CreateSessionResult {
  session: AgentSession;
  skillPolicy: AppliedSkillPolicy;
}

export interface AvailableSkillInfo {
  name: string;
  description: string;
  path?: string;
}

export interface CreateSessionRequest {
  clientId: string;
  cwd?: string;
  modelProvider?: string;
  modelId?: string;
  enabledSkills?: string[];
  disabledSkills?: string[];
  presetId?: string;
  copySettingsFromSessionId?: string;
  worktree?: CreateSessionWorktreeOptions;
}

export interface ResumeSessionRequest {
  clientId: string;
  sessionPath: string;
}

export interface RelocateProjectSessionsRequest {
  clientId: string;
  oldProjectPath: string;
  newProjectPath: string;
}

export interface RelocateProjectSessionsResponse {
  success: true;
  moved: number;
  skipped: number;
}

export interface MoveProjectRequest {
  clientId: string;
  oldProjectPath: string;
  destinationParentPath: string;
  newProjectName: string;
}

export interface MoveProjectResponse {
  success: true;
  projectPath: string;
  movedSessions: number;
  skippedSessionFiles: number;
}

export interface AgentProfileSelectionRequest {
  clientId: string;
  profileId: string;
}

export interface AgentProfileQuery {
  clientId: string;
}

export interface SessionRuntimeStatus {
  model?: {
    provider?: string;
    id?: string;
    contextWindow?: number;
    reasoning?: boolean;
    input?: string[];
  };
  thinkingLevel?: string;
  thinkingLevels?: string[];
  usingSubscription: boolean;
  autoCompactionEnabled: boolean;
  stats: {
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
  };
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export interface SessionCommandInfo {
  name?: string;
  workDir?: string;
  model?: {
    provider?: string;
    id?: string;
  };
  stats: {
    sessionFile: string | undefined;
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
  };
}
