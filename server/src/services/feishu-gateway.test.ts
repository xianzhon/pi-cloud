import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiuiDatabase } from '../db/database';
import { FeishuGatewayService } from './feishu-gateway';
import { GatewaySettingsStore } from './gateway-settings-store';
import { sessionService } from './session-manager';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_SESSION_METHODS = {
  disposeSession: sessionService.disposeSession,
  getSession: sessionService.getSession,
  listAgentProfiles: sessionService.listAgentProfiles,
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sessionService.disposeSession = ORIGINAL_SESSION_METHODS.disposeSession;
  sessionService.getSession = ORIGINAL_SESSION_METHODS.getSession;
  sessionService.listAgentProfiles = ORIGINAL_SESSION_METHODS.listAgentProfiles;
  vi.restoreAllMocks();
});

describe('FeishuGatewayService', () => {
  it('decrypts encrypted URL verification callbacks before token and challenge handling', async () => {
    process.env.PI_WEBUI_FEISHU_APP_ID = 'cli_test';
    process.env.PI_WEBUI_FEISHU_APP_SECRET = 'secret_test';
    process.env.PI_WEBUI_FEISHU_VERIFICATION_TOKEN = 'verify_test';
    process.env.PI_WEBUI_FEISHU_ENCRYPT_KEY = 'encrypt_test';
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);

    const encrypted = encryptFeishuPayload(process.env.PI_WEBUI_FEISHU_ENCRYPT_KEY, {
      type: 'url_verification',
      token: process.env.PI_WEBUI_FEISHU_VERIFICATION_TOKEN,
      challenge: 'challenge_test',
    });

    await expect(service.handleCallback({ encrypt: encrypted })).resolves.toEqual({
      challenge: 'challenge_test',
    });
  });

  it('rejects callbacks when the verification token is not configured', async () => {
    process.env.PI_WEBUI_FEISHU_APP_ID = 'cli_test';
    process.env.PI_WEBUI_FEISHU_APP_SECRET = 'secret_test';
    delete process.env.PI_WEBUI_FEISHU_VERIFICATION_TOKEN;
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);

    await expect(service.handleCallback({ type: 'url_verification', challenge: 'challenge_test' })).rejects.toMatchObject({
      message: 'Feishu gateway is not configured',
      statusCode: 503,
    });
  });

  it('rejects encrypted callbacks when the encrypt key is missing', async () => {
    process.env.PI_WEBUI_FEISHU_APP_ID = 'cli_test';
    process.env.PI_WEBUI_FEISHU_APP_SECRET = 'secret_test';
    process.env.PI_WEBUI_FEISHU_VERIFICATION_TOKEN = 'verify_test';
    delete process.env.PI_WEBUI_FEISHU_ENCRYPT_KEY;
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);
    const encrypted = encryptFeishuPayload('encrypt_test', { type: 'url_verification' });

    await expect(service.handleCallback({ encrypt: encrypted })).rejects.toMatchObject({
      message: 'Feishu encrypted callback requires PI_WEBUI_FEISHU_ENCRYPT_KEY',
      statusCode: 400,
    });
  });

  it('persists a Feishu chat profile selected by command', async () => {
    const db = openPiuiDatabase(':memory:');
    const service = new FeishuGatewayService(db as any);
    const replies: string[] = [];
    (service as any).sendReply = vi.fn(async (_config, _messageId, text) => replies.push(text));
    sessionService.listAgentProfiles = vi.fn(async () => [
      { id: 'default', label: 'default', path: '/tmp/default', isDefault: true },
      { id: 'work', label: 'work', path: '/tmp/work', isDefault: false, defaultProvider: 'openrouter', defaultModel: 'model-a' },
    ] as any);
    sessionService.getSession = vi.fn(() => undefined) as any;
    sessionService.disposeSession = vi.fn() as any;

    await (service as any).handleCommand('feishu:dm:chat', { messageId: 'mid', text: '/profile work' }, minimalConfig(), minimalConfig());

    const row = db.prepare('SELECT agent_profile FROM feishu_gateway_configs WHERE client_id = ?').get('feishu:dm:chat') as any;
    expect(row.agent_profile).toBe('work');
    expect(replies[0]).toContain('Profile: work');
  });

  it('loads default gateway profile and skillset from Web UI settings', () => {
    const db = openPiuiDatabase(':memory:');
    db.prepare(`
      INSERT INTO skill_presets (id, username, name, mode, skills_json, created_at, updated_at)
      VALUES ('preset-debug', 'me', 'debug', 'enabled', '["systematic-debugging"]', 'now', 'now')
    `).run();
    const settings = new GatewaySettingsStore(db as any);
    settings.save({ cwds: [], defaultProfile: 'work', defaultSkillset: 'preset-debug' });
    const service = new FeishuGatewayService(db as any, settings);

    expect((service as any).loadConfig()).toMatchObject({
      agentProfile: 'work',
      skillMode: 'enabled',
      skillPresetId: 'preset-debug',
    });
  });

  it('saves gateway cwd choices and lists them by command', async () => {
    const db = openPiuiDatabase(':memory:');
    const settings = new GatewaySettingsStore(db as any);
    const service = new FeishuGatewayService(db as any);
    const replies: string[] = [];
    (service as any).sendReply = vi.fn(async (_config, _messageId, text) => replies.push(text));

    expect(settings.save({ cwds: ['/workspace/one', ' ', '/workspace/two', '/workspace/one'] })).toEqual({
      cwds: ['/workspace/one', '/workspace/two'],
      defaultProfile: '',
      defaultSkillset: '',
      defaultModelProvider: '',
      defaultModelId: '',
    });

    const config = { ...minimalConfig(), cwdChoices: settings.get().cwds };
    await (service as any).handleCommand('feishu:dm:chat', { messageId: 'mid', text: '/cwds' }, config, config);
    expect(replies[0]).toBe('1: /workspace/one\n2: /workspace/two');
  });

  it('uses the first Web UI cwd choice as the default cwd', () => {
    const db = openPiuiDatabase(':memory:');
    const settings = new GatewaySettingsStore(db as any);
    settings.save({ cwds: ['/workspace/default', '/workspace/other'] });
    const service = new FeishuGatewayService(db as any, settings);

    expect((service as any).loadConfig()).toMatchObject({
      defaultCwd: '/workspace/default',
      cwdChoices: ['/workspace/default', '/workspace/other'],
    });
  });

  it('reports no gateway folders when no Web UI cwd choices exist', async () => {
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);
    const replies: string[] = [];
    (service as any).sendReply = vi.fn(async (_config, _messageId, text) => replies.push(text));
    const config = (service as any).loadConfig();

    await (service as any).handleCommand('feishu:dm:chat', { messageId: 'mid', text: '/cwds' }, config, config);

    expect(replies[0]).toBe('No gateway folders configured.');
  });

  it('switches Feishu cwd only through Web UI configured cwd choices', async () => {
    const db = openPiuiDatabase(':memory:');
    const service = new FeishuGatewayService(db as any);
    (service as any).sendReply = vi.fn(async () => undefined);
    sessionService.listAgentProfiles = vi.fn(async () => [
      { id: 'default', label: 'default', path: '/tmp/default', isDefault: true },
    ] as any);
    sessionService.getSession = vi.fn(() => undefined) as any;
    sessionService.disposeSession = vi.fn() as any;
    const config = { ...minimalConfig(), cwdChoices: [process.cwd()] };

    await (service as any).handleCommand('feishu:dm:chat', { messageId: 'mid', text: '/cwd 1' }, config, config);

    const row = db.prepare('SELECT default_cwd FROM feishu_gateway_configs WHERE client_id = ?').get('feishu:dm:chat') as any;
    expect(row.default_cwd).toBe(process.cwd());
  });

  it('rejects arbitrary Feishu cwd paths', async () => {
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);
    const replies: string[] = [];
    (service as any).sendReply = vi.fn(async (_config, _messageId, text) => replies.push(text));
    const config = { ...minimalConfig(), cwdChoices: [process.cwd()] };

    await (service as any).handleCommand('feishu:dm:chat', { messageId: 'mid', text: '/cwd /tmp' }, config, config);

    expect(replies[0]).toContain('Usage: /cwd <1-1>');
  });

  it('persists a Feishu chat skillset selected by command', async () => {
    const db = openPiuiDatabase(':memory:');
    db.prepare(`
      INSERT INTO skill_presets (id, username, name, mode, skills_json, created_at, updated_at)
      VALUES ('preset-debug', 'me', 'debug', 'enabled', '["systematic-debugging"]', 'now', 'now')
    `).run();
    const service = new FeishuGatewayService(db as any);
    (service as any).sendReply = vi.fn(async () => undefined);
    sessionService.listAgentProfiles = vi.fn(async () => [
      { id: 'default', label: 'default', path: '/tmp/default', isDefault: true },
    ] as any);
    sessionService.getSession = vi.fn(() => undefined) as any;
    sessionService.disposeSession = vi.fn() as any;

    await (service as any).handleCommand(
      'feishu:dm:chat',
      { messageId: 'mid', text: '/skillset debug' },
      minimalConfig(),
      minimalConfig(),
    );

    const row = db.prepare('SELECT skill_mode, skill_preset_id FROM feishu_gateway_configs WHERE client_id = ?').get('feishu:dm:chat') as any;
    expect(row).toMatchObject({ skill_mode: 'enabled', skill_preset_id: 'preset-debug' });
  });

  it('formats Feishu status as a readable bullet summary', async () => {
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);
    sessionService.listAgentProfiles = vi.fn(async () => [
      { id: 'default', label: 'default', path: '/tmp/default', isDefault: true, defaultProvider: 'openrouter', defaultModel: 'model-a' },
    ] as any);
    sessionService.getSession = vi.fn(() => ({ sessionId: 'session-1', model: { provider: 'anthropic', id: 'claude' } })) as any;

    const status = await (service as any).formatStatus('feishu:dm:chat', { ...minimalConfig(), defaultCwd: '/workspace/app' });

    expect(status).toContain('Pi session status');
    expect(status).toContain('- Profile: default');
    expect(status).toContain('- CWD: /workspace/app');
    expect(status).toContain('- Provider: anthropic');
    expect(status).toContain('- Model: claude');
    expect(status).toContain('- Skillset: all');
    expect(status).toContain('- Session: active (session-1)');
  });

  it('lists common command aliases in help', () => {
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);

    const help = (service as any).formatHelp();

    expect(help).toContain('Common aliases:');
    expect(help).toContain('小助理新建对话 | 新对话');
    expect(help).toContain('小助理当前对话 | 状态');
    expect(help).toContain('小助理帮助｜命令列表');
  });

  it('returns status summary after /new resets the Feishu session', async () => {
    const service = new FeishuGatewayService(openPiuiDatabase(':memory:') as any);
    const replies: string[] = [];
    (service as any).sendReply = vi.fn(async (_config, _messageId, text) => replies.push(text));
    sessionService.listAgentProfiles = vi.fn(async () => [
      { id: 'default', label: 'default', path: '/tmp/default', isDefault: true, defaultProvider: 'openrouter', defaultModel: 'model-a' },
    ] as any);
    sessionService.getSession = vi.fn(() => undefined) as any;
    sessionService.disposeSession = vi.fn() as any;

    await (service as any).handleCommand('feishu:dm:chat', { messageId: 'mid', text: '小助理 新建对话' }, { ...minimalConfig(), defaultCwd: '/workspace/app' }, { ...minimalConfig(), defaultCwd: '/workspace/app' });

    expect(sessionService.disposeSession).toHaveBeenCalledWith('feishu:dm:chat');
    expect(replies[0]).toContain('Reset this Feishu chat. A fresh Pi session will start with your next message.');
    expect(replies[0]).toContain('- CWD: /workspace/app');
    expect(replies[0]).toContain('- Session: not started');
  });
});

function minimalConfig() {
  return {
    appId: 'cli_test',
    appSecret: 'secret_test',
    verificationToken: '',
    encryptKey: '',
    domain: 'feishu' as const,
    cwdChoices: [],
  };
}

function encryptFeishuPayload(encryptKey: string, payload: Record<string, unknown>): string {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const iv = Buffer.from('0123456789abcdef', 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]).toString('base64');
}
