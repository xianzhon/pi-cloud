import Fastify from 'fastify';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sessionService = {
  getClientAgentDirForRoutes: vi.fn(),
  listSessionAvailableSkillNames: vi.fn(),
};

const mockReload = vi.fn();
const mockGetSkills = vi.fn();
const mockRpcStart = vi.fn();
const mockRpcStop = vi.fn();
const mockRpcGetCommands = vi.fn();
const mockRpcClient = vi.fn().mockImplementation(function () {
  return {
    start: mockRpcStart,
    stop: mockRpcStop,
    getCommands: mockRpcGetCommands,
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({ 
  DefaultResourceLoader: vi.fn().mockImplementation(function () {
    return {
      reload: mockReload,
      getSkills: mockGetSkills,
    };
  }),
  RpcClient: mockRpcClient,
  getAgentDir: vi.fn(() => '/home/test/.pi/agent'),
  getPackageDir: vi.fn(() => '/opt/pi-coding-agent'),
}));

async function buildApp() {
  const { slashCommandRoutes } = await import('./slash-commands');
  const app = Fastify();
  app.decorate('services', { sessions: sessionService } as any);
  await app.register(slashCommandRoutes, { prefix: '/api/slash-commands' });
  return app;
}

describe('slashCommandRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionService.getClientAgentDirForRoutes).mockResolvedValue('/home/test/.pi/agent');
    vi.mocked(sessionService.listSessionAvailableSkillNames).mockResolvedValue([]);
    mockReload.mockResolvedValue(undefined);
    mockGetSkills.mockReturnValue({ skills: [], diagnostics: [] });
    mockRpcStart.mockResolvedValue(undefined);
    mockRpcStop.mockResolvedValue(undefined);
  });

  it('returns canonical Pi commands without extension commands', async () => {
    mockRpcGetCommands.mockResolvedValue([
      {
        name: 'session-name',
        description: 'Set or clear session name',
        source: 'extension',
        sourceInfo: { path: '/home/test/.pi/agent/extensions/session.ts' },
      },
      {
        name: 'fix-tests',
        description: 'Fix failing tests',
        source: 'prompt',
        sourceInfo: { path: '/repo/.pi/agent/prompts/fix-tests.md' },
      },
      {
        name: 'skill:frontend-design',
        description: 'Create distinctive frontend interfaces.',
        source: 'skill',
        sourceInfo: { path: '/home/test/.pi/agent/skills/frontend-design/SKILL.md' },
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/slash-commands' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'prompt-fix-tests',
          label: 'fix-tests',
          insertText: '/fix-tests ',
          category: 'built-in',
        }),
        expect.objectContaining({
          id: 'skill-frontend-design',
          label: 'skill:frontend-design',
          insertText: '/skill:frontend-design ',
          category: 'skill',
        }),
        expect.objectContaining({
          id: 'compact',
          label: '/compact',
          insertText: '/compact ',
          category: 'built-in',
        }),
      ]),
    );
    expect(response.json().commands.find((command: any) => command.id === 'extension-session-name')).toBeUndefined();
    expect(mockRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({
        cliPath: expect.stringMatching(/dist[\\/]cli\.js$/),
      }),
    );
    expect(mockRpcStop).toHaveBeenCalled();
  });

  it('filters skill slash commands by session availability when session context is provided', async () => {
    vi.mocked(sessionService.listSessionAvailableSkillNames).mockResolvedValue(['frontend-design']);
    mockRpcGetCommands.mockResolvedValue([
      {
        name: 'skill:frontend-design',
        description: 'Create distinctive frontend interfaces.',
        source: 'skill',
      },
      {
        name: 'skill:systematic-debugging',
        description: 'Fix bugs carefully.',
        source: 'skill',
      },
      {
        name: 'help',
        description: 'Show help',
        source: 'prompt',
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/slash-commands?clientId=client-1&sessionId=session-1',
    });
    await app.close();

    expect(sessionService.listSessionAvailableSkillNames).toHaveBeenCalledWith('client-1', 'session-1');
    expect(response.statusCode).toBe(200);
    expect(response.json().commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'skill-frontend-design' }),
        expect.objectContaining({ id: 'prompt-help' }),
      ]),
    );
    expect(response.json().commands.find((command: any) => command.id === 'skill-systematic-debugging')).toBeUndefined();
  });

  it('falls back to SDK-discovered skills when canonical command discovery fails', async () => {
    mockRpcStart.mockRejectedValue(new Error('rpc unavailable'));
    mockGetSkills.mockReturnValue({
      skills: [
        {
          name: 'frontend-design',
          description: 'Create distinctive frontend interfaces.',
          filePath: '/home/test/.pi/agent/skills/frontend-design/SKILL.md',
        },
      ],
      diagnostics: [],
    });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/slash-commands' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'skill-frontend-design',
          label: 'skill:frontend-design',
          insertText: '/skill:frontend-design ',
          category: 'skill',
        }),
      ]),
    );
    expect(response.json().commands.find((command: any) => command.id === 'extensions')).toBeUndefined();
  });
});
