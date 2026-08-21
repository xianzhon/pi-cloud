import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSessionCwd = vi.fn();
const listLocalBranches = vi.fn();
const getGitStatus = vi.fn();
const removeWorktree = vi.fn();
const pullFastForwardOnly = vi.fn();
const saveWorktreeMetadata = vi.fn();
const getWorktreeMetadata = vi.fn();
const listWorktreeMetadataByBase = vi.fn();
const markWorktreeFinished = vi.fn();
const relocateSessionFile = vi.fn();
const relocateProjectSessionFiles = vi.fn();
const planSessionFileRelocation = vi.fn();
const moveProject = vi.fn();
const resolveMemoryContext = vi.fn();
const relocateMemoryProject = vi.fn();
const clonePreview = vi.fn();
const cloneStart = vi.fn();
const cloneGetJob = vi.fn();
const cloneSubscribe = vi.fn();
const cloneCancel = vi.fn();

function cloneRouteOptions() {
  return {
    repositoryCloner: {
      preview: clonePreview,
      start: cloneStart,
      getJob: cloneGetJob,
      subscribe: cloneSubscribe,
      cancel: cloneCancel,
    },
  };
}

vi.mock('../services/worktree-manager.js', () => ({
  worktreeManager: { resolveSessionCwd, listLocalBranches, getGitStatus, removeWorktree, pullFastForwardOnly },
}));

vi.mock('../services/worktree-metadata-store.js', () => ({
  getWorktreeMetadataStore: () => ({
    save: saveWorktreeMetadata,
    get: getWorktreeMetadata,
    getMany: vi.fn(() => new Map()),
    listByBaseRepoPath: listWorktreeMetadataByBase,
    markFinished: markWorktreeFinished,
  }),
}));

vi.mock('../services/session-file-relocator.js', () => ({
  sessionFileRelocator: {
    relocate: relocateSessionFile,
    relocateProject: relocateProjectSessionFiles,
    plan: planSessionFileRelocation,
  },
}));

vi.mock('../services/project-mover.js', () => ({
  projectMover: { move: moveProject },
}));

vi.mock('../services/session-manager.js', () => ({
  sessionService: {
    listAgentProfiles: vi.fn(),
    listAgentProfileApiKeyProviders: vi.fn(),
    saveAgentProfileApiKey: vi.fn(),
    removeAgentProfileApiKey: vi.fn(),
    getAgentProfileLocalLlm: vi.fn(),
    discoverAgentProfileLocalLlm: vi.fn(),
    saveAgentProfileLocalLlm: vi.fn(),
    removeAgentProfileLocalLlm: vi.fn(),
    getClientAgentProfile: vi.fn(),
    setClientAgentProfile: vi.fn(),
    listSessions: vi.fn(),
    listProjectPaths: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
                listAvailableSkills: vi.fn(),
    listAgentProfileSkills: vi.fn(),
    getAgentProfileAutomationModel: vi.fn(),
    saveAgentProfileAutomationModel: vi.fn(),
    getAgentProfileAutoRenameConfig: vi.fn(),
    saveAgentProfileAutoRenameConfig: vi.fn(),
    checkAgentProfileProxy: vi.fn(),
    getSessionSkillConfiguration: vi.fn(),
    updateSessionSkillPolicy: vi.fn(),
    findPersistedSession: vi.fn(),
    readSessionSnapshot: vi.fn(),
    readSessionRuntimeStatus: vi.fn(),
    getRuntimeStatus: vi.fn(),
    getSkillPolicy: vi.fn(),
    getSessionCommandInfo: vi.fn(),
    withActiveSession: vi.fn(),
    runWithClientProfileProxy: vi.fn(async (_clientId: string, fn: Function) => fn()),
    getAllSessions: vi.fn(() => new Map()),
    getSession: vi.fn(),
    isSessionStreaming: vi.fn(() => false),
    isCwdStreaming: vi.fn(() => false),
    forceDisposeBySessionId: vi.fn(),
    forceDisposeByCwd: vi.fn(),
    deleteSessionFiles: vi.fn(),
    deleteSkillPolicy: vi.fn(),
    deleteSessionMetadata: vi.fn(),
    getClientAgentDirForRoutes: vi.fn(),
    getProjectSessionDirForPath: vi.fn(),
    invalidateSessionListCache: vi.fn(),
  },
}));

import { sessionService } from '../services/session-manager.js';

function createMockApp() {
  const handlers: Record<string, Function> = {};
  const app = {
    get: vi.fn((path: string, handler: Function) => { handlers[`GET ${path}`] = handler; }),
    post: vi.fn((path: string, handler: Function) => { handlers[`POST ${path}`] = handler; }),
    patch: vi.fn((path: string, handler: Function) => { handlers[`PATCH ${path}`] = handler; }),
    put: vi.fn((path: string, handler: Function) => { handlers[`PUT ${path}`] = handler; }),
    delete: vi.fn((path: string, handler: Function) => { handlers[`DELETE ${path}`] = handler; }),
    authServices: { audit: { record: vi.fn() } },
    memoryRuntime: {
      service: { resolveContext: resolveMemoryContext },
      relocateProject: relocateMemoryProject,
    },
  };

  return { app, handlers };
}

