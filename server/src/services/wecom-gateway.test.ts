import { createCipheriv, createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { GatewaySettingsStore } from './gateway-settings-store.js';
import { PiSessionService } from './session-manager.js';
import { SkillPresetStore } from './skill-preset-store.js';
import { WecomGatewayService } from './wecom-gateway.js';

const ORIGINAL_ENV = { ...process.env };
const CORP_ID = 'corp-test';
const AGENT_ID = '1000002';
const TOKEN = 'callback-token';
const AES_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('WecomGatewayService', () => {
  it('generates callback secrets and returns only redacted status after saving', () => {
    clearEnvironment();
    const service = createService();

    const saved = service.saveConfiguration({
      corpId: CORP_ID,
      corpSecret: 'secret-test',
      agentId: AGENT_ID,
      allowedUsers: [' user-1 ', 'user-1', 'user-2'],
    });

    expect(saved.callbackToken).toMatch(/^[0-9a-f]{32}$/);
    expect(saved.encodingAesKey).toMatch(/^[A-Za-z0-9+/]{43}$/);
    expect(saved.status).toEqual({
      configured: true,
      managedBy: 'database',
      corpId: CORP_ID,
      agentId: AGENT_ID,
      allowedUsers: ['user-1', 'user-2'],
      callbackVerified: false,
    });
    expect(service.status()).toEqual(saved.status);
    expect(service.status()).not.toHaveProperty('corpSecret');
    expect(service.status()).not.toHaveProperty('callbackToken');
    expect(service.status()).not.toHaveProperty('encodingAesKey');
  });

  it('does not allow the UI to overwrite environment-managed credentials', () => {
    configureEnvironment();
    const service = createService();

    expect(() => service.saveConfiguration({ corpId: 'other', corpSecret: 'other', agentId: '3', allowedUsers: [] }))
      .toThrow('managed by environment variables');
    expect(service.status()).toMatchObject({ configured: true, managedBy: 'environment' });
  });

  it('verifies and decrypts the callback URL challenge', () => {
    configureEnvironment();
    const service = createService();
    const encrypted = encryptWecomPayload('verified-challenge', AES_KEY, CORP_ID);
    const query = signedQuery(encrypted);

    expect(service.handleVerification({ ...query, echostr: encrypted })).toBe('verified-challenge');
  });

  it('acknowledges an encrypted text callback and queues the member message', () => {
    configureEnvironment();
    const service = createService();
    const enqueue = vi.spyOn(service as any, 'enqueue').mockImplementation(() => undefined);
    const messageXml = '<xml><ToUserName><![CDATA[corp-test]]></ToUserName><FromUserName><![CDATA[user-1]]></FromUserName><CreateTime>1788100000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello & welcome]]></Content><MsgId>12345</MsgId><AgentID>1000002</AgentID></xml>';
    const encrypted = encryptWecomPayload(messageXml, AES_KEY, CORP_ID);

    expect(service.handleCallback(signedQuery(encrypted), `<xml><ToUserName><![CDATA[corp-test]]></ToUserName><AgentID>1000002</AgentID><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`)).toBe('success');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '12345',
      userId: 'user-1',
      text: 'hello & welcome',
    }), expect.objectContaining({ corpId: CORP_ID, agentId: AGENT_ID }));
  });

  it('rejects members outside the configured allowlist without queueing work', () => {
    configureEnvironment('user-2');
    const service = createService();
    const enqueue = vi.spyOn(service as any, 'enqueue').mockImplementation(() => undefined);
    const messageXml = '<xml><ToUserName>corp-test</ToUserName><FromUserName>user-1</FromUserName><MsgType>text</MsgType><Content>hello</Content><MsgId>12345</MsgId><AgentID>1000002</AgentID></xml>';
    const encrypted = encryptWecomPayload(messageXml, AES_KEY, CORP_ID);

    expect(service.handleCallback(signedQuery(encrypted), `<xml><Encrypt>${encrypted}</Encrypt></xml>`)).toBe('success');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('caches an access token and sends an application text message to the member', async () => {
    configureEnvironment();
    const service = createService();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', access_token: 'access-1', expires_in: 7200 })))
      .mockImplementation(async () => new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', invaliduser: '' })));
    vi.stubGlobal('fetch', fetchMock);

    await (service as any).sendReply((service as any).loadConfig(), 'user-1', 'hello');
    await (service as any).sendReply((service as any).loadConfig(), 'user-1', 'again');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/cgi-bin/gettoken?corpid=corp-test&corpsecret=secret-test');
    const sendRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(sendRequest.body))).toEqual({
      touser: 'user-1',
      msgtype: 'text',
      agentid: 1000002,
      text: { content: 'hello' },
      safe: 0,
      enable_duplicate_check: 1,
      duplicate_check_interval: 1800,
    });
  });

  it('refreshes an expired access token once before retrying a message', async () => {
    configureEnvironment();
    const service = createService();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', access_token: 'access-old', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: 'access_token expired' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', access_token: 'access-new', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await (service as any).sendReply((service as any).loadConfig(), 'user-1', 'hello');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][0]).toContain('access_token=access-old');
    expect(fetchMock.mock.calls[3][0]).toContain('access_token=access-new');
  });

  it('splits long UTF-8 replies without breaking characters', async () => {
    configureEnvironment();
    const service = createService();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', access_token: 'access-1', expires_in: 7200 }))
      .mockImplementation(async () => jsonResponse({ errcode: 0, errmsg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const reply = `Answer: ${'你'.repeat(900)}`;

    await (service as any).sendReply((service as any).loadConfig(), 'user-1', reply);

    const sentChunks = fetchMock.mock.calls.slice(1).map((call) => {
      const request = call[1] as RequestInit;
      return JSON.parse(String(request.body)).text.content as string;
    });
    expect(sentChunks.length).toBeGreaterThan(1);
    expect(sentChunks.join('')).toBe(reply);
    expect(sentChunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 1900)).toBe(true);
  });

  it('persists a member profile selected through a slash command', async () => {
    configureEnvironment();
    const sessions = new PiSessionService();
    sessions.listAgentProfiles = vi.fn(async () => [
      { id: 'default', label: 'default', path: '/tmp/default', isDefault: true },
      { id: 'work', label: 'work', path: '/tmp/work', isDefault: false },
    ] as any);
    sessions.disposeSession = vi.fn() as any;
    sessions.getSession = vi.fn(() => undefined) as any;
    const db = openPiCloudDatabase(':memory:');
    const service = new WecomGatewayService(db, new GatewaySettingsStore(db), sessions);
    const replies: string[] = [];
    (service as any).sendReply = vi.fn(async (_config, _userId, text) => replies.push(text));
    const config = (service as any).loadConfig();

    expect(await (service as any).handleCommand('wecom:dm:user-1', { userId: 'user-1', text: '/profile work' }, config, config)).toBe(true);
    expect(db.prepare('SELECT agent_profile FROM wecom_gateway_configs WHERE client_id = ?').get('wecom:dm:user-1'))
      .toMatchObject({ agent_profile: 'work' });
    expect(replies[0]).toContain('Profile: work');
  });

  it('persists a member skillset selected through a slash command', async () => {
    configureEnvironment();
    const db = openPiCloudDatabase(':memory:');
    const preset = new SkillPresetStore(db).create({ username: 'admin', name: 'review', mode: 'enabled', skills: ['code-review'] });
    const service = new WecomGatewayService(db, new GatewaySettingsStore(db), new PiSessionService());
    (service as any).sendReply = vi.fn(async () => undefined);
    const config = (service as any).loadConfig();

    expect(await (service as any).handleCommand('wecom:dm:user-1', { userId: 'user-1', text: '/skillset review' }, config, config)).toBe(true);
    expect(db.prepare('SELECT skill_mode, skill_preset_id FROM wecom_gateway_configs WHERE client_id = ?').get('wecom:dm:user-1'))
      .toEqual({ skill_mode: 'enabled', skill_preset_id: preset.id });
  });
});

