import { randomUUID } from 'crypto';
import type { PiuiDatabase } from '../db/database';
import type { CreateSessionWorktreeOptions } from '../types';

export type ProjectTaskStatus = 'waiting' | 'starting' | 'started' | 'completed';
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
  worktree: CreateSessionWorktreeOptions;
}

export interface ProjectTaskGiteaIssue {
  owner: string;
  repo: string;
  number: number;
  url: string;
  createdAt: string;
}

export interface AttachGiteaIssueInput {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface ProjectTaskRecord extends ProjectTaskDraft {
  id: string;
  status: ProjectTaskStatus;
  sessionId: string | null;
  giteaIssue: ProjectTaskGiteaIssue | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProjectTaskListOptions {
  projectPath?: string;
  status?: ProjectTaskStatus;
}

interface ProjectTaskRow {
  id: string;
  project_path: string;
  title: string;
  prompt: string;
  notes: string;
  status: ProjectTaskStatus;
  agent_profile_id: string;
  model_provider: string;
  model_id: string;
  skill_mode: ProjectTaskSkillMode;
  skills_json: string;
  worktree_json: string;
  session_id: string | null;
  gitea_issue_owner: string | null;
  gitea_issue_repo: string | null;
  gitea_issue_number: number | null;
  gitea_issue_url: string | null;
  gitea_issue_created_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ProjectTaskStoreOptions {
  createId?: () => string;
  now?: () => string;
}

export class ProjectTaskNotFoundError extends Error {}
export class ProjectTaskConflictError extends Error {}
export class ProjectTaskValidationError extends Error {}

export class ProjectTaskStore {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(private readonly db: PiuiDatabase, options: ProjectTaskStoreOptions = {}) {
    this.createId = options.createId || randomUUID;
    this.now = options.now || (() => new Date().toISOString());
  }

