import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiuiDatabase } from '../db/database';
import { openPiuiDatabase } from '../db/database';
import { ProjectTaskConflictError, ProjectTaskStore, ProjectTaskValidationError } from './project-task-store';
import { ProjectTaskStarter } from './project-task-starter';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    projectPath: '/repo/app',
    title: 'Task',
    prompt: 'Implement it',
    notes: 'private',
    agentProfileId: 'codex',
    modelProvider: 'openai',
    modelId: 'gpt-5.4',
    skillMode: 'enabled' as const,
    skills: ['brainstorming'],
    worktree: { mode: 'none' as const },
    ...overrides,
  };
}

describe('ProjectTaskStarter', () => {
  let db: PiuiDatabase;
  let store: ProjectTaskStore;
  let sessionService: any;
  let worktreeManager: any;
  let worktreeMetadataStore: any;
  let presetStore: any;
  let stat: any;
  let starter: ProjectTaskStarter;

  beforeEach(() => {
    db = openPiuiDatabase(':memory:');
    store = new ProjectTaskStore(db, { createId: () => 'task-1', now: () => '2026-07-14T00:00:00.000Z' });
    sessionService = {
      listAgentProfiles: vi.fn().mockResolvedValue([
        { id: 'codex', label: 'codex', path: '/profiles/codex', isDefault: false },
      ]),
      listAgentProfileModels: vi.fn().mockResolvedValue([
        { provider: 'openai', id: 'gpt-5.4' },
      ]),
      listAgentProfileSkills: vi.fn().mockResolvedValue([
        { name: 'brainstorming', description: 'Design first' },
      ]),
      setClientAgentProfile: vi.fn().mockResolvedValue({ id: 'codex' }),
      createSession: vi.fn().mockResolvedValue({
        session: { sessionId: 'session-1', model: { provider: 'openai', id: 'gpt-5.4' }, thinkingLevel: 'high' },
        skillPolicy: { mode: 'enabled', appliedSkills: ['brainstorming'], ignoredSkills: [] },
      }),
    };
    worktreeManager = {
      resolveSessionCwd: vi.fn().mockImplementation(async (projectPath: string) => ({ cwd: projectPath })),
    };
    worktreeMetadataStore = { save: vi.fn((value) => value) };
    presetStore = { getById: vi.fn().mockReturnValue(null) };
    stat = vi.fn().mockResolvedValue({ isDirectory: () => true });
    starter = new ProjectTaskStarter({ store, sessionService, worktreeManager, worktreeMetadataStore, presetStore, stat });
  });

  afterEach(() => {
    db.close();
  });

  it('validates configuration and starts one linked session', async () => {
    store.create(draft());

    const result = await starter.start('task-1', 'client-1');

    expect(sessionService.listAgentProfileSkills).toHaveBeenCalledWith('codex', '/repo/app');
    expect(sessionService.setClientAgentProfile).toHaveBeenCalledWith('client-1', 'codex');
    expect(worktreeManager.resolveSessionCwd).toHaveBeenCalledWith('/repo/app', { mode: 'none' });
    expect(sessionService.createSession).toHaveBeenCalledWith('client-1', {
      cwd: '/repo/app',
      modelProvider: 'openai',
      modelId: 'gpt-5.4',
      skillMode: 'enabled',
      enabledSkills: ['brainstorming'],
    });
    expect(result).toMatchObject({
      sessionId: 'session-1',
      prompt: 'Implement it',
      task: { status: 'started', sessionId: 'session-1' },
    });
    await expect(starter.start('task-1', 'client-1')).rejects.toBeInstanceOf(ProjectTaskConflictError);
  });

  it('resolves the current preset when starting', async () => {
    store.create(draft({ presetId: 'preset-1', skills: ['old-skill'] }));
    presetStore.getById.mockReturnValue({ id: 'preset-1', mode: 'disabled', skills: ['brainstorming'] });

    await starter.start('task-1', 'client-1');

    expect(sessionService.createSession).toHaveBeenCalledWith('client-1', expect.objectContaining({
      skillMode: 'disabled',
      disabledSkills: ['brainstorming'],
      presetId: 'preset-1',
    }));
  });

  it('uses no skills if a referenced preset no longer exists', async () => {
    store.create(draft({ presetId: 'deleted-preset' }));

    await starter.start('task-1', 'client-1');

    expect(sessionService.createSession).toHaveBeenCalledWith('client-1', expect.objectContaining({
      skillMode: 'enabled',
      enabledSkills: [],
    }));
  });

  it('maps disabled and all skill snapshots to session options', async () => {
    store.create(draft({ skillMode: 'disabled', skills: ['brainstorming'] }));
    await starter.start('task-1', 'client-1');
    expect(sessionService.createSession).toHaveBeenCalledWith('client-1', expect.objectContaining({
      skillMode: 'disabled',
      disabledSkills: ['brainstorming'],
    }));

    db.prepare('DELETE FROM project_tasks').run();
    store.create(draft({ skillMode: 'all', skills: [] }));
    await starter.start('task-1', 'client-1');
    expect(sessionService.createSession).toHaveBeenLastCalledWith('client-1', expect.objectContaining({
      skillMode: 'all',
    }));
  });

  it.each([
    ['missing profile', () => sessionService.listAgentProfiles.mockResolvedValue([])],
    ['missing model', () => sessionService.listAgentProfileModels.mockResolvedValue([])],
    ['missing skill', () => sessionService.listAgentProfileSkills.mockResolvedValue([])],
  ])('restores waiting for %s', async (_name, arrange) => {
    store.create(draft());
    arrange();

    await expect(starter.start('task-1', 'client-1')).rejects.toBeInstanceOf(ProjectTaskValidationError);
    expect(store.get('task-1')?.status).toBe('waiting');
    expect(sessionService.createSession).not.toHaveBeenCalled();
  });

  it('restores waiting when the project is missing', async () => {
    store.create(draft());
    stat.mockResolvedValue({ isDirectory: () => false });

    await expect(starter.start('task-1', 'client-1')).rejects.toThrow('Project directory does not exist');
    expect(store.get('task-1')?.status).toBe('waiting');
  });

  it('restores waiting when worktree or session creation fails', async () => {
    store.create(draft());
    worktreeManager.resolveSessionCwd.mockRejectedValueOnce(new Error('Unknown branch'));
    await expect(starter.start('task-1', 'client-1')).rejects.toThrow('Unknown branch');
    expect(store.get('task-1')?.status).toBe('waiting');

    sessionService.createSession.mockRejectedValueOnce(new Error('Agent unavailable'));
    await expect(starter.start('task-1', 'client-1')).rejects.toThrow('Agent unavailable');
    expect(store.get('task-1')?.status).toBe('waiting');
  });

  it('stores managed worktree metadata with the session', async () => {
    store.create(draft({
      worktree: { mode: 'managed', branchMode: 'new', branchName: 'feature/tasks', baseBranch: 'main' },
    }));
    worktreeManager.resolveSessionCwd.mockResolvedValue({
      cwd: '/repo/.app-worktrees/feature-tasks',
      metadata: {
        baseRepoPath: '/repo/app',
        worktreePath: '/repo/.app-worktrees/feature-tasks',
        branchName: 'feature/tasks',
        branchMode: 'new',
        baseBranch: 'main',
        worktreeManaged: true,
        worktreeStatus: 'active',
      },
    });

    const result = await starter.start('task-1', 'client-1');

    expect(worktreeMetadataStore.save).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      branchName: 'feature/tasks',
    }));
    expect(result.worktree).toMatchObject({ worktreePath: '/repo/.app-worktrees/feature-tasks' });
  });
});
