import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { GatewaySettingsStore } from './gateway-settings-store.js';
import { WeixinGatewayService } from './weixin-gateway.js';

const ORIGINAL_ENV = { ...process.env };
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

function createService() {
  const db = openPiCloudDatabase(':memory:');
  const settings = new GatewaySettingsStore(db);
  const sessions = {
    listAgentProfiles: vi.fn(async () => [{ id: 'default', defaultProvider: 'openai', defaultModel: 'gpt' }, { id: 'work' }]),
    getSession: vi.fn(), disposeSession: vi.fn(), setClientAgentProfile: vi.fn(async () => undefined),
    findPersistedSession: vi.fn(), resumeSession: vi.fn(), createSession: vi.fn(),
    runForegroundWithClientProfileProxy: vi.fn(async (_id, callback) => callback()),
  };
  const service = new WeixinGatewayService(db, settings, sessions as never);
  return { db, settings, sessions, service, internal: service as any };
}

function config(overrides = {}) {
  return {
    enabled: true, accountId: 'bot-account', token: 'token', baseUrl: 'https://wx.test',
    defaultCwd: '/tmp', cwdChoices: ['/tmp'], agentProfile: 'default', modelProvider: 'openai', modelId: 'gpt',
    skillMode: 'all', skillPresetId: undefined, dmPolicy: 'pairing', allowedUsers: [], ...overrides,
  };
}

function message(text: string, overrides = {}) {
  return { messageId: 'm1', chatId: 'user-1', chatType: 'dm', senderId: 'user-1', text, images: [], ...overrides };
}

