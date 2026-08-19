import { stat as fsStat } from 'fs/promises';
import type { AgentProfile, AvailableSkillInfo, CreateSessionResult, ResolvedWorktreeSession, SessionOptions, SessionWorktreeInfo } from '../types';
import type { ProjectTaskRecord, ProjectTaskStore } from './project-task-store';
import { ProjectTaskValidationError } from './project-task-store';

interface ProjectTaskSessionService {
  listAgentProfiles(): Promise<AgentProfile[]>;
  listAgentProfileModels(profileId: string): Promise<Array<{ provider: string; id: string }>>;
  listAgentProfileSkills(profileId: string, cwd: string): Promise<AvailableSkillInfo[]>;
  setClientAgentProfile(clientId: string, profileId: string): Promise<AgentProfile>;
  createSession(clientId: string, options: SessionOptions): Promise<CreateSessionResult>;
}

interface ProjectTaskWorktreeManager {
  resolveSessionCwd(projectPath: string, worktree: ProjectTaskRecord['worktree']): Promise<ResolvedWorktreeSession>;
}

interface ProjectTaskWorktreeMetadataStore {
  save(info: Omit<SessionWorktreeInfo, 'createdAt' | 'updatedAt' | 'finishedAt'>): SessionWorktreeInfo;
}

interface ProjectTaskPresetStore {
  getById(id: string): { id: string; mode: 'enabled' | 'disabled'; skills: string[] } | null;
}

interface ProjectTaskStarterOptions {
  store: ProjectTaskStore;
  sessionService: ProjectTaskSessionService;
  worktreeManager: ProjectTaskWorktreeManager;
  worktreeMetadataStore: ProjectTaskWorktreeMetadataStore;
  presetStore: ProjectTaskPresetStore;
  stat?: (path: string) => Promise<{ isDirectory(): boolean }>;
}

export interface ProjectTaskStartResult {
  task: ProjectTaskRecord;
  sessionId: string;
  prompt: string;
  model: CreateSessionResult['session']['model'];
  thinkingLevel: CreateSessionResult['session']['thinkingLevel'];
  worktree?: SessionWorktreeInfo;
}

export class ProjectTaskStarter {
  private readonly stat: NonNullable<ProjectTaskStarterOptions['stat']>;

  constructor(private readonly options: ProjectTaskStarterOptions) {
    this.stat = options.stat || fsStat;
  }

  async start(taskId: string, clientId: string): Promise<ProjectTaskStartResult> {
    const task = this.options.store.claimStart(taskId);
    let sessionCreated = false;
    try {
      const launchTask = this.resolveSkillPolicy(task);
      await this.validateProject(task.projectPath);
      await this.validateProfileModelAndSkills(launchTask);
      await this.options.sessionService.setClientAgentProfile(clientId, task.agentProfileId);
      const resolved = await this.options.worktreeManager.resolveSessionCwd(task.projectPath, task.worktree);
      const created = await this.options.sessionService.createSession(clientId, toSessionOptions(launchTask, resolved.cwd));
      sessionCreated = true;
      const worktree = resolved.metadata
        ? this.options.worktreeMetadataStore.save({ sessionId: created.session.sessionId, ...resolved.metadata })
        : undefined;
      const started = this.options.store.markStarted(task.id, created.session.sessionId);
      return {
        task: started,
        sessionId: created.session.sessionId,
        prompt: task.prompt,
        model: created.session.model,
        thinkingLevel: created.session.thinkingLevel,
        worktree,
      };
    } catch (error) {
      if (!sessionCreated) this.options.store.restoreWaiting(task.id);
      throw error;
    }
  }

  private resolveSkillPolicy(task: ProjectTaskRecord): ProjectTaskRecord {
    if (!task.presetId) return task;
    const preset = this.options.presetStore.getById(task.presetId);
    if (!preset) return { ...task, presetId: null, skillMode: 'enabled', skills: [] };
    return { ...task, skillMode: preset.mode, skills: preset.skills };
  }

  private async validateProject(projectPath: string): Promise<void> {
    try {
      const stats = await this.stat(projectPath);
      if (!stats.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ProjectTaskValidationError('Project directory does not exist');
    }
  }

  private async validateProfileModelAndSkills(task: ProjectTaskRecord): Promise<void> {
    const profiles = await this.options.sessionService.listAgentProfiles();
    if (!profiles.some((profile) => profile.id === task.agentProfileId)) {
      throw new ProjectTaskValidationError(`Agent profile is unavailable: ${task.agentProfileId}`);
    }

    const models = await this.options.sessionService.listAgentProfileModels(task.agentProfileId);
    if (!models.some((model) => model.provider === task.modelProvider && model.id === task.modelId)) {
      throw new ProjectTaskValidationError(`Model is unavailable: ${task.modelProvider}/${task.modelId}`);
    }

    const skills = await this.options.sessionService.listAgentProfileSkills(task.agentProfileId, task.projectPath);
    const availableNames = new Set(skills.map((skill) => skill.name));
    const unavailable = task.skills.filter((skill) => !availableNames.has(skill));
    if (unavailable.length) {
      throw new ProjectTaskValidationError(`Skills are unavailable: ${unavailable.join(', ')}`);
    }
  }
}

function toSessionOptions(task: ProjectTaskRecord, cwd: string): SessionOptions {
  const options: SessionOptions = {
    cwd,
    modelProvider: task.modelProvider,
    modelId: task.modelId,
    skillMode: task.skillMode,
    ...(task.presetId ? { presetId: task.presetId } : {}),
  };
  if (task.skillMode === 'enabled') options.enabledSkills = task.skills;
  if (task.skillMode === 'disabled') options.disabledSkills = task.skills;
  return options;
}
