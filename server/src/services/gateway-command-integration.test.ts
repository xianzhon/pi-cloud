import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database';
import { FeishuGatewayService } from './feishu-gateway';
import { WecomGatewayService } from './wecom-gateway';
import { WeixinGatewayService } from './weixin-gateway';
import { SkillPresetStore } from './skill-preset-store';
import type { PiSessionService } from './session-manager';

const complete = vi.hoisted(() => vi.fn());
vi.mock('@earendil-works/pi-ai/compat', async (original) => ({ ...await original<object>(), completeSimple: complete }));
vi.mock('@earendil-works/pi-coding-agent', async (original) => ({
  ...await original<object>(),
  ModelRuntime: { create: async () => ({}) },
  ModelRegistry: class {
    refresh = async () => {};
    find = () => ({ provider: 'mock', id: 'model' });
    getApiKeyAndHeaders = async () => ({ ok: true, apiKey: 'key' });
  },
}));

const dbs: ReturnType<typeof openPiCloudDatabase>[] = [];
afterEach(() => { dbs.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); });
beforeEach(() => complete.mockReset());

for (const [name, Service, recipient] of [
  ['feishu', FeishuGatewayService, 'messageId'],
  ['wecom', WecomGatewayService, 'userId'],
  ['weixin', WeixinGatewayService, 'chatId'],
] as const) {
  describe(`${name} intelligent management commands`, () => {
    function setup() {
      const db = openPiCloudDatabase(':memory:');
      dbs.push(db);
      const sessions = {
        listAgentProfiles: async () => [{ id: 'default', label: 'Default', defaultProvider: 'mock', defaultModel: 'model' }, { id: 'work', label: 'Work' }],
        setClientAgentProfile: async () => ({}),
        getClientAgentDirForRoutes: async () => '/tmp/agent',
        runForegroundWithClientProfileProxy: async (_id: string, fn: () => Promise<unknown>) => fn(),
        getSession: () => undefined,
        disposeSession: vi.fn(),
      };
      const service = new Service(db, undefined, sessions as unknown as PiSessionService);
      const replies: string[] = [];
      vi.spyOn(service as any, 'sendReply').mockImplementation(async (...args: unknown[]) => { replies.push(String(args[2])); });
      const config = { agentProfile: 'default', cwdChoices: [tmpdir()], defaultCwd: tmpdir() };
      const clientId = `${name}:chat`;
      async function handle(text: string, output?: unknown) {
        if (output) complete.mockResolvedValue({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(output) }] });
        return (service as any).handleCommand(clientId, { text, [recipient]: 'recipient' }, config, config);
      }
      function saved() {
        return db.prepare(`SELECT * FROM ${name}_gateway_configs WHERE client_id = ?`).get(clientId) as Record<string, unknown> | undefined;
      }
      return { db, sessions, replies, handle, saved };
    }
    it('executes validated profile, directory, and skillset changes using existing persistence', async () => {
      const { db, handle, saved, sessions } = setup();
      const preset = new SkillPresetStore(db).create({ username: 'me', name: 'Code Review', mode: 'enabled', skills: ['review'] });
      expect(await handle('小助理 换到工作配置', { action: 'set_profile', target: 'work' })).toBe(true);
      expect(saved()?.agent_profile).toBe('work');
      expect(await handle('小助理 换到临时项目', { action: 'set_cwd', target: tmpdir() })).toBe(true);
      expect(saved()?.default_cwd).toBe(tmpdir());
      expect(await handle('小助理 使用代码评审技能集', { action: 'set_skillset', target: preset.id })).toBe(true);
      expect(saved()?.skill_preset_id).toBe(preset.id);
      expect(sessions.disposeSession).toHaveBeenCalledTimes(3);
    });
    it('replies without changing state or falling through for ambiguous and failed commands', async () => {
      const { handle, saved, replies, sessions } = setup();
      expect(await handle('小助理 换个项目', { action: 'clarify', question: '请选择一个项目。' })).toBe(true);
      expect(replies[0]).toBe('请选择一个项目。');
      expect(await handle('小助理 换目录', { action: 'set_cwd', target: '/not/allowed' })).toBe(true);
      complete.mockRejectedValueOnce(new Error('provider unavailable'));
      expect(await handle('小助理 新建对话')).toBe(true);
      expect(saved()).toBeUndefined();
      expect(sessions.disposeSession).not.toHaveBeenCalled();
    });
    it('preserves slash commands and ordinary-message routing without a model request', async () => {
      const { handle, saved } = setup();
      expect(await handle('/profile work')).toBe(true);
      expect(saved()?.agent_profile).toBe('work');
      expect(await handle('/status')).toBe(true);
      expect(await handle('请帮我分析这段代码')).toBe(false);
      expect(complete).not.toHaveBeenCalled();
    });
    it('creates a new session only for the validated new-session action', async () => {
      const { handle, sessions, replies } = setup();
      expect(await handle('小助理 重新聊一件事', { action: 'new_session' })).toBe(true);
      expect(sessions.disposeSession).toHaveBeenCalledTimes(1);
      expect(replies[0]).toContain('not started');
    });
  });
}