describe('session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionService.getAllSessions).mockReturnValue(new Map());
    vi.mocked(sessionService.getSession).mockReturnValue(undefined);
    vi.mocked(sessionService.isSessionStreaming).mockReturnValue(false);
        vi.mocked((sessionService as any).isCwdStreaming).mockReturnValue(false);
    vi.mocked((sessionService as any).withActiveSession).mockReset();
    vi.mocked((sessionService as any).runWithClientProfileProxy).mockImplementation(async (_clientId: string, fn: Function) => fn());
    resolveSessionCwd.mockReset();
    resolveSessionCwd.mockImplementation(async (cwd: string) => ({ cwd }));
    listLocalBranches.mockReset();
    getGitStatus.mockReset();
    removeWorktree.mockReset();
    saveWorktreeMetadata.mockReset();
    getWorktreeMetadata.mockReset();
    getWorktreeMetadata.mockReturnValue(null);
    listWorktreeMetadataByBase.mockReset();
    listWorktreeMetadataByBase.mockReturnValue([]);
    markWorktreeFinished.mockReset();
    relocateSessionFile.mockReset();
    relocateProjectSessionFiles.mockReset();
    relocateProjectSessionFiles.mockResolvedValue({ moved: 0, skipped: 0, conflicts: [] });
    planSessionFileRelocation.mockReset();
    moveProject.mockReset();
    resolveMemoryContext.mockReset();
    relocateMemoryProject.mockReset();
    clonePreview.mockReset();
    cloneStart.mockReset();
    cloneGetJob.mockReset();
    cloneSubscribe.mockReset();
    cloneCancel.mockReset();
    vi.mocked(sessionService.getClientAgentProfile).mockResolvedValue({
      id: 'default', label: 'default', path: '/Users/test/.pi/agent', isDefault: true,
    });
    resolveMemoryContext.mockResolvedValue({ project: { id: 'memory-project-1' } });
  });

  it('returns discovered agent profiles', async () => {
    vi.mocked(sessionService.listAgentProfiles).mockResolvedValue([
      { id: 'default', label: 'default', path: '/Users/test/.pi/agent', isDefault: true },
      { id: 'work', label: 'work', path: '/Users/test/.pi/work', isDefault: false },
    ]);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /agent-profiles']();

    expect(result).toEqual({
      profiles: [
        { id: 'default', label: 'default', path: '/Users/test/.pi/agent', isDefault: true },
        { id: 'work', label: 'work', path: '/Users/test/.pi/work', isDefault: false },
      ],
    });
  });

  it('saves an agent profile API key', async () => {
    vi.mocked((sessionService as any).saveAgentProfileApiKey).mockResolvedValue([
      { envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', configured: true, source: 'stored' },
    ]);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['PUT /agent-profiles/:profileId/api-key']({
      params: { profileId: 'work' },
      body: { envVar: 'OPENAI_API_KEY', apiKey: 'secret-key' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.saveAgentProfileApiKey).toHaveBeenCalledWith('work', 'OPENAI_API_KEY', 'secret-key');
    expect(result).toEqual({
      providers: [{ envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', configured: true, source: 'stored' }],
    });
  });

  it('removes an agent profile API key', async () => {
    vi.mocked((sessionService as any).removeAgentProfileApiKey).mockResolvedValue([
      { envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', configured: false },
    ]);
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['DELETE /agent-profiles/:profileId/api-key/:envVar']({
      params: { profileId: 'work', envVar: 'OPENAI_API_KEY' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.removeAgentProfileApiKey).toHaveBeenCalledWith('work', 'OPENAI_API_KEY');
    expect(result.providers[0].configured).toBe(false);
  });

  it('discovers, saves, and removes local LLM models', async () => {
    vi.mocked((sessionService as any).discoverAgentProfileLocalLlm).mockResolvedValue([{ id: 'qwen3:8b' }]);
    vi.mocked((sessionService as any).saveAgentProfileLocalLlm).mockResolvedValue({
      baseUrl: 'http://127.0.0.1:11434/v1', modelIds: ['qwen3:8b'],
    });
    vi.mocked((sessionService as any).removeAgentProfileLocalLlm).mockResolvedValue({ baseUrl: '', modelIds: [] });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

    const discovered = await handlers['POST /agent-profiles/:profileId/local-llm/discover']({
      params: { profileId: 'work' }, body: { baseUrl: 'http://127.0.0.1:11434/v1' },
    }, reply);
    const saved = await handlers['PUT /agent-profiles/:profileId/local-llm']({
      params: { profileId: 'work' }, body: { baseUrl: 'http://127.0.0.1:11434/v1', modelIds: ['qwen3:8b'] },
    }, reply);
    const removed = await handlers['DELETE /agent-profiles/:profileId/local-llm']({
      params: { profileId: 'work' },
    }, reply);

    expect(discovered).toEqual({ models: [{ id: 'qwen3:8b' }] });
    expect(saved).toEqual({ config: { baseUrl: 'http://127.0.0.1:11434/v1', modelIds: ['qwen3:8b'] } });
    expect(removed).toEqual({ config: { baseUrl: '', modelIds: [] } });
  });

  it('checks agent profile proxy settings', async () => {
    vi.mocked((sessionService as any).checkAgentProfileProxy).mockResolvedValue({ ok: true });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /agent-profiles/:profileId/proxy/check']({
      params: { profileId: 'work' },
      body: { proxy: { HTTPS_PROXY: 'http://proxy' } },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.checkAgentProfileProxy).toHaveBeenCalledWith('work', { HTTPS_PROXY: 'http://proxy' });
    expect(result).toEqual({ ok: true });
  });

  it('returns agent profile automation model', async () => {
    vi.mocked((sessionService as any).getAgentProfileAutomationModel).mockResolvedValue({
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5',
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /agent-profiles/:profileId/automation-model']({
      params: { profileId: 'work' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.getAgentProfileAutomationModel).toHaveBeenCalledWith('work');
    expect(result).toEqual({ model: { provider: 'anthropic', modelId: 'claude-haiku-4-5' } });
  });

  it('saves agent profile automation model', async () => {
    vi.mocked((sessionService as any).saveAgentProfileAutomationModel).mockResolvedValue({
      provider: 'openai',
      modelId: 'gpt-5',
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['PUT /agent-profiles/:profileId/automation-model']({
      params: { profileId: 'work' },
      body: { provider: 'openai', modelId: 'gpt-5' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.saveAgentProfileAutomationModel).toHaveBeenCalledWith('work', 'openai', 'gpt-5');
    expect(result).toEqual({ model: { provider: 'openai', modelId: 'gpt-5' } });
  });

  it('returns agent profile auto-rename config', async () => {
    vi.mocked((sessionService as any).getAgentProfileAutoRenameConfig).mockResolvedValue({
      language: 'english',
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /agent-profiles/:profileId/auto-rename']({
      params: { profileId: 'work' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.getAgentProfileAutoRenameConfig).toHaveBeenCalledWith('work');
    expect(result).toEqual({
      config: { language: 'english' },
    });
  });

  it('saves agent profile auto-rename config', async () => {
    vi.mocked((sessionService as any).saveAgentProfileAutoRenameConfig).mockResolvedValue({
      language: 'chinese',
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['PUT /agent-profiles/:profileId/auto-rename']({
      params: { profileId: 'work' },
      body: { language: 'chinese' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.saveAgentProfileAutoRenameConfig).toHaveBeenCalledWith('work', {
      language: 'chinese',
    });
    expect(result).toEqual({
      config: { language: 'chinese' },
    });
  });

  it('stores the selected client agent profile', async () => {
    vi.mocked(sessionService.setClientAgentProfile).mockResolvedValue({
      id: 'work',
      label: 'work',
      path: '/Users/test/.pi/work',
      isDefault: false,
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /agent-profile']({
      body: { clientId: 'client-1', profileId: 'work' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.setClientAgentProfile).toHaveBeenCalledWith('client-1', 'work');
    expect(result).toEqual({
      profile: {
        id: 'work',
        label: 'work',
        path: '/Users/test/.pi/work',
        isDefault: false,
      },
    });
  });

  it('relocates captured project memory after a project move and session relocation succeed', async () => {
    vi.mocked(sessionService.getClientAgentProfile).mockResolvedValue({
      id: 'default', label: 'default', path: '/Users/test/.pi/agent', isDefault: true,
    });
    vi.mocked((sessionService as any).getClientAgentDirForRoutes).mockResolvedValue('/Users/test/.pi/agent');
    vi.mocked((sessionService as any).getProjectSessionDirForPath).mockImplementation((cwd: string) => `/sessions/${cwd.split('/').pop()}`);
    moveProject.mockResolvedValue({ projectPath: '/dest/app-renamed' });
    relocateProjectSessionFiles.mockResolvedValue({ moved: 2, skipped: 1, conflicts: [] });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /move-project']({
      body: {
        clientId: 'client-1', oldProjectPath: '/repo/app',
        destinationParentPath: '/dest', newProjectName: 'app-renamed',
      },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(resolveMemoryContext).toHaveBeenCalledWith({ profileId: 'default', cwd: '/repo/app' });
    expect(resolveMemoryContext.mock.invocationCallOrder[0]).toBeLessThan(moveProject.mock.invocationCallOrder[0]);
    expect(relocateMemoryProject).toHaveBeenCalledWith('memory-project-1', '/dest/app-renamed');
    expect(relocateProjectSessionFiles.mock.invocationCallOrder[0])
      .toBeLessThan(relocateMemoryProject.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ success: true, projectPath: '/dest/app-renamed', movedSessions: 2 });
  });

  it('does not relocate project memory when session relocation fails', async () => {
    vi.mocked(sessionService.getClientAgentProfile).mockResolvedValue({
      id: 'default', label: 'default', path: '/Users/test/.pi/agent', isDefault: true,
    });
    vi.mocked((sessionService as any).getClientAgentDirForRoutes).mockResolvedValue('/Users/test/.pi/agent');
    vi.mocked((sessionService as any).getProjectSessionDirForPath).mockReturnValue('/sessions/project');
    moveProject.mockResolvedValue({ projectPath: '/dest/app-renamed' });
    relocateProjectSessionFiles.mockRejectedValue(new Error('session relocation failed'));
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

    await handlers['POST /move-project']({
      body: {
        clientId: 'client-1', oldProjectPath: '/repo/app',
        destinationParentPath: '/dest', newProjectName: 'app-renamed',
      },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(relocateMemoryProject).not.toHaveBeenCalled();
  });

  it('relocates project memory once after session-history relocation succeeds', async () => {
    vi.mocked(sessionService.getClientAgentProfile).mockResolvedValue({
      id: 'default', label: 'default', path: '/Users/test/.pi/agent', isDefault: true,
    });
    vi.mocked((sessionService as any).getClientAgentDirForRoutes).mockResolvedValue('/Users/test/.pi/agent');
    vi.mocked((sessionService as any).getProjectSessionDirForPath).mockReturnValue('/sessions/project');
    relocateProjectSessionFiles.mockResolvedValue({ moved: 1, skipped: 0, conflicts: [] });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /relocate-project']({
      body: { clientId: 'client-1', oldProjectPath: '/repo/app', newProjectPath: '/repo/app-moved' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(resolveMemoryContext).toHaveBeenCalledWith({ profileId: 'default', cwd: '/repo/app' });
    expect(relocateMemoryProject).toHaveBeenCalledTimes(1);
    expect(relocateMemoryProject).toHaveBeenCalledWith('memory-project-1', '/repo/app-moved');
    expect(result).toEqual({ success: true, moved: 1, skipped: 0 });
  });

  it('moves one persisted session to another project folder', async () => {
    vi.mocked(sessionService.findPersistedSession).mockResolvedValue({
      id: 'session-1',
      path: '/profiles/default/sessions/old/session-1.jsonl',
      cwd: '/repo/old',
    } as any);
    vi.mocked(sessionService.getClientAgentDirForRoutes).mockResolvedValue('/profiles/default');
    vi.mocked(sessionService.getProjectSessionDirForPath).mockReturnValue('/profiles/default/sessions/new');
    relocateSessionFile.mockResolvedValue({
      sourcePath: '/profiles/default/sessions/old/session-1.jsonl',
      destinationPath: '/profiles/default/sessions/new/session-1.jsonl',
      relocated: true,
    });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /:id/relocate']({
      params: { id: 'session-1' },
      body: { clientId: 'client-1', newProjectPath: '/repo/new' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.forceDisposeBySessionId).toHaveBeenCalledWith('session-1');
    expect(relocateSessionFile).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceSessionDir: '/profiles/default/sessions/old',
      destinationSessionDir: '/profiles/default/sessions/new',
      expectedOldCwd: '/repo/old',
      newCwd: '/repo/new',
    });
    expect(sessionService.invalidateSessionListCache).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      path: '/profiles/default/sessions/new/session-1.jsonl',
      cwd: '/repo/new',
    });
  });

  it('loads project paths from the active client profile store', async () => {
    vi.mocked(sessionService.listProjectPaths).mockResolvedValue(['/workspace/app', '/workspace/api', '/session/storage/4']);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /project-paths']({ query: { clientId: 'client-1' } });

    expect(sessionService.listProjectPaths).toHaveBeenCalledWith('client-1');
    expect(result).toEqual({ projectPaths: ['/workspace/app', '/workspace/api', '/session/storage/4'] });
  });

  it('uses the base repo path for managed worktree sessions in project path options', async () => {
    vi.mocked(sessionService.listProjectPaths).mockResolvedValue(['/repo/app']);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /project-paths']({ query: { clientId: 'client-1' } });

    expect(result).toEqual({ projectPaths: ['/repo/app'] });
  });

  it('includes projects that currently have tasks but no sessions', async () => {
    vi.mocked(sessionService.listProjectPaths).mockResolvedValue(['/repo/from-session']);
    const projectTaskStore = {
      listProjectPaths: vi.fn(() => ['/repo/from-session', '/repo/task-only']),
      replaceProjectPath: vi.fn(),
    };
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any, { projectTaskStore } as any);

    const result = await handlers['GET /project-paths']({ query: { clientId: 'client-1' } });

    expect(result).toEqual({ projectPaths: ['/repo/from-session', '/repo/task-only'] });
  });

  it('lists project skills for an explicit agent profile', async () => {
    vi.mocked(sessionService.listAgentProfileSkills).mockResolvedValue([
      { name: 'brainstorming', description: 'Design first' },
    ] as any);
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /agent-profiles/:profileId/skills']({
      params: { profileId: 'codex' },
      query: { projectPath: '/repo/app' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.listAgentProfileSkills).toHaveBeenCalledWith('codex', '/repo/app');
    expect(result).toEqual({ skills: [{ name: 'brainstorming', description: 'Design first' }] });
  });

  it('updates task paths after moving a project', async () => {
    vi.mocked(sessionService.getClientAgentDirForRoutes).mockResolvedValue('/profiles/codex');
    vi.mocked(sessionService.getProjectSessionDirForPath).mockImplementation((cwd: string) => `/sessions${cwd}`);
    moveProject.mockResolvedValue({ projectPath: '/repo/new-app' });
    relocateProjectSessionFiles.mockResolvedValue({ moved: 2, skipped: 0, conflicts: [] });
    const projectTaskStore = { listProjectPaths: vi.fn(() => []), replaceProjectPath: vi.fn(() => 2) };
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any, { projectTaskStore } as any);

    const result = await handlers['POST /move-project']({ body: {
      clientId: 'client-1',
      oldProjectPath: '/repo/app',
      destinationParentPath: '/repo',
      newProjectName: 'new-app',
    } }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(projectTaskStore.replaceProjectPath).toHaveBeenCalledWith('/repo/app', '/repo/new-app');
    expect(result).toMatchObject({ success: true, projectPath: '/repo/new-app' });
  });

  it('updates task paths after relocating project sessions', async () => {
    vi.mocked(sessionService.getClientAgentDirForRoutes).mockResolvedValue('/profiles/codex');
    vi.mocked(sessionService.getProjectSessionDirForPath).mockImplementation((cwd: string) => `/sessions${cwd}`);
    const projectTaskStore = { listProjectPaths: vi.fn(() => []), replaceProjectPath: vi.fn(() => 1) };
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any, { projectTaskStore } as any);

    const result = await handlers['POST /relocate-project']({ body: {
      clientId: 'client-1', oldProjectPath: '/repo/app', newProjectPath: '/repo/new-app',
    } }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(projectTaskStore.replaceProjectPath).toHaveBeenCalledWith('/repo/app', '/repo/new-app');
    expect(result).toMatchObject({ success: true });
  });

  it('creates a session in a resolved managed worktree cwd and stores metadata', async () => {
    resolveSessionCwd.mockResolvedValue({
      cwd: '/repo/.app-worktrees/feature-a',
      metadata: {
        baseRepoPath: '/repo/app',
        worktreePath: '/repo/.app-worktrees/feature-a',
        branchName: 'feature/a',
        branchMode: 'new',
        baseBranch: 'main',
        worktreeManaged: true,
        worktreeStatus: 'active',
      },
    });
    vi.mocked(sessionService.createSession).mockResolvedValue({
      session: { sessionId: 'session-1', model: 'claude', thinkingLevel: 'high' },
      skillPolicy: { mode: 'all', appliedSkills: [], ignoredSkills: [], presetId: null },
    } as any);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /']({
      body: {
        clientId: 'client-1',
        cwd: '/repo/app',
        worktree: { mode: 'managed', branchMode: 'new', branchName: 'feature/a', baseBranch: 'main' },
      },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(resolveSessionCwd).toHaveBeenCalledWith('/repo/app', { mode: 'managed', branchMode: 'new', branchName: 'feature/a', baseBranch: 'main' });
    expect(sessionService.createSession).toHaveBeenCalledWith('client-1', expect.objectContaining({ cwd: '/repo/.app-worktrees/feature-a' }));
    expect(saveWorktreeMetadata).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', branchName: 'feature/a' }));
    expect(result).toMatchObject({ success: true, sessionId: 'session-1', worktree: { branchName: 'feature/a' } });
  });

  it('returns local branches for a project path', async () => {
    listLocalBranches.mockResolvedValue(['main', 'feature/a']);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /worktree-branches']({ query: { clientId: 'client-1', projectPath: '/repo/app' } });

    expect(listLocalBranches).toHaveBeenCalledWith('/repo/app');
    expect(result).toEqual({ branches: ['main', 'feature/a'] });
  });

  it('returns git status for a project path', async () => {
    getGitStatus.mockResolvedValue({ isGitRepo: true, branch: 'feature/a', detached: false });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /git-status']({ query: { clientId: 'client-1', projectPath: '/repo/app' } });

    expect(getGitStatus).toHaveBeenCalledWith('/repo/app');
    expect(result).toEqual({ isGitRepo: true, branch: 'feature/a', detached: false });
  });

  it('previews managed worktree finish cleanup targets', async () => {
    getWorktreeMetadata.mockReturnValue({
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });
    vi.mocked((sessionService as any).getClientAgentDirForRoutes).mockResolvedValue('/Users/test/.pi/agent');
    vi.mocked((sessionService as any).getProjectSessionDirForPath).mockImplementation((cwd: string) => `/sessions/${cwd.includes('worktrees') ? 'worktree' : 'base'}`);
    planSessionFileRelocation.mockResolvedValue({
      sourcePath: '/sessions/worktree/timestamp_session-1.jsonl',
      destinationPath: '/sessions/base/timestamp_session-1.jsonl',
      sourceExists: true,
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /:id/finish-worktree-preview']({
      query: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(planSessionFileRelocation).toHaveBeenCalledWith(expect.objectContaining({ expectedOldCwd: '/repo/.app-worktrees/feature-a', newCwd: '/repo/app' }));
    expect(result).toEqual({
      worktreePath: '/repo/.app-worktrees/feature-a',
      baseRepoPath: '/repo/app',
      history: {
        sourcePath: '/sessions/worktree/timestamp_session-1.jsonl',
        destinationPath: '/sessions/base/timestamp_session-1.jsonl',
        sourceExists: true,
      },
    });
  });

  it('finishes a managed worktree session by relocating history and removing the worktree', async () => {
    getWorktreeMetadata.mockReturnValue({
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    });
    vi.mocked(sessionService.isSessionStreaming).mockReturnValue(false);
    vi.mocked((sessionService as any).getClientAgentDirForRoutes).mockResolvedValue('/Users/test/.pi/agent');
    vi.mocked((sessionService as any).getProjectSessionDirForPath).mockImplementation((cwd: string) => `/sessions/${cwd.includes('worktrees') ? 'worktree' : 'base'}`);
    relocateSessionFile.mockResolvedValue({ destinationPath: '/sessions/base/session-1.jsonl' });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /:id/finish-worktree']({
      body: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.forceDisposeBySessionId).toHaveBeenCalledWith('session-1');
    expect(relocateSessionFile).toHaveBeenCalledWith(expect.objectContaining({ expectedOldCwd: '/repo/.app-worktrees/feature-a', newCwd: '/repo/app' }));
    expect(removeWorktree).toHaveBeenCalledWith('/repo/app', '/repo/.app-worktrees/feature-a');
    expect(pullFastForwardOnly).toHaveBeenCalledWith('/repo/app');
    expect(markWorktreeFinished).toHaveBeenCalledWith('session-1');
    expect(result).toEqual({ success: true });
  });

  it('includes managed worktree sessions in the base project session list', async () => {
    vi.mocked(sessionService.listSessions).mockImplementation(async (_clientId: string, projectPath?: string) => {
      if (projectPath === '/repo/app') return [];
      if (projectPath === '/repo/.app-worktrees/feature-a') return [
        { id: 'session-1', path: '/sessions/worktree/session-1.jsonl', cwd: '/repo/.app-worktrees/feature-a', created: '', modified: '', messageCount: 0 },
      ];
      return [];
    });
    vi.mocked(sessionService.isSessionStreaming).mockReturnValue(false);
    listWorktreeMetadataByBase.mockReturnValue([{ worktreePath: '/repo/.app-worktrees/feature-a' }]);
    getWorktreeMetadata.mockImplementation((id: string) => id === 'session-1' ? {
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    } : null);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /']({ query: { clientId: 'client-1', projectPath: '/repo/app', scope: 'project' } });

    expect(sessionService.listSessions).toHaveBeenCalledWith('client-1', '/repo/app');
    expect(sessionService.listSessions).toHaveBeenCalledWith('client-1', '/repo/.app-worktrees/feature-a');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      id: 'session-1',
      cwd: '/repo/.app-worktrees/feature-a',
      worktree: { baseRepoPath: '/repo/app', branchName: 'feature/a' },
    });
  });

  it('returns base project sessions when worktree metadata lookup fails', async () => {
    vi.mocked(sessionService.listSessions).mockResolvedValue([
      { id: 'session-1', path: '/sessions/base/session-1.jsonl', cwd: '/repo/app', created: '', modified: '', messageCount: 0 },
    ]);
    vi.mocked(sessionService.isSessionStreaming).mockReturnValue(false);
    listWorktreeMetadataByBase.mockImplementation(() => { throw new Error('metadata unavailable'); });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /']({ query: { clientId: 'client-1', projectPath: '/repo/app', scope: 'project' } });

    expect(sessionService.listSessions).toHaveBeenCalledWith('client-1', '/repo/app');
    expect(result.sessions).toEqual([
      expect.objectContaining({ id: 'session-1', cwd: '/repo/app' }),
    ]);
  });

  it('paginates session list items after applying the project filter', async () => {
    vi.mocked(sessionService.listSessions).mockResolvedValue([
      { id: 'session-3', path: '/sessions/3.jsonl', cwd: '/repo/app', created: '2026-07-03T00:00:00.000Z', modified: '2026-07-03T00:00:00.000Z', messageCount: 1 },
      { id: 'session-2', path: '/sessions/2.jsonl', cwd: '/repo/other', created: '2026-07-02T00:00:00.000Z', modified: '2026-07-02T00:00:00.000Z', messageCount: 1 },
      { id: 'session-1', path: '/sessions/1.jsonl', cwd: '/repo/app', created: '2026-07-01T00:00:00.000Z', modified: '2026-07-01T00:00:00.000Z', messageCount: 1 },
    ]);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const firstPage = await handlers['GET /']({
      query: { clientId: 'client-1', projectPath: '/repo/app', scope: 'project', offset: '0', limit: '1' },
    });
    const secondPage = await handlers['GET /']({
      query: { clientId: 'client-1', projectPath: '/repo/app', scope: 'project', offset: '1', limit: '1' },
    });

    expect(firstPage).toMatchObject({ sessions: [{ id: 'session-3' }], hasMore: true, nextOffset: 1 });
    expect(secondPage).toMatchObject({ sessions: [{ id: 'session-1' }], hasMore: false, nextOffset: 2 });
  });

  it('decorates session list items with worktree metadata', async () => {
    vi.mocked(sessionService.listSessions).mockResolvedValue([
      { id: 'session-1', path: '/sessions/session-1.jsonl', cwd: '/repo/.app-worktrees/feature-a', created: '', modified: '', messageCount: 0 },
    ]);
    vi.mocked(sessionService.isSessionStreaming).mockReturnValue(false);
    getWorktreeMetadata.mockImplementation((id: string) => id === 'session-1' ? {
      sessionId: 'session-1',
      baseRepoPath: '/repo/app',
      worktreePath: '/repo/.app-worktrees/feature-a',
      branchName: 'feature/a',
      branchMode: 'new',
      baseBranch: 'main',
      worktreeManaged: true,
      worktreeStatus: 'active',
    } : null);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /']({ query: { clientId: 'client-1', projectPath: '/repo/app' } });

    expect(result.sessions[0]).toMatchObject({
      id: 'session-1',
      worktree: { branchName: 'feature/a', worktreeStatus: 'active' },
    });
  });

  it('returns session command info', async () => {
    vi.mocked((sessionService as any).getSessionCommandInfo).mockResolvedValue({
      name: 'Support Rename Session Name-重命名',
      workDir: '/Users/test/repo',
      model: { provider: 'anthropic', id: 'claude-sonnet-4' },
      stats: {
        sessionFile: '/Users/test/.pi/agent/sessions/repo/session.jsonl',
        sessionId: 'session-1',
        userMessages: 2,
        assistantMessages: 57,
        toolCalls: 63,
        toolResults: 63,
        totalMessages: 122,
        tokens: { input: 157368, output: 13335, cacheRead: 2150336, cacheWrite: 0, total: 2321039 },
        cost: 0.2616,
      },
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /:id/info']({
      query: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.getSessionCommandInfo).toHaveBeenCalledWith('client-1', 'session-1');
    expect(result).toEqual(expect.objectContaining({
      name: 'Support Rename Session Name-重命名',
      workDir: '/Users/test/repo',
      model: { provider: 'anthropic', id: 'claude-sonnet-4' },
    }));
  });

  it('returns session skill configuration', async () => {
    vi.mocked((sessionService as any).getSessionSkillConfiguration).mockResolvedValue({
      skills: [{ name: 'feature-dev', description: 'Feature workflow' }],
      policy: { mode: 'disabled', appliedSkills: ['feature-dev'], ignoredSkills: [] },
      availableSkillNames: [],
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /:id/skills']({
      query: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.getSessionSkillConfiguration).toHaveBeenCalledWith('client-1', 'session-1');
    expect(result).toEqual(expect.objectContaining({
      policy: { mode: 'disabled', appliedSkills: ['feature-dev'], ignoredSkills: [] },
      availableSkillNames: [],
    }));
  });

  it('updates session skill configuration', async () => {
    vi.mocked((sessionService as any).updateSessionSkillPolicy).mockResolvedValue({
      policy: { mode: 'enabled', appliedSkills: ['feature-dev'], ignoredSkills: [] },
      availableSkillNames: ['feature-dev'],
    });

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['PUT /:id/skills']({
      body: { clientId: 'client-1', mode: 'enabled', skills: ['feature-dev'] },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.updateSessionSkillPolicy).toHaveBeenCalledWith('client-1', 'session-1', 'enabled', ['feature-dev']);
    expect(result).toEqual(expect.objectContaining({
      policy: { mode: 'enabled', appliedSkills: ['feature-dev'], ignoredSkills: [] },
      availableSkillNames: ['feature-dev'],
    }));
  });

  it('returns the session tree for a session', async () => {
    const tree = [{ entry: { id: 'entry-1', parentId: null, type: 'message', timestamp: 'now', message: { role: 'user', content: 'Hello' } }, children: [] }];
    vi.mocked((sessionService as any).withActiveSession).mockImplementation(async (_clientId: string, _sessionId: string, fn: Function) => fn({
      sessionId: 'session-1',
      sessionManager: {
        getLeafId: () => 'entry-1',
        getTree: () => tree,
      },
    }));

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /:id/tree']({
      query: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(sessionService.withActiveSession).toHaveBeenCalledWith('client-1', 'session-1', expect.any(Function));
    expect(result).toEqual({ sessionId: 'session-1', leafId: 'entry-1', tree });
  });

  it('limits session tree entry count and message preview size', async () => {
    const oversizedTree = Array.from({ length: 1_001 }, (_, index) => ({ entry: { id: `entry-${index}` }, children: [] }));
    const getTree = vi.fn((): any[] => oversizedTree);
    vi.mocked((sessionService as any).withActiveSession).mockImplementation(async (_clientId: string, _sessionId: string, fn: Function) => fn({
      sessionId: 'session-1',
      sessionManager: { getLeafId: () => 'entry-1000', getTree },
    }));

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /:id/tree']({
      query: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(result).toMatchObject({ sessionId: 'session-1', oversized: true, tree: [] });
    expect(result.message).toContain('too large to display safely');

    const longContent = 'x'.repeat(1_000);
    getTree.mockReturnValueOnce([{ entry: { id: 'entry-1', message: { role: 'user', content: longContent } }, children: [] }]);
    const limitedResult = await handlers['GET /:id/tree']({
      query: { clientId: 'client-1' },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });
    expect(limitedResult.tree[0].entry.message.content).toHaveLength(500);
  });

  it('navigates the session tree', async () => {
    const navigateTree = vi.fn().mockResolvedValue({ cancelled: false, editorText: 'retry this' });
    vi.mocked((sessionService as any).withActiveSession).mockImplementation(async (_clientId: string, _sessionId: string, fn: Function) => fn({
      navigateTree,
    }));

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['POST /:id/tree/navigate']({
      body: { clientId: 'client-1', targetId: 'entry-1', summarize: true },
      params: { id: 'session-1' },
    }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(navigateTree).toHaveBeenCalledWith('entry-1', {
      summarize: true,
      customInstructions: undefined,
      replaceInstructions: undefined,
      label: undefined,
    });
    expect(result).toEqual({ cancelled: false, editorText: 'retry this' });
  });

  it('returns 400 when both enabledSkills and disabledSkills are provided', async () => {
    vi.mocked(sessionService.createSession).mockResolvedValue({
      session: { sessionId: 'session-1', model: 'claude', thinkingLevel: 'high' },
      skillPolicy: { mode: 'all', appliedSkills: [], ignoredSkills: [], presetId: null },
    } as any);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await handlers['POST /']({
      body: {
        clientId: 'client-1',
        enabledSkills: ['brainstorming'],
        disabledSkills: ['frontend-design'],
      },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Provide either enabledSkills or disabledSkills, not both' });
  });

  it('returns available skills for the selected client profile', async () => {
    vi.mocked(sessionService.listAvailableSkills).mockResolvedValue([
      { name: 'brainstorming', description: 'Use before creative work' },
    ] as any);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const result = await handlers['GET /skills']({ query: { clientId: 'client-1', projectPath: '/repo/app' } });

    expect(sessionService.listAvailableSkills).toHaveBeenCalledWith('client-1', '/repo/app');
    expect(result).toEqual({ skills: [{ name: 'brainstorming', description: 'Use before creative work' }] });
  });

  it('deletes an existing session within the active client profile store', async () => {
    vi.mocked(sessionService.findPersistedSession).mockResolvedValue({
      id: 'session-1',
      name: 'Test Session',
      path: '/tmp/sessions/session-1',
      created: '',
      modified: '',
      messageCount: 0,
    });
    vi.mocked(sessionService.deleteSessionFiles).mockResolvedValue(undefined);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const mockReply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    const result = await handlers['DELETE /:id']({ query: { clientId: 'client-1' }, params: { id: 'session-1' } }, mockReply);

    expect(result).toEqual({ success: true });
    expect(sessionService.findPersistedSession).toHaveBeenCalledWith('client-1', 'session-1');
    expect(sessionService.forceDisposeBySessionId).toHaveBeenCalledWith('session-1');
    expect(sessionService.deleteSessionFiles).toHaveBeenCalledWith('/tmp/sessions/session-1');
    expect(sessionService.deleteSessionMetadata).toHaveBeenCalledWith('session-1');
  });

  it('returns 404 when deleting a missing session in the active client profile store', async () => {
    vi.mocked(sessionService.findPersistedSession).mockResolvedValue(undefined);

    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any);

    const mockReply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await handlers['DELETE /:id']({ query: { clientId: 'client-1' }, params: { id: 'missing' } }, mockReply);

    expect(mockReply.status).toHaveBeenCalledWith(404);
    expect(mockReply.send).toHaveBeenCalledWith({ error: 'Session not found' });
  });

  it('previews repository clone destinations', async () => {
    clonePreview.mockReturnValue({ remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, owner: 'acme', repo: 'tool', suggestedPath: '/Users/test/git/github/acme/tool' });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any, cloneRouteOptions() as any);

    const result = await handlers['POST /clone-repository/preview']({ body: { remoteUrl: 'https://github.com/acme/tool.git' } }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(clonePreview).toHaveBeenCalledWith({ remoteUrl: 'https://github.com/acme/tool.git' });
    expect(result).toEqual({ preview: { remoteUrl: 'https://github.com/acme/tool.git', isGithub: true, owner: 'acme', repo: 'tool', suggestedPath: '/Users/test/git/github/acme/tool' } });
  });

  it('returns destination_exists when starting clone into an existing path', async () => {
    cloneStart.mockResolvedValue({ status: 'destination_exists', existingPath: '/Users/test/git/github/acme/tool' });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await sessionRoutes(app as any, cloneRouteOptions() as any);

    await handlers['POST /clone-repository']({ body: { clientId: 'client-1', remoteUrl: 'https://github.com/acme/tool.git', destinationPath: '/Users/test/git/github/acme/tool', shallow: true } }, reply);

    expect(cloneStart).toHaveBeenCalledWith({ clientId: 'client-1', remoteUrl: 'https://github.com/acme/tool.git', destinationPath: '/Users/test/git/github/acme/tool', shallow: true });
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({ status: 'destination_exists', existingPath: '/Users/test/git/github/acme/tool' });
  });

  it('cancels clone jobs', async () => {
    cloneCancel.mockResolvedValue({ id: 'clone_1', status: 'canceled', destinationPath: '/repo', latest: { type: 'canceled', status: 'Clone canceled' } });
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any, cloneRouteOptions() as any);

    const result = await handlers['POST /clone-repository/:jobId/cancel']({ params: { jobId: 'clone_1' } }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(cloneCancel).toHaveBeenCalledWith('clone_1');
    expect(result).toEqual({ job: { id: 'clone_1', status: 'canceled', destinationPath: '/repo', latest: { type: 'canceled', status: 'Clone canceled' } } });
  });

  it('streams clone job events as SSE', async () => {
    const unsubscribe = vi.fn();
    cloneGetJob.mockReturnValue({ id: 'clone_1', status: 'running', destinationPath: '/repo', latest: { type: 'progress', status: 'Starting clone…' } });
    cloneSubscribe.mockImplementation((_id: string, listener: Function) => {
      listener({ type: 'progress', status: 'Receiving objects…', percent: 50 });
      return unsubscribe;
    });
    const raw = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), on: vi.fn() };
    const { sessionRoutes } = await import('./sessions.js');
    const { app, handlers } = createMockApp();
    await sessionRoutes(app as any, cloneRouteOptions() as any);

    await handlers['GET /clone-repository/:jobId/events']({ params: { jobId: 'clone_1' }, raw }, { status: vi.fn().mockReturnThis(), send: vi.fn() });

    expect(raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(raw.write).toHaveBeenCalledWith('data: {"type":"progress","status":"Receiving objects…","percent":50}\n\n');
  });
});
