import type { WorktreePayload } from './sessionLaunch';

export type ProjectTaskStatus = 'waiting' | 'starting' | 'started' | 'completed';
export type ProjectTaskVisibleStatus = Exclude<ProjectTaskStatus, 'starting'>;
export type ProjectTaskSkillMode = 'all' | 'enabled' | 'disabled';

export interface ProjectTaskDraft {
  projectPath: string;
  title: string;
  prompt: string;
  notes: string;
  agentProfileId: string;
  modelProvider: string;
  modelId: string;
  skillMode: ProjectTaskSkillMode;
  skills: string[];
  presetId?: string | null;
  worktree: WorktreePayload;
}

export interface ProjectTaskGiteaIssue {
  owner: string;
  repo: string;
  number: number;
  url: string;
  createdAt: string;
}

export interface ProjectTask extends ProjectTaskDraft {
  id: string;
  status: ProjectTaskStatus;
  sessionId: string | null;
  giteaIssue: ProjectTaskGiteaIssue | null;
  pullRequest?: {
    number: number;
    url: string;
    status: 'ready' | 'merged';
  };
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StartedTaskWorktree {
  sessionId: string;
  baseRepoPath: string;
  worktreePath: string;
  branchName: string;
  branchMode: 'new' | 'existing';
  baseBranch?: string;
  worktreeManaged: true;
  worktreeStatus: 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface ProjectTaskStartResult {
  task: ProjectTask;
  sessionId: string;
  prompt: string;
  worktree?: StartedTaskWorktree;
}
