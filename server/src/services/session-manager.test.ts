import { rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database';
import { SkillPolicyStore } from './skill-policy-store';

const readdir = vi.fn<(...args: any[]) => Promise<any[]>>(async () => []);
const readFile = vi.fn<(path: string, encoding?: BufferEncoding) => Promise<string>>(async () => '');
const writeFile = vi.fn(async () => {});
const mkdir = vi.fn(async () => {});
const access = vi.fn<(...args: any[]) => Promise<void>>(async () => {});
const stat = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ isDirectory: () => false }));
const rm = vi.fn(async () => {});
const execFile = vi.fn((_file: string, _args: string[], _options: any, callback: Function) => callback(null, '', ''));

vi.mock('child_process', () => ({ execFile }));

vi.mock('os', () => ({
  default: { homedir: () => '/Users/test' },
  homedir: () => '/Users/test',
}));

vi.mock('fs/promises', () => ({
  default: { readdir, readFile, writeFile, mkdir, access, stat, rm },
  readdir,
  readFile,
  writeFile,
  mkdir,
  access,
  stat,
  rm,
}));

const createAgentSession = vi.fn<(options: any) => Promise<any>>(async (options) => ({
  session: {
    sessionId: options.sessionManager.getSessionId(),
    sessionManager: options.sessionManager,
    messages: [],
    model: undefined,
    isStreaming: false,
    dispose: vi.fn(),
    modelRegistry: {
      refresh: vi.fn(),
      find: vi.fn(() => undefined),
      getAvailable: vi.fn(() => []),
      isUsingOAuth: vi.fn(() => false),
    },
    getAvailableThinkingLevels: vi.fn(() => []),
    getSessionStats: vi.fn(() => ({ tokens: {}, cost: 0 })),
    getContextUsage: vi.fn(() => undefined),
  },
}));
const resourceLoaderReload = vi.fn(async () => {});
let discoveredSkills = [
  { name: 'brainstorming', description: 'Creative work', filePath: '/skills/brainstorming/SKILL.md' },
  { name: 'frontend-design', description: 'Design work', filePath: '/skills/frontend-design/SKILL.md' },
  { name: 'systematic-debugging', description: 'Bug fixing', filePath: '/skills/systematic-debugging/SKILL.md' },
];
const defaultResourceLoaderCtor = vi.fn(function (this: any, options: any) {
  this.options = options;
  this.reload = resourceLoaderReload;
  this.getSkills = () => {
    const base = { skills: [...discoveredSkills], diagnostics: [] as any[] };
    return typeof options.skillsOverride === 'function' ? options.skillsOverride(base) : base;
  };
});
const loadProxyEnvForAgentDir = vi.fn(async () => ({}));
const runWithAgentDirAndProxyEnv = vi.fn(async (agentDir: string, _proxyEnv: Record<string, string>, fn: () => Promise<unknown>) => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
});

const sessionManagerSetSessionFile = vi.fn();
type MockSessionManager = {
  getCwd: () => string;
  getSessionId: () => string;
  getSessionFile: () => string;
  getHeader: () => { type: 'session'; version: number; id: string; timestamp: string; cwd: string };
  setSessionFile: (path: string) => void;
};
const createMockSessionManager = (): MockSessionManager => ({
  getCwd: () => '/workspace',
  getSessionId: () => 'session-1',
  getSessionFile: () => '/sessions/session-1.jsonl',
  getHeader: () => ({ type: 'session', version: 3, id: 'session-1', timestamp: 'now', cwd: '/workspace' }),
  setSessionFile: sessionManagerSetSessionFile,
});
const sessionManagerCreate = vi.fn<(cwd: string, agentDir: string) => MockSessionManager>(createMockSessionManager);
const sessionManagerInMemory = vi.fn<(cwd: string) => MockSessionManager>(createMockSessionManager);
const sessionManagerOpen = vi.fn<(sessionPath: string, agentDir: string) => MockSessionManager>(createMockSessionManager);

function createMemoryRuntimeMock() {
  const extension = { name: 'webui-memory', factory: vi.fn() };
  return {
    extension,
    createExtension: vi.fn(() => extension),
    withForeground: vi.fn(async (_profileId: string, work: () => Promise<unknown>) => work()),
    deleteProfile: vi.fn(),
  };
}