describe('WeixinGatewayService behavior', () => {
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; vi.restoreAllMocks(); });

  it('loads environment, stored credential, settings, policies, and status', () => {
    const { db, settings, service } = createService();
    settings.save({ cwds: [' /tmp ', '/tmp'], defaultProfile: 'work', defaultModelProvider: 'p', defaultModelId: 'm' });
    db.prepare("INSERT INTO weixin_gateway_credentials (id, account_id, token, base_url, user_id, updated_at) VALUES (1, 'stored-account', 'stored-token', 'https://stored/', 'u1', 'now')").run();
    process.env.PI_CLOUD_WECHAT_GATEWAY_ENABLED = 'yes';
    process.env.PI_CLOUD_WECHAT_DM_POLICY = 'ALLOWLIST';
    process.env.PI_CLOUD_WECHAT_ALLOWED_USERS = ' u1, u2, ';
    expect(service.status()).toMatchObject({ enabled: true, configured: true, paired: true, accountId: 'stored-a', baseUrl: 'https://stored', dmPolicy: 'allowlist' });

    process.env.PI_CLOUD_WECHAT_ACCOUNT_ID = 'env-account';
    process.env.PI_CLOUD_WECHAT_TOKEN = 'env-token';
    process.env.PI_CLOUD_WECHAT_BASE_URL = 'https://env///';
    expect(service.status()).toMatchObject({ accountId: 'env-acco', baseUrl: 'https://env' });
    db.close();
  });

  it('starts only when enabled and configured, and stops its poll task', async () => {
    const { db, service, internal } = createService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    internal.loadConfig = vi.fn(() => config({ enabled: false }));
    service.start();
    expect(service.status().running).toBe(false);
    internal.loadConfig.mockReturnValue(config({ accountId: '', token: '' }));
    service.start();
    expect(warn).toHaveBeenCalled();
    let finish!: () => void;
    internal.pollLoop = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    internal.loadConfig.mockReturnValue(config());
    service.start();
    service.start();
    expect(service.status().running).toBe(true);
    finish();
    await service.stop();
    expect(service.status().running).toBe(false);
    db.close();
  });

  it('parses direct messages, voice text, image data, and rejects unsupported senders', async () => {
    const { db, internal } = createService();
    expect(await internal.parseMessage({ from_user_id: '', item_list: [] }, config())).toBeNull();
    expect(await internal.parseMessage({ from_user_id: 'bot-account', item_list: [] }, config())).toBeNull();
    expect(await internal.parseMessage({ from_user_id: 'u', room_id: 'room', item_list: [] }, config())).toBeNull();
    expect(await internal.parseMessage({ from_user_id: 'u', item_list: [] }, config({ dmPolicy: 'disabled' }))).toBeNull();
    expect(await internal.parseMessage({ from_user_id: 'u', item_list: [] }, config({ dmPolicy: 'allowlist' }))).toBeNull();

    const parsed = await internal.parseMessage({
      from_user_id: 'u', message_id: 'id', context_token: ' context ',
      item_list: [{ type: 3, voice_item: { text: ' spoken ' } }, { type: 2, image_item: { data: `data:image/png;base64,${png}`, mime_type: 'image/png' } }],
    }, config({ dmPolicy: 'allowlist', allowedUsers: ['u'] }));
    expect(parsed).toMatchObject({ messageId: 'id', chatId: 'u', text: 'spoken', contextToken: 'context' });
    expect(parsed.images[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: png });
    db.close();
  });

  it('recognizes DM policy and chat shapes', () => {
    const { db, internal } = createService();
    expect(internal.guessChat({ from_user_id: 'u' }, 'bot')).toEqual({ chatType: 'dm', chatId: 'u' });
    expect(internal.guessChat({ from_user_id: 'u', to_user_id: 'other', msg_type: 1 }, 'bot')).toEqual({ chatType: 'group', chatId: 'other' });
    process.env.PI_CLOUD_WECHAT_ALLOW_ALL_USERS = 'true';
    expect(internal.isDmAllowed('u', config({ dmPolicy: 'open' }))).toBe(true);
    process.env.PI_CLOUD_WECHAT_ALLOW_ALL_USERS = 'false';
    expect(internal.isDmAllowed('u', config({ dmPolicy: 'open' }))).toBe(false);
    expect(internal.isDmAllowed('u', config({ dmPolicy: 'pairing' }))).toBe(true);
    db.close();
  });

  it('deduplicates messages and expires old IDs', () => {
    const { db, internal } = createService();
    expect(internal.markDuplicate('')).toBe(false);
    expect(internal.markDuplicate('one')).toBe(false);
    expect(internal.markDuplicate('one')).toBe(true);
    internal.seen.set('old', 0);
    expect(internal.markDuplicate('two')).toBe(false);
    expect(internal.seen.has('old')).toBe(false);
    db.close();
  });

  it('handles every supported command and unknown commands', async () => {
    const { db, internal, sessions } = createService();
    const replies: string[] = [];
    internal.sendReply = vi.fn(async (_config: unknown, _chat: string, text: string) => { replies.push(text); });
    internal.presetStore.create({ username: 'u', name: 'Review', mode: 'enabled', skills: ['read'] });
    const base = config();
    for (const command of ['/help', '/status', '/profiles', '/cwds', '/pwds', '/cwd', '/cwd 1', '/skillsets', '/skillset all', '/skillset Review', '/profile work', '/reset', '/new', '/clear-config', '/unknown']) {
      expect(await internal.handleCommand('weixin:dm:u', message(command), base, internal.resolveChatConfig('weixin:dm:u', base))).toBe(true);
    }
    expect(await internal.handleCommand('id', message('hello'), base, base)).toBe(false);
    expect(replies.some((reply) => reply.includes('Pi WeChat commands'))).toBe(true);
    expect(replies.some((reply) => reply.includes('Unknown command'))).toBe(true);
    expect(sessions.disposeSession).toHaveBeenCalled();
    db.close();
  });

  it('reports command validation failures as replies', async () => {
    const { db, internal } = createService();
    const sendReply = vi.spyOn(internal, 'sendReply').mockResolvedValue(undefined);
    for (const [text, base] of [
      ['/profile', config()], ['/profile missing', config()], ['/cwd 0', config()], ['/cwd 1', config({ cwdChoices: [] })],
      ['/skillset', config()], ['/skillset missing', config()],
    ] as const) {
      await internal.handleCommand('id', message(text), base, base);
    }
    expect(sendReply.mock.calls.every((call: any[]) => call[2].startsWith('Command failed:'))).toBe(true);
    db.close();
  });

  it('resolves chat overrides and creates skill-aware session options', async () => {
    const { db, internal } = createService();
    const preset = internal.presetStore.create({ username: 'u', name: 'Safe', mode: 'disabled', skills: ['bash'] });
    internal.saveChatConfig('chat', { agentProfile: 'work', defaultCwd: '/tmp', skillMode: 'disabled', skillPresetId: preset.id });
    const resolved = internal.resolveChatConfig('chat', config());
    expect(resolved).toMatchObject({ agentProfile: 'work', defaultCwd: '/tmp', modelProvider: undefined, skillMode: 'disabled', skillPresetId: preset.id });
    expect(await internal.createSessionOptions(resolved)).toMatchObject({ cwd: '/tmp', disabledSkills: ['bash'], presetId: preset.id, skillMode: 'disabled' });
    internal.clearChatConfig('chat');
    expect(internal.getChatConfig('chat')).toEqual({});
    db.close();
  });

  it('persists session mappings, sync buffers, context tokens, and credentials', () => {
    const { db, internal } = createService();
    internal.saveSessionMapping('chat', 'session');
    expect(internal.getMappedSessionId('chat')).toBe('session');
    internal.saveSessionMapping('chat', 'session-2');
    expect(internal.getMappedSessionId('chat')).toBe('session-2');
    internal.deleteSessionMapping('chat');
    expect(internal.getMappedSessionId('chat')).toBeUndefined();
    internal.saveSyncBuf('bot', 'sync');
    expect(internal.getSyncBuf('bot')).toBe('sync');
    internal.saveContextToken('bot', 'peer', 'context');
    const storedContext = db.prepare('SELECT context_token FROM weixin_gateway_context_tokens WHERE account_id = ? AND peer_id = ?')
      .get('bot', 'peer') as { context_token: string };
    expect(storedContext.context_token).toMatch(/^enc:v1:/);
    expect(internal.getContextToken('bot', 'peer')).toBe('context');
    internal.saveCredential({ accountId: 'a', token: 't', baseUrl: 'u' });
    expect(internal.loadCredential()).toMatchObject({ accountId: 'a', token: 't', baseUrl: 'u' });
    expect(() => internal.credentialFromPairingResponse({})).toThrow('did not return');
    expect(internal.credentialFromPairingResponse({ ilink_bot_id: 'a', bot_token: 't' })).toMatchObject({ baseUrl: 'https://ilinkai.weixin.qq.com' });
    db.close();
  });

  it('ensures active, resumed, and newly created sessions', async () => {
    const { db, internal, sessions } = createService();
    const active = { sessionId: 'active' };
    sessions.getSession.mockReturnValueOnce(active);
    expect(await internal.ensureSession('chat', config())).toBe(active);

    sessions.getSession.mockReturnValue(undefined);
    internal.saveSessionMapping('chat', 'stored');
    sessions.findPersistedSession.mockResolvedValueOnce({ path: '/session.jsonl' });
    sessions.resumeSession.mockResolvedValueOnce({ sessionId: 'resumed' });
    expect(await internal.ensureSession('chat', config())).toMatchObject({ sessionId: 'resumed' });

    internal.deleteSessionMapping('chat');
    sessions.createSession.mockResolvedValueOnce({ session: { sessionId: 'new' } });
    expect(await internal.ensureSession('chat', config())).toMatchObject({ sessionId: 'new' });
    expect(internal.getMappedSessionId('chat')).toBe('new');
    db.close();
  });

  it('sends messages with cached context and validates provider errors', async () => {
    const { db, internal } = createService();
    internal.saveContextToken('bot-account', 'u', 'ctx');
    const request = vi.spyOn(internal, 'weixinJsonRequest')
      .mockResolvedValueOnce({ ret: 0 })
      .mockResolvedValueOnce({ ret: 1, errmsg: 'nope' })
      .mockResolvedValueOnce({ ret: 0, typing_ticket: 'ticket' })
      .mockResolvedValueOnce({ ret: 0 });
    await internal.sendMessage(config(), 'u', { item_list: [] });
    expect((request.mock.calls[0][2] as { msg: { context_token: string } }).msg.context_token).toBe('ctx');
    await expect(internal.sendMessage(config(), 'u', {})).rejects.toThrow('nope');
    expect(await internal.getTypingTicket(config(), 'u')).toBe('ticket');
    expect(await internal.getTypingTicket(config(), 'u')).toBe('ticket');
    await internal.sendTypingIndicator(config(), 'u', 1);
    db.close();
  });

  it('performs pairing requests and records expired QR state', async () => {
    const { db, service, internal } = createService();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ qrcode: 'qr', qrcode_img_content: 'scan' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'expired' }), { status: 200 })));
    const state = await service.beginPairing();
    expect(state).toMatchObject({ status: 'waiting', qrcode: 'qr', scanUrl: 'scan' });
    expect(await service.beginPairing()).toBe(state);
    await internal.pairingPromise;
    expect(service.getPairing()).toMatchObject({ status: 'expired' });
    db.close();
  });

  it('formats profiles, status, folders, skillsets, and missing presets', async () => {
    const { db, internal, sessions } = createService();
    const preset = internal.presetStore.create({ username: 'u', name: 'Tools', mode: 'enabled', skills: [] });
    expect(await internal.formatProfiles('work')).toContain('* work');
    expect(internal.formatCwdChoices(config({ cwdChoices: [] }))).toBe('No gateway folders configured.');
    expect(internal.formatCwdChoices(config())).toBe('1: /tmp');
    expect(internal.formatSkillsets(preset.id)).toContain('* Tools');
    expect(internal.formatSkillsetName()).toBe('all');
    expect(internal.formatSkillsetName(preset.id)).toBe('Tools (enabled)');
    expect(internal.formatSkillsetName('missing')).toContain('unknown preset');
    sessions.getSession.mockReturnValue({ sessionId: 's', model: { provider: 'live', id: 'model' } });
    expect(await internal.formatStatus('chat', config(), 'Updated')).toContain('active (s)');
    db.close();
  });

  it('handles messages that lack folders, contain image failures, or fail validation', async () => {
    const { db, internal } = createService();
    const sendReply = vi.spyOn(internal, 'sendReply').mockResolvedValue(undefined);
    vi.spyOn(internal, 'handleCommand').mockResolvedValue(false);
    await internal.processMessage('chat', message('hello'), config({ defaultCwd: undefined, cwdChoices: [] }));
    await internal.processMessage('chat', message('', { imageError: 'bad image' }), config());
    expect(sendReply).toHaveBeenNthCalledWith(1, expect.anything(), 'user-1', expect.stringContaining('No gateway folders'));
    expect(sendReply).toHaveBeenNthCalledWith(2, expect.anything(), 'user-1', 'bad image');
    db.close();
  });

  it('extracts varied image candidate forms and reports unsupported media', async () => {
    const { db, internal } = createService();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const direct = await internal.extractImages(config(), [
      { type: 2, image_item: { base64: png, type_name: 'png' } },
      { nested: { preview_image: { image_base64: png, content_type: 'jpg; charset=x' } } },
    ]);
    expect(direct.images).toHaveLength(2);
    expect((await internal.extractImages(config(), [{ type: 9, video_item: { value: 1 } }])).images).toEqual([]);
    const failed = await internal.extractImages(config(), [{ type: 2, image_item: { base64: 'AAAA', mime_type: 'image/png' } }]);
    expect(failed.images[0].mimeType).toBe('image/png');
    db.close();
  });

  it('performs GET and JSON requests and surfaces HTTP errors', async () => {
    const { db, internal } = createService();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('get failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ret: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('post failed', { status: 502 })));
    await expect(internal.weixinGet('path', 'https://base///', 10)).resolves.toEqual({ ok: true });
    await expect(internal.weixinGet('path', 'https://base', 10)).rejects.toThrow('HTTP 500');
    await expect(internal.weixinJsonRequest(config(), 'post', { value: 1 }, 10)).resolves.toEqual({ ret: 0 });
    await expect(internal.weixinJsonRequest(config(), 'post', {}, 10)).rejects.toThrow('HTTP 502');
    db.close();
  });

  it('handles missing and failed typing tickets', async () => {
    const { db, internal } = createService();
    vi.spyOn(internal, 'weixinJsonRequest')
      .mockResolvedValueOnce({ ret: 0 })
      .mockResolvedValueOnce({ ret: 1, msg: 'denied' })
      .mockResolvedValueOnce({ ret: 1, errmsg: 'typing denied' });
    await expect(internal.sendTypingIndicator(config(), 'none', 1)).resolves.toBeUndefined();
    await expect(internal.getTypingTicket(config(), 'bad')).rejects.toThrow('denied');
    internal.typingTickets.set('bot-account:bad-send', 'ticket');
    await expect(internal.sendTypingIndicator(config(), 'bad-send', 1)).rejects.toThrow('typing denied');
    db.close();
  });
});
