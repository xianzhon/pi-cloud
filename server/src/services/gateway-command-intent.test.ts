import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiSessionService } from './session-manager';
import { resolveGatewayCommand } from './gateway-command-intent';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), find: vi.fn(), create: vi.fn() }));
vi.mock('@earendil-works/pi-ai/compat', () => ({ completeSimple: mocks.complete }));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: mocks.create },
  ModelRegistry: class {
    refresh = async () => {};
    find = mocks.find;
    getAvailable = () => [{ provider: 'fallback', id: 'first' }];
    getApiKeyAndHeaders = async () => ({ ok: true, apiKey: 'key', headers: {}, env: {} });
  },
}));

const profiles = [
  { id: 'default', label: 'Default', path: '/tmp/agent', defaultProvider: 'profile', defaultModel: 'default-model' },
  { id: 'work', label: 'Work', path: '/tmp/work' },
];
const sessions = {
  listAgentProfiles: async () => profiles,
  setClientAgentProfile: vi.fn(async () => profiles[0]),
  getClientAgentDirForRoutes: async () => '/tmp/agent',
  runForegroundWithClientProfileProxy: async (_id: string, fn: () => Promise<unknown>) => fn(),
} as unknown as PiSessionService;
const options = {
  clientId: 'feishu:chat', sessions,
  config: { agentProfile: 'default', modelProvider: 'gateway', modelId: 'configured', cwdChoices: ['/workspace/pi-cloud', '/workspace/other'], defaultCwd: '/workspace/other' },
  presets: [{ id: 'preset-1', name: 'Code Review' }],
};
function response(value: unknown) {
  mocks.complete.mockResolvedValue({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(value) }] });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockImplementation((provider, id) => ({ provider, id }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('resolveGatewayCommand', () => {
  it('bypasses the model for slash commands and ordinary conversation', async () => {
    expect(await resolveGatewayCommand({ ...options, text: '/cwd 2' })).toEqual({ command: '/cwd', args: ['2'] });
    expect(await resolveGatewayCommand({ ...options, text: '请解释一下当前目录的代码' })).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each([
    [{ action: 'new_session' }, { command: '/new', args: [] }],
    [{ action: 'status' }, { command: '/status', args: [] }],
    [{ action: 'help' }, { command: '/help', args: [] }],
    [{ action: 'set_cwd', target: '/workspace/pi-cloud' }, { command: '/cwd', args: ['1'] }],
    [{ action: 'set_profile', target: 'work' }, { command: '/profile', args: ['work'] }],
    [{ action: 'set_skillset', target: 'preset-1' }, { command: '/skillset', args: ['preset-1'] }],
    [{ action: 'set_skillset', target: 'all' }, { command: '/skillset', args: ['all'] }],
  ])('validates and maps %j to an existing command', async (intent, expected) => {
    response(intent);
    expect(await resolveGatewayCommand({ ...options, text: '小助理：帮我调整一下配置' })).toEqual(expected);
  });
  it.each([
    { action: 'create_task', title: '修复登录', prompt: '修复登录错误' },
    { action: 'list_tasks' },
    { action: 'start_task', target: '修复登录' },
  ])('dispatches task intent %j without a slash command', async (intent) => {
    response(intent);
    const execute = vi.fn(async () => ({ reply: '任务操作成功' }));
    expect(await resolveGatewayCommand({ ...options, text: '小助理 处理任务', tasks: { execute } })).toEqual({ reply: '任务操作成功' });
    expect(execute).toHaveBeenCalledWith(intent, options.config);
  });
  it.each([
    { action: 'create_task', title: '', prompt: 'task' },
    { action: 'create_task', title: 'task', prompt: 'task', extra: true },
    { action: 'start_task', target: '' },
    { action: 'list_tasks', target: 'all' },
  ])('rejects malformed task intent %j before dispatch', async (intent) => {
    response(intent);
    const execute = vi.fn();
    expect(await resolveGatewayCommand({ ...options, text: '小助理 处理任务', tasks: { execute } })).toHaveProperty('reply');
    expect(execute).not.toHaveBeenCalled();
  });
  it('uses the configured gateway model with isolated context and no tools', async () => {
    response({ action: 'status' });
    await resolveGatewayCommand({ ...options, text: '小助理 我现在在哪个项目？' });
    expect(mocks.complete.mock.calls[0][0]).toEqual({ provider: 'gateway', id: 'configured' });
    const request = mocks.complete.mock.calls[0][1];
    expect(request.tools).toEqual([]);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toContain('我现在在哪个项目');
    expect(request.systemPrompt).toContain('/workspace/pi-cloud');
    expect(request.systemPrompt).toContain('Code Review');
    expect(mocks.complete.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it('uses the profile default model when the gateway has no override', async () => {
    response({ action: 'help' });
    await resolveGatewayCommand({ ...options, config: { ...options.config, modelProvider: undefined, modelId: undefined }, text: '小助理 帮助' });
    expect(mocks.complete.mock.calls[0][0]).toEqual({ provider: 'profile', id: 'default-model' });
  });
  it('does not silently use another model when the configured model is missing', async () => {
    mocks.find.mockReturnValue(undefined);
    expect(await resolveGatewayCommand({ ...options, text: '小助理 新建对话' })).toHaveProperty('reply');
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'set_cwd', target: '/etc' },
    { action: 'set_profile', target: 'invented' },
    { action: 'set_skillset', target: 'invented' },
    { action: 'set_cwd' },
    { action: 'shell', target: 'rm -rf /' },
    { actions: [{ action: 'new_session' }, { action: 'status' }] },
    { action: 'new_session', target: 'extra' },
    { action: 'new_session', actions: [{ action: 'status' }] },
  ])('fails closed for unsafe or malformed output %j', async (intent) => {
    response(intent);
    expect(await resolveGatewayCommand({ ...options, text: '小助理 帮我操作' })).toHaveProperty('reply');
  });
  it('returns clarification without producing a command', async () => {
    response({ action: 'clarify', question: '请指定要切换的项目，并以小助理开头重新发送。' });
    expect(await resolveGatewayCommand({ ...options, text: '小助理 换个项目' })).toEqual({ reply: '请指定要切换的项目，并以小助理开头重新发送。' });
  });
  it.each(['error', 'aborted'])('does not execute a partial response after %s', async (stopReason) => {
    mocks.complete.mockResolvedValue({ stopReason, content: [{ type: 'text', text: '{"action":"new_session"}' }] });
    expect(await resolveGatewayCommand({ ...options, text: '小助理 新建对话' })).toHaveProperty('reply');
  });
  it('handles provider failures and invalid JSON without falling through to chat', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('secret-provider-error'));
    const result = await resolveGatewayCommand({ ...options, text: '小助理 新建对话' });
    expect(result).toHaveProperty('reply');
    expect(JSON.stringify(result)).not.toContain('secret-provider-error');
    mocks.complete.mockResolvedValue({ stopReason: 'stop', content: [{ type: 'text', text: 'not JSON' }] });
    expect(await resolveGatewayCommand({ ...options, text: '小助理 新建对话' })).toHaveProperty('reply');
  });
  it('releases the gateway queue on timeout even if a provider ignores cancellation', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let finish!: (value: unknown) => void;
    mocks.complete.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = resolveGatewayCommand({ ...options, text: '小助理 新建对话' });
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toHaveProperty('reply');
    finish({ stopReason: 'stop', content: [{ type: 'text', text: '{"action":"new_session"}' }] });
    expect(await pending).toHaveProperty('reply');
  });
  it('honors the custom prefix and asks for an instruction for a bare prefix', async () => {
    vi.stubEnv('PI_CLOUD_GATEWAY_COMMAND_PREFIX', 'Pi');
    expect(await resolveGatewayCommand({ ...options, text: '小助理 新建对话' })).toBeNull();
    expect(await resolveGatewayCommand({ ...options, text: 'Pi：' })).toHaveProperty('reply');
    expect(mocks.complete).not.toHaveBeenCalled();
    response({ action: 'help' });
    expect(await resolveGatewayCommand({ ...options, text: 'Pi 帮助' })).toEqual({ command: '/help', args: [] });
  });
});