const sessionManagerList = vi.fn<(...args: any[]) => Promise<any[]>>(async () => []);
const sessionManagerListAll = vi.fn<(...args: any[]) => Promise<any[]>>(async () => []);
const authStorageSet = vi.fn();
const authStorageRemove = vi.fn();
const authStorageGetAuthStatus = vi.fn<(providerId: string) => { configured: boolean; source?: string }>(() => ({ configured: false }));
const authStorageDrainErrors = vi.fn(() => []);
vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    create: sessionManagerCreate,
    inMemory: sessionManagerInMemory,
    open: sessionManagerOpen,
    list: sessionManagerList,
    listAll: sessionManagerListAll,
  },
  DefaultResourceLoader: defaultResourceLoaderCtor,
  createAgentSession,
  defineTool: vi.fn((tool) => tool),
  AuthStorage: {
    create: vi.fn(() => ({
      kind: 'auth-storage',
      set: authStorageSet,
      remove: authStorageRemove,
      getAuthStatus: authStorageGetAuthStatus,
      drainErrors: authStorageDrainErrors,
    })),
  },
  ModelRegistry: {
    create: vi.fn(() => ({
      kind: 'model-registry',
      getAvailable: () => [
        { provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', input: ['text', 'image'] },
        { provider: 'openai', id: 'gpt-5', name: 'GPT-5', input: ['text'] },
      ],
    })),
  },
}));

vi.mock('./profile-proxy.js', async () => {
  const actual = await vi.importActual<typeof import('./profile-proxy.js')>('./profile-proxy.js');
  return {
    ...actual,
    loadProxyEnvForAgentDir,
    runWithAgentDirAndProxyEnv,
  };
});

const { PiSessionService } = await import('./session-manager.js');