function createService() {
  const db = openPiCloudDatabase(':memory:');
  return new WecomGatewayService(db, new GatewaySettingsStore(db), new PiSessionService());
}

function configureEnvironment(allowedUsers = 'user-1') {
  process.env.PI_CLOUD_WECOM_CORP_ID = CORP_ID;
  process.env.PI_CLOUD_WECOM_CORP_SECRET = 'secret-test';
  process.env.PI_CLOUD_WECOM_AGENT_ID = AGENT_ID;
  process.env.PI_CLOUD_WECOM_CALLBACK_TOKEN = TOKEN;
  process.env.PI_CLOUD_WECOM_ENCODING_AES_KEY = AES_KEY;
  process.env.PI_CLOUD_WECOM_ALLOWED_USERS = allowedUsers;
}

function clearEnvironment() {
  for (const key of [
    'PI_CLOUD_WECOM_CORP_ID',
    'PI_CLOUD_WECOM_CORP_SECRET',
    'PI_CLOUD_WECOM_AGENT_ID',
    'PI_CLOUD_WECOM_CALLBACK_TOKEN',
    'PI_CLOUD_WECOM_ENCODING_AES_KEY',
    'PI_CLOUD_WECOM_ALLOWED_USERS',
  ]) delete process.env[key];
}

function signedQuery(encrypted: string) {
  const timestamp = '1788100000';
  const nonce = 'nonce-test';
  const msgSignature = createHash('sha1').update([TOKEN, timestamp, nonce, encrypted].sort().join('')).digest('hex');
  return { msg_signature: msgSignature, timestamp, nonce };
}

function encryptWecomPayload(message: string, encodingAesKey: string, receiveId: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  const messageBytes = Buffer.from(message);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBytes.length);
  let plaintext = Buffer.concat([Buffer.alloc(16, 7), length, messageBytes, Buffer.from(receiveId)]);
  const padding = 32 - (plaintext.length % 32);
  plaintext = Buffer.concat([plaintext, Buffer.alloc(padding, padding)]);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
}

function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body));
}