  create(input: ProjectTaskDraft): ProjectTaskRecord {
    const draft = normalizeDraft(input);
    const id = this.createId();
    const timestamp = this.now();
    this.db.prepare(`
      INSERT INTO project_tasks (
        id, project_path, title, prompt, notes, status, agent_profile_id,
        model_provider, model_id, skill_mode, skills_json, worktree_json,
        session_id, created_at, updated_at, started_at, completed_at
      ) VALUES (
        @id, @projectPath, @title, @prompt, @notes, 'waiting', @agentProfileId,
        @modelProvider, @modelId, @skillMode, @skillsJson, @worktreeJson,
        NULL, @createdAt, @updatedAt, NULL, NULL
      )
    `).run({
      id,
      ...draft,
      skillsJson: JSON.stringify(draft.skills),
      worktreeJson: JSON.stringify(draft.worktree),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.require(id);
  }

  get(id: string): ProjectTaskRecord | null {
    const row = this.db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(id) as ProjectTaskRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(options: ProjectTaskListOptions = {}): ProjectTaskRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.projectPath) {
      clauses.push('project_path = ?');
      params.push(options.projectPath);
    }
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM project_tasks${where} ORDER BY created_at ASC, id ASC`).all(...params) as ProjectTaskRow[];
    return rows.map(mapRow);
  }

  listProjectPaths(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT project_path FROM project_tasks ORDER BY project_path').all() as Array<{ project_path: string }>;
    return rows.map((row) => row.project_path);
  }

  update(id: string, input: ProjectTaskDraft): ProjectTaskRecord {
    const draft = normalizeDraft(input);
    const result = this.db.prepare(`
      UPDATE project_tasks SET
        project_path = @projectPath,
        title = @title,
        prompt = @prompt,
        notes = @notes,
        agent_profile_id = @agentProfileId,
        model_provider = @modelProvider,
        model_id = @modelId,
        skill_mode = @skillMode,
        skills_json = @skillsJson,
        worktree_json = @worktreeJson,
        updated_at = @updatedAt
      WHERE id = @id AND status = 'waiting'
    `).run({
      id,
      ...draft,
      skillsJson: JSON.stringify(draft.skills),
      worktreeJson: JSON.stringify(draft.worktree),
      updatedAt: this.now(),
    });
    this.assertChanged(id, Number(result.changes), 'Only waiting tasks can be edited');
    return this.require(id);
  }

  claimStart(id: string): ProjectTaskRecord {
    const result = this.db.prepare(`
      UPDATE project_tasks SET status = 'starting', updated_at = ?
      WHERE id = ? AND status = 'waiting'
    `).run(this.now(), id);
    this.assertChanged(id, Number(result.changes), 'Only waiting tasks can be started');
    return this.require(id);
  }

  markStarted(id: string, sessionId: string): ProjectTaskRecord {
    const timestamp = this.now();
    const result = this.db.prepare(`
      UPDATE project_tasks
      SET status = 'started', session_id = ?, started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'starting'
    `).run(sessionId, timestamp, timestamp, id);
    this.assertChanged(id, Number(result.changes), 'Task is not being started');
    return this.require(id);
  }

  restoreWaiting(id: string): ProjectTaskRecord {
    const result = this.db.prepare(`
      UPDATE project_tasks SET status = 'waiting', updated_at = ?
      WHERE id = ? AND status = 'starting'
    `).run(this.now(), id);
    this.assertChanged(id, Number(result.changes), 'Task is not being started');
    return this.require(id);
  }

  restoreAllStarting(): number {
    const result = this.db.prepare(`
      UPDATE project_tasks SET status = 'waiting', updated_at = ?
      WHERE status = 'starting'
    `).run(this.now());
    return Number(result.changes);
  }

  complete(id: string): ProjectTaskRecord {
    const timestamp = this.now();
    const result = this.db.prepare(`
      UPDATE project_tasks
      SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'started'
    `).run(timestamp, timestamp, id);
    this.assertChanged(id, Number(result.changes), 'Only started tasks can be completed');
    return this.require(id);
  }

  attachGiteaIssue(id: string, input: AttachGiteaIssueInput): ProjectTaskRecord {
    const timestamp = this.now();
    const result = this.db.prepare(`
      UPDATE project_tasks SET
        gitea_issue_owner = ?,
        gitea_issue_repo = ?,
        gitea_issue_number = ?,
        gitea_issue_url = ?,
        gitea_issue_created_at = ?,
        updated_at = ?
      WHERE id = ? AND gitea_issue_url IS NULL
    `).run(input.owner, input.repo, input.number, input.url, timestamp, timestamp, id);
    this.assertChanged(id, Number(result.changes), 'Task already has a Gitea issue');
    return this.require(id);
  }

  delete(id: string): void {
    const result = this.db.prepare('DELETE FROM project_tasks WHERE id = ?').run(id);
    if (!result.changes) throw new ProjectTaskNotFoundError('Task not found');
  }

  replaceProjectPath(oldProjectPath: string, newProjectPath: string): number {
    const result = this.db.prepare(`
      UPDATE project_tasks SET project_path = ?, updated_at = ?
      WHERE project_path = ?
    `).run(newProjectPath, this.now(), oldProjectPath);
    return Number(result.changes);
  }

  private require(id: string): ProjectTaskRecord {
    const task = this.get(id);
    if (!task) throw new ProjectTaskNotFoundError('Task not found');
    return task;
  }

  private assertChanged(id: string, changes: number, message: string): void {
    if (changes) return;
    if (!this.get(id)) throw new ProjectTaskNotFoundError('Task not found');
    throw new ProjectTaskConflictError(message);
  }
}

export function isProjectTaskStatus(value: unknown): value is ProjectTaskStatus {
  return value === 'waiting' || value === 'starting' || value === 'started' || value === 'completed';
}

export function isProjectTaskSkillMode(value: unknown): value is ProjectTaskSkillMode {
  return value === 'all' || value === 'enabled' || value === 'disabled';
}

export function normalizeWorktree(value: unknown): CreateSessionWorktreeOptions {
  if (!value || typeof value !== 'object') throw new ProjectTaskValidationError('Invalid worktree settings');
  const worktree = value as Record<string, unknown>;
  if (worktree.mode === 'none') return { mode: 'none' };
  if (worktree.mode !== 'managed') throw new ProjectTaskValidationError('Invalid worktree settings');

  const branchName = requiredString(worktree.branchName, 'branchName');
  const copyFile = optionalString(worktree.copyFile);
  if (worktree.branchMode === 'new') {
    const baseBranch = requiredString(worktree.baseBranch, 'baseBranch');
    return { mode: 'managed', branchMode: 'new', branchName, baseBranch, ...(copyFile ? { copyFile } : {}) };
  }
  if (worktree.branchMode === 'existing') {
    return { mode: 'managed', branchMode: 'existing', branchName, ...(copyFile ? { copyFile } : {}) };
  }
  throw new ProjectTaskValidationError('Invalid worktree settings');
}

function normalizeDraft(input: ProjectTaskDraft): ProjectTaskDraft {
  if (!input || typeof input !== 'object') throw new ProjectTaskValidationError('Task payload is required');
  if (!isProjectTaskSkillMode(input.skillMode)) throw new ProjectTaskValidationError('Invalid skill mode');
  if (!Array.isArray(input.skills) || input.skills.some((skill) => typeof skill !== 'string')) {
    throw new ProjectTaskValidationError('Skills must be an array of names');
  }
  return {
    projectPath: requiredString(input.projectPath, 'projectPath'),
    title: requiredString(input.title, 'title'),
    prompt: requiredString(input.prompt, 'prompt'),
    notes: typeof input.notes === 'string' ? input.notes : '',
    agentProfileId: requiredString(input.agentProfileId, 'agentProfileId'),
    modelProvider: requiredString(input.modelProvider, 'modelProvider'),
    modelId: requiredString(input.modelId, 'modelId'),
    skillMode: input.skillMode,
    skills: Array.from(new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))),
    worktree: normalizeWorktree(input.worktree),
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProjectTaskValidationError(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mapRow(row: ProjectTaskRow): ProjectTaskRecord {
  return {
    id: row.id,
    projectPath: row.project_path,
    title: row.title,
    prompt: row.prompt,
    notes: row.notes,
    status: row.status,
    agentProfileId: row.agent_profile_id,
    modelProvider: row.model_provider,
    modelId: row.model_id,
    skillMode: row.skill_mode,
    skills: JSON.parse(row.skills_json) as string[],
    worktree: JSON.parse(row.worktree_json) as CreateSessionWorktreeOptions,
    sessionId: row.session_id,
    giteaIssue: row.gitea_issue_url ? {
      owner: row.gitea_issue_owner || '',
      repo: row.gitea_issue_repo || '',
      number: Number(row.gitea_issue_number),
      url: row.gitea_issue_url,
      createdAt: row.gitea_issue_created_at || row.updated_at,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