describe('PiSessionService', () => {
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalLocalLlmAllowedOrigins = process.env.PI_WEBUI_LOCAL_LLM_ALLOWED_ORIGINS;
  let db: PiuiDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(process.cwd(), `.tmp-session-manager-${Date.now()}-${Math.random()}.sqlite`);
    db = openPiuiDatabase(dbPath);
    discoveredSkills = [
      { name: 'brainstorming', description: 'Creative work', filePath: '/skills/brainstorming/SKILL.md' },
      { name: 'frontend-design', description: 'Design work', filePath: '/skills/frontend-design/SKILL.md' },
      { name: 'systematic-debugging', description: 'Bug fixing', filePath: '/skills/systematic-debugging/SKILL.md' },
    ];
    resourceLoaderReload.mockClear();
    defaultResourceLoaderCtor.mockClear();
    createAgentSession.mockClear();
    sessionManagerCreate.mockClear();
    sessionManagerInMemory.mockClear();
    sessionManagerOpen.mockClear();
    sessionManagerList.mockClear();
    sessionManagerListAll.mockClear();
    authStorageSet.mockReset();
    authStorageRemove.mockReset();
    authStorageGetAuthStatus.mockReset();
    authStorageGetAuthStatus.mockReturnValue({ configured: false });
    authStorageDrainErrors.mockReset();
    authStorageDrainErrors.mockReturnValue([]);
    readdir.mockReset();
    readdir.mockResolvedValue([]);
    readFile.mockReset();
    readFile.mockResolvedValue('');
    writeFile.mockReset();
    writeFile.mockResolvedValue(undefined);
    mkdir.mockReset();
    mkdir.mockResolvedValue(undefined);
    access.mockReset();
    access.mockRejectedValue(new Error('missing'));
    stat.mockReset();
    stat.mockResolvedValue({ isDirectory: () => false });
    rm.mockReset();
    rm.mockResolvedValue(undefined);
    execFile.mockReset();
    execFile.mockImplementation((_file: string, _args: string[], _options: any, callback: Function) => callback(null, '', ''));
    sessionManagerSetSessionFile.mockClear();
    loadProxyEnvForAgentDir.mockReset();
    loadProxyEnvForAgentDir.mockResolvedValue({});
    runWithAgentDirAndProxyEnv.mockReset();
    runWithAgentDirAndProxyEnv.mockImplementation(async (agentDir: string, _proxyEnv: Record<string, string>, fn: () => Promise<unknown>) => {
      const previous = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      try {
        return await fn();
      } finally {
        if (previous === undefined) {
          delete process.env.PI_CODING_AGENT_DIR;
        } else {
          process.env.PI_CODING_AGENT_DIR = previous;
        }
      }
    });
    process.env.PI_CODING_AGENT_DIR = '/app/config';
    delete process.env.PI_WEBUI_LOCAL_LLM_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    db.close();
    rmSync(dbPath, { force: true });
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    if (originalLocalLlmAllowedOrigins === undefined) {
      delete process.env.PI_WEBUI_LOCAL_LLM_ALLOWED_ORIGINS;
    } else {
      process.env.PI_WEBUI_LOCAL_LLM_ALLOWED_ORIGINS = originalLocalLlmAllowedOrigins;
    }
  });

  it('discovers default and sibling agent profiles under ~/.pi', async () => {
    readdir.mockResolvedValue([
      { name: 'agent', isDirectory: () => true },
      { name: 'work', isDirectory: () => true },
      { name: 'linked', isDirectory: () => false, isSymbolicLink: () => true },
      { name: 'notes.txt', isDirectory: () => false },
    ]);
    stat.mockImplementation(async (path: string) => ({
      isDirectory: () => path === '/Users/test/.pi/linked',
    }));
    readFile.mockImplementation(async (path: string) => {
      if (path === '/Users/test/.pi/agent/settings.json') {
        return '{"defaultProvider":"anthropic","defaultModel":"claude-sonnet-4"}';
      }
      if (path === '/Users/test/.pi/work/settings.json') {
        return '{"defaultProvider":"openai","defaultModel":"gpt-4.1"}';
      }
      return '';
    });

    const service = new PiSessionService();

    await expect(service.listAgentProfiles()).resolves.toEqual([
      {
        id: 'default',
        label: 'default (~/.pi/agent)',
        path: '/Users/test/.pi/agent',
        isDefault: true,
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-4',
        automationProvider: 'anthropic',
        automationModel: 'claude-haiku-4-5',
      },
      {
        id: 'linked',
        label: 'linked (~/.pi/linked)',
        path: '/Users/test/.pi/linked',
        isDefault: false,
        automationProvider: 'anthropic',
        automationModel: 'claude-haiku-4-5',
      },
      {
        id: 'work',
        label: 'work (~/.pi/work)',
        path: '/Users/test/.pi/work',
        isDefault: false,
        defaultProvider: 'openai',
        defaultModel: 'gpt-4.1',
        automationProvider: 'anthropic',
        automationModel: 'claude-haiku-4-5',
      },
    ]);
  });

  it('stores profile API keys in Pi auth storage without returning the secret', async () => {
    const service = new PiSessionService();

    const providers = await service.saveAgentProfileApiKey('default', 'OPENCODE_API_KEY', '  secret-key  ');

    expect(authStorageSet).toHaveBeenCalledWith('opencode', { type: 'api_key', key: 'secret-key' });
    expect(authStorageSet).toHaveBeenCalledWith('opencode-go', { type: 'api_key', key: 'secret-key' });
    expect(providers).not.toContainEqual(expect.objectContaining({ apiKey: expect.anything() }));
  });

  it('reports configured profile API keys without exposing credential values', async () => {
    authStorageGetAuthStatus.mockImplementation((providerId: string) => ({
      configured: providerId === 'anthropic',
      source: providerId === 'anthropic' ? 'stored' : undefined,
    }));
    const service = new PiSessionService();

    const providers = await service.listAgentProfileApiKeyProviders('default');

    expect(providers).toContainEqual(expect.objectContaining({
      envVar: 'ANTHROPIC_API_KEY',
      configured: true,
      source: 'stored',
    }));
    expect(providers).not.toContainEqual(expect.objectContaining({ apiKey: expect.anything() }));
  });

  it('removes a stored agent-profile API key', async () => {
    const service = new PiSessionService();

    await service.removeAgentProfileApiKey('default', 'ANTHROPIC_API_KEY');

    expect(authStorageRemove).toHaveBeenCalledWith('anthropic');
  });

  it('includes declared input capabilities in agent-profile model summaries', async () => {
    const service = new PiSessionService();

    await expect(service.listAgentProfileModels('default')).resolves.toEqual([
      expect.objectContaining({ provider: 'anthropic', id: 'claude-haiku-4-5', input: ['text', 'image'] }),
      expect.objectContaining({ provider: 'openai', id: 'gpt-5', input: ['text'] }),
    ]);
  });

  it('rejects local LLM discovery against non-loopback origins by default', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'metadata' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const service = new PiSessionService();

    try {
      await expect(service.discoverAgentProfileLocalLlm('default', 'http://169.254.169.254/latest'))
        .rejects.toThrow('Local LLM endpoint origin is not allowed');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('allows only configured non-loopback local LLM origins with an exact port match', async () => {
    process.env.PI_WEBUI_LOCAL_LLM_ALLOWED_ORIGINS = 'http://192.168.1.20:11434';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'qwen3:8b' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const service = new PiSessionService();

    try {
      await expect(service.discoverAgentProfileLocalLlm('default', 'http://192.168.1.20:11434/v1'))
        .resolves.toEqual([{ id: 'qwen3:8b' }]);
      await expect(service.discoverAgentProfileLocalLlm('default', 'http://192.168.1.20:11435/v1'))
        .rejects.toThrow('Local LLM endpoint origin is not allowed');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('rejects credentials in local LLM endpoint URLs', async () => {
    const service = new PiSessionService();

    await expect(service.discoverAgentProfileLocalLlm('default', 'http://user:password@127.0.0.1:11434/v1'))
      .rejects.toThrow('Local LLM endpoint must not include credentials');
  });

  it('discovers models from an OpenAI-compatible local endpoint without following redirects', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'qwen3:8b' }, { id: 'devstral:latest' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const service = new PiSessionService();

    await expect(service.discoverAgentProfileLocalLlm('default', 'http://127.0.0.1:11434/v1/')).resolves.toEqual([
      { id: 'devstral:latest' },
      { id: 'qwen3:8b' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }));
    fetchMock.mockRestore();
  });

  it('saves local models without replacing other models.json providers', async () => {
    readFile.mockImplementation(async (path: string) => path.endsWith('/models.json')
      ? JSON.stringify({ providers: {
        custom: { baseUrl: 'https://example.com', models: [{ id: 'remote' }] },
        'pi-webui-local': { models: [{ id: 'qwen3:8b', contextWindow: 8192 }] },
      } })
      : '');
    const service = new PiSessionService();

    await service.saveAgentProfileLocalLlm('default', 'http://127.0.0.1:11434/v1', ['qwen3:8b']);

    const writeCalls = writeFile.mock.calls as unknown as Array<[string, string, string]>;
    const saved = JSON.parse(writeCalls.find(([path]) => path.endsWith('/models.json'))![1]);
    expect(saved.providers.custom.models).toEqual([{ id: 'remote' }]);
    expect(saved.providers['pi-webui-local']).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434/v1',
      api: 'openai-completions',
      apiKey: 'local',
      models: [{ id: 'qwen3:8b', contextWindow: 8192, input: ['text', 'image'] }],
    });
  });

  it('removes local models without replacing other models.json providers', async () => {
    readFile.mockImplementation(async (path: string) => path.endsWith('/models.json')
      ? JSON.stringify({ providers: {
        custom: { baseUrl: 'https://example.com', models: [{ id: 'remote' }] },
        'pi-webui-local': { models: [{ id: 'qwen3:8b' }] },
      } })
      : '');
    const service = new PiSessionService();

    await expect(service.removeAgentProfileLocalLlm('default')).resolves.toEqual({ baseUrl: '', modelIds: [] });

    const writeCalls = writeFile.mock.calls as unknown as Array<[string, string, string]>;
    const saved = JSON.parse(writeCalls.find(([path]) => path.endsWith('/models.json'))![1]);
    expect(saved.providers.custom).toBeDefined();
    expect(saved.providers['pi-webui-local']).toBeUndefined();
  });

  it('stores selected profile per client and falls back to default', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);

    const service = new PiSessionService({ db });

    await expect(service.getClientAgentProfile('client-a')).resolves.toMatchObject({
      id: 'default',
      path: '/Users/test/.pi/agent',
    });

    await service.setClientAgentProfile('client-a', 'work');
    await service.setClientAgentProfile('client-b', 'default');

    await expect(service.getClientAgentProfile('client-a')).resolves.toMatchObject({
      id: 'work',
      path: '/Users/test/.pi/work',
    });
    await expect(service.getClientAgentProfile('client-b')).resolves.toMatchObject({
      id: 'default',
      path: '/Users/test/.pi/agent',
    });

    const restartedService = new PiSessionService({ db });
    await expect(restartedService.getClientAgentProfile('new-client')).resolves.toMatchObject({
      id: 'default',
      path: '/Users/test/.pi/agent',
    });
  });

  it('deletes profile memory only after a non-default profile directory is removed', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    const memoryRuntime = createMemoryRuntimeMock();
    const service = new PiSessionService({ memoryRuntime: memoryRuntime as any });

    await expect(service.deleteAgentProfile('default')).rejects.toThrow(/default profile cannot be deleted/i);
    expect(memoryRuntime.deleteProfile).not.toHaveBeenCalled();

    rm.mockRejectedValueOnce(new Error('directory busy'));
    await expect(service.deleteAgentProfile('work')).rejects.toThrow('directory busy');
    expect(memoryRuntime.deleteProfile).not.toHaveBeenCalled();

    await service.deleteAgentProfile('work');
    expect(rm).toHaveBeenCalledWith('/Users/test/.pi/work', { recursive: true, force: false });
    expect(memoryRuntime.deleteProfile).toHaveBeenCalledWith('work');
  });

  it('creates an isolated session service with skill policy persistence', async () => {
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
    });

    await service.createSession('client-1', {
      cwd: '/workspace',
      enabledSkills: ['systematic-debugging'],
    });

    expect(service.getSkillPolicy('session-1')).toMatchObject({
      sessionId: 'session-1',
      mode: 'enabled',
      skills: ['systematic-debugging'],
    });
  });

  it('creates a session with enabled skills only and ignores unknown names', async () => {
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
    });

    const result = await service.createSession('client-1', {
      cwd: '/workspace',
      enabledSkills: ['systematic-debugging', 'unknown-skill'],
    });

    expect(result.skillPolicy).toEqual({
      mode: 'enabled',
      appliedSkills: ['systematic-debugging'],
      ignoredSkills: ['unknown-skill'],
      presetId: null,
    });
    const createSessionCall = createAgentSession.mock.calls.at(-1);
    expect(createSessionCall).toBeDefined();
    expect(createSessionCall![0].resourceLoader.getSkills().skills.map((skill: any) => skill.name)).toEqual([
      'systematic-debugging',
    ]);
    expect(service.getSkillPolicy('session-1')).toMatchObject({
      sessionId: 'session-1',
      mode: 'enabled',
      skills: ['systematic-debugging'],
    });
  });

  it('injects memory into new and resumed persisted sessions', async () => {
    const memoryRuntime = createMemoryRuntimeMock();
    const service = new PiSessionService({ memoryRuntime: memoryRuntime as any });

    await service.createSession('client-1', { cwd: '/workspace' });

    expect(memoryRuntime.createExtension).toHaveBeenCalledWith({ profileId: 'default', cwd: '/workspace' });
    expect(defaultResourceLoaderCtor.mock.calls.at(-1)?.[0].extensionFactories)
      .toEqual([
        expect.objectContaining({ name: 'pi-webui-auto-rename' }),
        expect.objectContaining({ name: 'webui-memory' }),
      ]);
    expect(createAgentSession.mock.calls.at(-1)?.[0].tools).toContain('memory');

    await service.resumeSession('client-1', '/Users/test/.pi/agent/sessions/project/session-1.jsonl');

    expect(defaultResourceLoaderCtor.mock.calls.at(-1)?.[0].extensionFactories)
      .toEqual([
        expect.objectContaining({ name: 'pi-webui-auto-rename' }),
        expect.objectContaining({ name: 'webui-memory' }),
      ]);
  });

  it('disables memory for no-session and explicitly disabled sessions', async () => {
    const memoryRuntime = createMemoryRuntimeMock();
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
      memoryRuntime: memoryRuntime as any,
    });

    await service.createSession('internal-task', { cwd: '/workspace', noSession: true });
    expect(sessionManagerInMemory).toHaveBeenCalledWith('/workspace');
    expect(sessionManagerCreate).not.toHaveBeenCalled();
    expect(service.getSkillPolicy('session-1')).toBeNull();
    expect(defaultResourceLoaderCtor.mock.calls.at(-1)?.[0].extensionFactories).toEqual([]);
    expect(createAgentSession.mock.calls.at(-1)?.[0].tools).not.toContain('memory');

    await service.createSession('memory-disabled', { cwd: '/workspace', memoryEnabled: false });
    expect(defaultResourceLoaderCtor.mock.calls.at(-1)?.[0].extensionFactories)
      .toEqual([expect.objectContaining({ name: 'pi-webui-auto-rename' })]);
    expect(createAgentSession.mock.calls.at(-1)?.[0].tools).not.toContain('memory');
    expect(memoryRuntime.createExtension).not.toHaveBeenCalled();
  });

  it('rejects mixed enabled and disabled skill lists', async () => {
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
    });

    await expect(service.createSession('client-1', {
      cwd: '/workspace',
      enabledSkills: ['brainstorming'],
      disabledSkills: ['frontend-design'],
    })).rejects.toThrow(/cannot provide both enabledSkills and disabledSkills/i);
  });

  it('returns skill configuration for an active session before it is persisted', async () => {
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
    });

    await service.createSession('client-1', {
      cwd: '/workspace',
      enabledSkills: ['systematic-debugging'],
    });

    const result = await service.getSessionSkillConfiguration('client-1', 'session-1');

    expect(sessionManagerList).not.toHaveBeenCalled();
    expect(result.policy).toEqual({
      mode: 'enabled',
      appliedSkills: ['systematic-debugging'],
      ignoredSkills: [],
      presetId: null,
    });
    expect(result.availableSkillNames).toEqual(['systematic-debugging']);
  });

  it('updates and reapplies skill policy for an active session before it is persisted', async () => {
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
    });

    await service.createSession('client-1', { cwd: '/workspace' });
    createAgentSession.mockClear();

    const result = await service.updateSessionSkillPolicy('client-1', 'session-1', 'enabled', ['frontend-design']);

    expect(result.availableSkillNames).toEqual(['frontend-design']);
    expect(service.getSkillPolicy('session-1')).toMatchObject({
      mode: 'enabled',
      skills: ['frontend-design'],
    });
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(createAgentSession.mock.calls[0][0].resourceLoader.getSkills().skills.map((skill: any) => skill.name)).toEqual(['frontend-design']);
  });

  it('reapplies a persisted skill policy when resuming a session', async () => {
    const service = new PiSessionService({
      skillPolicyStore: new SkillPolicyStore(db),
      username: 'me',
    });

    await service.createSession('client-1', {
      cwd: '/workspace',
      disabledSkills: ['frontend-design'],
    });
    createAgentSession.mockClear();

    await service.resumeSession('client-1', '/Users/test/.pi/work/sessions/project/session-1.jsonl');

    const resumeSessionCall = createAgentSession.mock.calls.at(-1);
    expect(resumeSessionCall).toBeDefined();
    expect(resumeSessionCall![0].resourceLoader.getSkills().skills.map((skill: any) => skill.name)).toEqual([
      'brainstorming',
      'systematic-debugging',
    ]);
  });

  it('lists available skills from the selected agent profile and project path', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    await expect(service.listAvailableSkills('client-1', '/repo/app')).resolves.toEqual([
      { name: 'brainstorming', description: 'Creative work', path: '/skills/brainstorming/SKILL.md' },
      { name: 'frontend-design', description: 'Design work', path: '/skills/frontend-design/SKILL.md' },
      { name: 'systematic-debugging', description: 'Bug fixing', path: '/skills/systematic-debugging/SKILL.md' },
    ]);
    expect(defaultResourceLoaderCtor).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/repo/app',
      agentDir: '/Users/test/.pi/work',
    }));
  });

  it('lists project skills for an explicit profile without changing client selection', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    const service = new PiSessionService();
    const setProfile = vi.spyOn(service, 'setClientAgentProfile');

    await expect(service.listAgentProfileSkills('work', '/repo/app')).resolves.toEqual([
      { name: 'brainstorming', description: 'Creative work', path: '/skills/brainstorming/SKILL.md' },
      { name: 'frontend-design', description: 'Design work', path: '/skills/frontend-design/SKILL.md' },
      { name: 'systematic-debugging', description: 'Bug fixing', path: '/skills/systematic-debugging/SKILL.md' },
    ]);
    expect(defaultResourceLoaderCtor).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/repo/app',
      agentDir: '/Users/test/.pi/work',
    }));
    expect(setProfile).not.toHaveBeenCalled();
  });

  it('uses the selected profile path as agent dir and session dir when creating a session', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    await service.createSession('client-1', { cwd: '/workspace' });

    expect(sessionManagerCreate).toHaveBeenCalledWith('/workspace', '/Users/test/.pi/work/sessions/--workspace--');
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: '/Users/test/.pi/work',
      }),
    );
  });

  it('uses the selected profile path as agent dir when resuming a session', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    await service.resumeSession('client-1', '/Users/test/.pi/work/sessions/project/session.jsonl');

    expect(sessionManagerOpen).toHaveBeenCalledWith('/Users/test/.pi/work/sessions/project/session.jsonl', '/Users/test/.pi/work/sessions/project');
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: '/Users/test/.pi/work',
      }),
    );
  });

  it('reads automation model migrated from old auto-rename model settings', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, auto_rename_provider, auto_rename_model_id, auto_rename_language, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('work', 'openai', 'gpt-5', 'chinese', new Date().toISOString());
    const service = new PiSessionService({ db });

    await expect(service.getAgentProfileAutomationModel('work')).resolves.toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  it('saves automation model to SQLite', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    const service = new PiSessionService({ db });

    const model = await service.saveAgentProfileAutomationModel('work', 'openai', 'gpt-5');

    expect(db.prepare('SELECT * FROM agent_profile_settings WHERE profile_id = ?').get('work')).toMatchObject({
      automation_provider: 'openai',
      automation_model_id: 'gpt-5',
    });
    expect(model).toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  it('reads auto-rename config from SQLite', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, auto_rename_provider, auto_rename_model_id, auto_rename_language, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('work', 'openai', 'gpt-5', 'chinese', new Date().toISOString());
    const service = new PiSessionService({ db });

    const config = await service.getAgentProfileAutoRenameConfig('work');

    expect(config).toEqual({ language: 'chinese' });
  });

  it('saves auto-rename config to SQLite', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    const service = new PiSessionService({ db });

    const config = await service.saveAgentProfileAutoRenameConfig('work', {
      language: 'chinese',
    });

    expect(db.prepare('SELECT * FROM agent_profile_settings WHERE profile_id = ?').get('work')).toMatchObject({
      auto_rename_language: 'chinese',
    });
    expect(config).toEqual({ language: 'chinese' });
  });

  it('preserves auto-rename settings when saving proxy settings', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, proxy_json, auto_rename_provider, auto_rename_model_id, auto_rename_language, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('work', '{"HTTP_PROXY":"http://old"}', 'openai', 'gpt-5', 'chinese', new Date().toISOString());
    const service = new PiSessionService({ db });

    await service.saveAgentProfileProxy('work', { HTTPS_PROXY: 'http://new' });

    expect(db.prepare('SELECT * FROM agent_profile_settings WHERE profile_id = ?').get('work')).toMatchObject({
      proxy_json: '{"HTTPS_PROXY":"http://new"}',
      auto_rename_provider: 'openai',
      auto_rename_model_id: 'gpt-5',
      auto_rename_language: 'chinese',
      automation_provider: 'openai',
      automation_model_id: 'gpt-5',
    });
  });

  it('checks proxy settings with curl and supplied proxy env', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    const originalHttpProxy = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://server-proxy';
    const service = new PiSessionService();

    try {
      const result = await service.checkAgentProfileProxy('work', { HTTPS_PROXY: 'http://new' });

      expect(execFile).toHaveBeenCalledWith('curl', [
        '-fsSL',
        '--connect-timeout',
        '5',
        '--max-time',
        '10',
        'https://www.google.com/generate_204',
      ], expect.objectContaining({
        env: expect.objectContaining({ HTTPS_PROXY: 'http://new' }),
        timeout: 12_000,
      }), expect.any(Function));
      expect(execFile.mock.calls[0][2].env.HTTP_PROXY).toBeUndefined();
      expect(result).toEqual({ ok: true });
    } finally {
      if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = originalHttpProxy;
    }
  });

  it('reports proxy check failures', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    execFile.mockImplementation((_file: string, _args: string[], _options: any, callback: Function) => callback(new Error('curl failed'), '', ''));
    const service = new PiSessionService();

    const result = await service.checkAgentProfileProxy('work', { HTTPS_PROXY: 'http://bad' });

    expect(result).toEqual({ ok: false });
  });

  it('loads proxy env from the selected profile when creating a session', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, proxy_json, updated_at) VALUES (?, ?, ?)`)
      .run('work', '{"ALL_PROXY":"http://localhost:7890"}', new Date().toISOString());
    const service = new PiSessionService({ db });
    await service.setClientAgentProfile('client-1', 'work');

    await service.createSession('client-1', { cwd: '/workspace' });

    expect(runWithAgentDirAndProxyEnv).not.toHaveBeenCalled();
  });

  it('passes the selected profile to resource loaders without mutating PI_CODING_AGENT_DIR', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    await service.createSession('client-1', { cwd: '/workspace' });

    expect(defaultResourceLoaderCtor).toHaveBeenCalledWith(expect.objectContaining({ agentDir: '/Users/test/.pi/work' }));
    expect(defaultResourceLoaderCtor.mock.calls.every(([options]) => options.agentDir === '/Users/test/.pi/work')).toBe(true);
    expect(runWithAgentDirAndProxyEnv).not.toHaveBeenCalled();
    expect(process.env.PI_CODING_AGENT_DIR).toBe('/app/config');
  });

  it('loads proxy env from the selected profile when resuming a session', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, proxy_json, updated_at) VALUES (?, ?, ?)`)
      .run('work', '{"ALL_PROXY":"http://localhost:7890"}', new Date().toISOString());
    const service = new PiSessionService({ db });
    await service.setClientAgentProfile('client-1', 'work');

    await service.resumeSession('client-1', '/Users/test/.pi/work/sessions/project/session.jsonl');

    expect(runWithAgentDirAndProxyEnv).not.toHaveBeenCalled();
  });

  it('runs work with the selected profile proxy env', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, proxy_json, updated_at) VALUES (?, ?, ?)`)
      .run('work', '{"ALL_PROXY":"http://localhost:7890"}', new Date().toISOString());
    const service = new PiSessionService({ db });
    await service.setClientAgentProfile('client-1', 'work');

    const result = await service.runWithClientProfileProxy('client-1', async () => 'ok');

    expect(runWithAgentDirAndProxyEnv).toHaveBeenCalledWith('/Users/test/.pi/work', { ALL_PROXY: 'http://localhost:7890' }, expect.any(Function));
    expect(result).toBe('ok');
  });

  it('gives foreground work priority within the selected profile', async () => {
    readdir.mockResolvedValue([{ name: 'work', isDirectory: () => true }]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, proxy_json, updated_at) VALUES (?, ?, ?)`)
      .run('work', '{"ALL_PROXY":"http://localhost:7890"}', new Date().toISOString());
    const memoryRuntime = createMemoryRuntimeMock();
    const service = new PiSessionService({ db, memoryRuntime: memoryRuntime as any });
    await service.setClientAgentProfile('client-1', 'work');

    const result = await service.runForegroundWithClientProfileProxy('client-1', async () => 'ok');

    expect(memoryRuntime.withForeground).toHaveBeenCalledWith('work', expect.any(Function));
    expect(runWithAgentDirAndProxyEnv).toHaveBeenCalledWith('/Users/test/.pi/work', { ALL_PROXY: 'http://localhost:7890' }, expect.any(Function));
    expect(result).toBe('ok');
  });

  it('logs a concise proxy-enabled message when running with profile proxy', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    db.prepare(`INSERT INTO agent_profile_settings (profile_id, proxy_json, updated_at) VALUES (?, ?, ?)`)
      .run('work', '{"ALL_PROXY":"http://localhost:7890","NO_PROXY":"localhost"}', new Date().toISOString());
    const service = new PiSessionService({ db });
    await service.setClientAgentProfile('client-1', 'work');

    await service.runWithClientProfileProxy('client-1', async () => 'ok');

    expect(infoSpy).toHaveBeenCalledWith('[proxy] enabled for agent request', {
      clientId: 'client-1',
      agentDir: '/Users/test/.pi/work',
      proxyKeys: ['ALL_PROXY', 'NO_PROXY'],
    });
  });

  it('does not log proxy-enabled message when no proxy keys are configured', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    loadProxyEnvForAgentDir.mockResolvedValue({});
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    await service.runWithClientProfileProxy('client-1', async () => 'ok');

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('lists sessions from the selected profile store', async () => {
    readdir.mockResolvedValue([
      { name: 'work', isDirectory: () => true },
    ]);
    sessionManagerList.mockResolvedValue([
      {
        id: 'session-1',
        path: '/Users/test/.pi/work/sessions/session-1.jsonl',
        cwd: '/workspace',
        created: '2026-06-07T00:00:00.000Z',
        updatedAt: '2026-06-07T00:00:00.000Z',
        messageCount: 1,
      },
    ]);
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    const sessions = await service.listSessions('client-1', '/workspace');

    expect(sessionManagerList).toHaveBeenCalledWith('/workspace', '/Users/test/.pi/work/sessions/--workspace--');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('session-1');
  });

  it('lists all sessions across all project directories in the selected profile', async () => {
    readdir.mockImplementation(async (path: string) => {
      if (path === '/Users/test/.pi') {
        return [{ name: 'work', isDirectory: () => true }];
      }
      if (path === '/Users/test/.pi/work/sessions') {
        return [
          { name: 'project-a', isDirectory: () => true },
          { name: 'project-b', isDirectory: () => true },
        ];
      }
      if (path === '/Users/test/.pi/work/sessions/project-a') {
        return ['a.jsonl'];
      }
      if (path === '/Users/test/.pi/work/sessions/project-b') {
        return ['b.jsonl'];
      }
      return [];
    });
    readFile.mockImplementation(async (path: string) => {
      if (path === '/Users/test/.pi/work/settings.json') {
        return '{"defaultProvider":"openai","defaultModel":"gpt-4.1"}';
      }
      if (path === '/Users/test/.pi/agent/settings.json') {
        return '';
      }
      if (path === '/Users/test/.pi/work/sessions/project-a/a.jsonl') {
        return '{"type":"session","cwd":"/workspace/a"}\n';
      }
      if (path === '/Users/test/.pi/work/sessions/project-b/b.jsonl') {
        return '{"type":"session","cwd":"/workspace/b"}\n';
      }
      return '';
    });
    sessionManagerList
      .mockResolvedValueOnce([
        {
          id: 'session-a',
          path: '/Users/test/.pi/work/sessions/project-a/a.jsonl',
          cwd: '/workspace/a',
          created: '2026-06-07T00:00:00.000Z',
          modified: '2026-06-07T00:01:00.000Z',
          messageCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'session-b',
          path: '/Users/test/.pi/work/sessions/project-b/b.jsonl',
          cwd: '/workspace/b',
          created: '2026-06-07T00:00:00.000Z',
          modified: '2026-06-07T00:02:00.000Z',
          messageCount: 2,
        },
      ]);
    const service = new PiSessionService();
    await service.setClientAgentProfile('client-1', 'work');

    const sessions = await service.listSessions('client-1');

    expect(sessionManagerList).toHaveBeenNthCalledWith(1, '/workspace/a', '/Users/test/.pi/work/sessions/project-a');
    expect(sessionManagerList).toHaveBeenNthCalledWith(2, '/workspace/b', '/Users/test/.pi/work/sessions/project-b');
    expect(sessions.map((session) => session.id)).toEqual(['session-b', 'session-a']);
  });

  it('exposes project session dir for a cwd and agent dir', () => {
    const service = new PiSessionService();
    expect(service.getProjectSessionDirForPath('/workspace/app', '/Users/test/.pi/agent')).toBe('/Users/test/.pi/agent/sessions/--workspace-app--');
  });

  it('force-disposes active sessions by pi session id', async () => {
    const dispose = vi.fn();
    createAgentSession.mockResolvedValueOnce({ session: { sessionId: 'session-force', dispose } });
    const service = new PiSessionService();

    await service.createSession('client-1', { cwd: '/workspace' });
    service.forceDisposeBySessionId('session-force');

    expect(dispose).toHaveBeenCalled();
    expect(service.getSessionBySessionId('session-force')).toBeUndefined();
  });

  it('keeps multiple active sessions for the same client', async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    createAgentSession
      .mockResolvedValueOnce({ session: { sessionId: 'session-1', dispose: firstDispose } })
      .mockResolvedValueOnce({ session: { sessionId: 'session-2', dispose: secondDispose } });
    const service = new PiSessionService();

    const first = await service.createSession('client-1', { cwd: '/workspace' });
    const second = await service.createSession('client-1', { cwd: '/workspace' });

    expect(first.session.sessionId).toBe('session-1');
    expect(second.session.sessionId).toBe('session-2');
    expect(firstDispose).not.toHaveBeenCalled();
    expect(service.getSession('client-1', 'session-1')).toBe(first.session);
    expect(service.getSession('client-1', 'session-2')).toBe(second.session);
    expect(service.getSession('client-1')).toBe(second.session);
  });
});
