import { createDecipheriv, createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { PiCloudDatabase } from '../db/database.js';
import { GATEWAY_COMMON_ALIAS_HELP, normalizeGatewayCommandText } from './gateway-command-aliases.js';
import { GatewaySettingsStore } from './gateway-settings-store.js';
import type { PiSessionService } from './session-manager.js';
import { SkillPresetStore, type SkillPresetRecord } from './skill-preset-store.js';

interface FeishuGatewayConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  domain: 'feishu' | 'lark';
  defaultCwd?: string;
  cwdChoices: string[];
  agentProfile?: string;
  modelProvider?: string;
  modelId?: string;
  skillMode?: 'all' | 'enabled' | 'disabled';
  skillPresetId?: string | null;
}

interface FeishuChatConfig {
  agentProfile?: string;
  defaultCwd?: string;
  skillMode?: 'all' | 'enabled' | 'disabled';
  skillPresetId?: string | null;
}

interface FeishuMessagePayload {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: string;
  threadId?: string;
  text: string;
}

interface FeishuTokenCache {
  token: string;
  expiresAt: number;
}

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const NO_GATEWAY_FOLDERS_MESSAGE = 'No gateway folders configured.';
const GATEWAY_FOLDERS_REQUIRED_MESSAGE = `${NO_GATEWAY_FOLDERS_MESSAGE} Add at least one allowed folder in Web UI Settings > Gateway.`;

export class FeishuGatewayService {
  private readonly presetStore: SkillPresetStore;
  private readonly gatewaySettings: GatewaySettingsStore;
  private readonly seen = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private tokenCache?: FeishuTokenCache;

  constructor(
    private readonly db: PiCloudDatabase,
    gatewaySettings: GatewaySettingsStore | undefined,
    private readonly sessionService: PiSessionService,
  ) {
    this.presetStore = new SkillPresetStore(db);
    this.gatewaySettings = gatewaySettings || new GatewaySettingsStore(db);
  }

  async handleCallback(body: unknown): Promise<Record<string, unknown>> {
    const rawPayload = asRecord(body);
    const config = this.loadConfig();
    if (!this.isConfigured(config)) {
      const error = new Error('Feishu gateway is not configured');
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }

    const payload = this.decryptPayload(rawPayload, config);

    this.verifyToken(payload, config);

    if (payload.type === 'url_verification') {
      return { challenge: stringValue(payload.challenge) };
    }

    const message = this.parseMessage(payload);
    if (!message) return { ok: true, ignored: true };
    if (this.markDuplicate(message.eventId) || this.markDuplicate(message.messageId)) {
      return { ok: true, duplicate: true };
    }

    this.enqueue(message, config);
    return { ok: true };
  }

  private loadConfig(): FeishuGatewayConfig {
    const domain = (process.env.PI_CLOUD_FEISHU_DOMAIN || 'feishu').trim().toLowerCase();
    const gatewaySettings = this.gatewaySettings.get();
    const cwdChoices = gatewaySettings.cwds;
    return {
      appId: process.env.PI_CLOUD_FEISHU_APP_ID?.trim() || '',
      appSecret: process.env.PI_CLOUD_FEISHU_APP_SECRET?.trim() || '',
      verificationToken: process.env.PI_CLOUD_FEISHU_VERIFICATION_TOKEN?.trim() || '',
      encryptKey: process.env.PI_CLOUD_FEISHU_ENCRYPT_KEY?.trim() || '',
      domain: domain === 'lark' ? 'lark' : 'feishu',
      defaultCwd: cwdChoices[0],
      cwdChoices,
      agentProfile: gatewaySettings.defaultProfile,
      modelProvider: gatewaySettings.defaultModelProvider,
      modelId: gatewaySettings.defaultModelId,
      ...this.resolveSkillsetConfig(gatewaySettings.defaultSkillset),
    };
  }

  private isConfigured(config: FeishuGatewayConfig): boolean {
    return Boolean(config.appId && config.appSecret && config.verificationToken);
  }

  private decryptPayload(payload: Record<string, unknown>, config: FeishuGatewayConfig): Record<string, unknown> {
    const encrypted = stringValue(payload.encrypt);
    if (!encrypted) return payload;
    if (!config.encryptKey) {
      console.warn('[feishu-gateway] received encrypted callback payload but PI_CLOUD_FEISHU_ENCRYPT_KEY is not configured');
      const error = new Error('Feishu encrypted callback requires PI_CLOUD_FEISHU_ENCRYPT_KEY');
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }

    try {
      const decrypted = decryptFeishuPayload(encrypted, config.encryptKey);
      const parsed = JSON.parse(decrypted) as unknown;
      const result = asRecord(parsed);
      if (Object.keys(result).length === 0) throw new Error('decrypted payload is not an object');
      console.info('[feishu-gateway] decrypted encrypted callback payload', {
        bodyType: stringValue(result.type) || undefined,
        bodyKeys: Object.keys(result).sort(),
      });
      return result;
    } catch (error) {
      console.warn('[feishu-gateway] failed to decrypt encrypted callback payload', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      const gatewayError = new Error('Invalid Feishu encrypted callback payload');
      (gatewayError as Error & { statusCode?: number }).statusCode = 400;
      throw gatewayError;
    }
  }

  private verifyToken(payload: Record<string, unknown>, config: FeishuGatewayConfig): void {
    if (!config.verificationToken) return;
    const token = stringValue(payload.token) || stringValue(asRecord(payload.header).token);
    if (token === config.verificationToken) return;
    console.warn('[feishu-gateway] verification token mismatch', {
      encrypted: typeof payload.encrypt === 'string',
      bodyType: stringValue(payload.type) || undefined,
      hasBodyToken: typeof payload.token === 'string',
      hasHeaderToken: typeof asRecord(payload.header).token === 'string',
      bodyKeys: Object.keys(payload).sort(),
    });
    const error = new Error('Invalid Feishu verification token');
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }

  private parseMessage(payload: Record<string, unknown>): FeishuMessagePayload | null {
    const header = asRecord(payload.header);
    const event = asRecord(payload.event);
    const eventType = stringValue(header.event_type);
    if (eventType && eventType !== 'im.message.receive_v1') return null;

    const message = asRecord(event.message);
    const messageType = stringValue(message.message_type);
    if (messageType && messageType !== 'text') {
      logUnsupportedFeishuMessage(message, messageType);
      return null;
    }

    const text = parseFeishuTextContent(stringValue(message.content)).trim();
    const chatId = stringValue(message.chat_id);
    const messageId = stringValue(message.message_id);
    if (!text || !chatId || !messageId) return null;

    return {
      eventId: stringValue(header.event_id) || messageId,
      messageId,
      chatId,
      chatType: stringValue(message.chat_type) || 'p2p',
      threadId: stringValue(message.thread_id) || stringValue(message.parent_id) || stringValue(message.root_id),
      text,
    };
  }

  private markDuplicate(id: string): boolean {
    if (!id) return false;
    const now = Date.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
    if (this.seen.has(id)) return true;
    this.seen.set(id, now + DEDUP_TTL_MS);
    return false;
  }

  private enqueue(message: FeishuMessagePayload, config: FeishuGatewayConfig): void {
    const clientId = this.clientIdForMessage(message);
    const previous = this.queues.get(clientId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.processMessage(clientId, message, config))
      .catch((error) => console.error('[feishu-gateway] message handling failed:', error))
      .finally(() => {
        if (this.queues.get(clientId) === next) this.queues.delete(clientId);
      });
    this.queues.set(clientId, next);
  }

  private clientIdForMessage(message: FeishuMessagePayload): string {
    const chatType = message.chatType === 'p2p' ? 'dm' : message.chatType || 'chat';
    const thread = message.threadId ? `:${message.threadId}` : '';
    return `feishu:${chatType}:${message.chatId}${thread}`;
  }

  private async processMessage(clientId: string, message: FeishuMessagePayload, config: FeishuGatewayConfig): Promise<void> {
    const effectiveConfig = this.resolveChatConfig(clientId, config);
    if (await this.handleCommand(clientId, message, config, effectiveConfig)) return;
    if (!effectiveConfig.defaultCwd) {
      await this.sendReply(config, message.messageId, GATEWAY_FOLDERS_REQUIRED_MESSAGE);
      return;
    }

    const session = await this.ensureSession(clientId, effectiveConfig);
    const chunks: string[] = [];
    const unsubscribe = session.subscribe((event: any) => {
      if (event?.type !== 'message_update') return;
      const update = event.assistantMessageEvent;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        chunks.push(update.delta);
      }
    });

    try {
      await this.sessionService.runForegroundWithClientProfileProxy(clientId, async () => {
        await session.prompt(message.text);
      });
    } finally {
      unsubscribe();
    }

    const response = chunks.join('').trim() || extractLastAssistantText(session.messages) || '(Pi finished without a text response.)';
    await this.sendReply(config, message.messageId, response);
  }

  private async ensureSession(clientId: string, config: FeishuGatewayConfig) {
    await this.sessionService.setClientAgentProfile(clientId, config.agentProfile || 'default');

    const active = this.sessionService.getSession(clientId);
    if (active) return active;

    const mappedSessionId = this.getMappedSessionId(clientId);
    if (mappedSessionId) {
      const persisted = await this.sessionService.findPersistedSession(clientId, mappedSessionId);
      if (persisted) return this.sessionService.resumeSession(clientId, persisted.path);
    }

    const result = await this.sessionService.createSession(clientId, await this.createSessionOptions(config));
    this.saveSessionMapping(clientId, result.session.sessionId);
    return result.session;
  }

  private async handleCommand(clientId: string, message: FeishuMessagePayload, baseConfig: FeishuGatewayConfig, effectiveConfig: FeishuGatewayConfig): Promise<boolean> {
    const commandText = normalizeGatewayCommandText(message.text);
    const [command = '', ...args] = commandText.split(/\s+/);
    const normalized = command.toLowerCase();
    if (!normalized.startsWith('/')) return false;

    try {
      if (normalized === '/new' || normalized === '/reset') {
        this.resetSession(clientId);
        await this.sendReply(
          baseConfig,
          message.messageId,
          await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Reset this Feishu chat. A fresh Pi session will start with your next message.'),
        );
        return true;
      }
      if (normalized === '/help') {
        await this.sendReply(baseConfig, message.messageId, this.formatHelp());
        return true;
      }
      if (normalized === '/status') {
        await this.sendReply(baseConfig, message.messageId, await this.formatStatus(clientId, effectiveConfig));
        return true;
      }
      if (normalized === '/profiles') {
        await this.sendReply(baseConfig, message.messageId, await this.formatProfiles(effectiveConfig.agentProfile || 'default'));
        return true;
      }
      if (normalized === '/profile' || normalized === '/use-profile' || normalized === '/set-profile') {
        await this.setChatProfile(clientId, args[0]);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.messageId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Profile updated.'));
        return true;
      }
      if (normalized === '/cwds' || normalized === '/pwds') {
        await this.sendReply(baseConfig, message.messageId, this.formatCwdChoices(baseConfig));
        return true;
      }
      if (normalized === '/cwd') {
        if (args.length === 0) {
          await this.sendReply(baseConfig, message.messageId, effectiveConfig.defaultCwd || NO_GATEWAY_FOLDERS_MESSAGE);
          return true;
        }
        await this.setChatCwd(clientId, args[0], baseConfig);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.messageId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Working directory updated.'));
        return true;
      }
      if (normalized === '/skillsets') {
        await this.sendReply(baseConfig, message.messageId, this.formatSkillsets(effectiveConfig.skillPresetId));
        return true;
      }
      if (normalized === '/skillset') {
        await this.setChatSkillset(clientId, args.join(' '));
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.messageId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Skillset updated.'));
        return true;
      }
      if (normalized === '/clear-config') {
        this.clearChatConfig(clientId);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.messageId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Feishu chat config cleared.'));
        return true;
      }
    } catch (error) {
      await this.sendReply(baseConfig, message.messageId, `Command failed: ${error instanceof Error ? error.message : 'unknown error'}\n\n${this.formatHelp()}`);
      return true;
    }

    await this.sendReply(baseConfig, message.messageId, `Unknown command: ${command}\n\n${this.formatHelp()}`);
    return true;
  }

  private resolveChatConfig(clientId: string, base: FeishuGatewayConfig): FeishuGatewayConfig {
    const chat = this.getChatConfig(clientId);
    const chatProfile = chat.agentProfile || base.agentProfile;
    const useBaseModel = !chat.agentProfile || chat.agentProfile === base.agentProfile;
    const chatCwd = chat.defaultCwd && base.cwdChoices.includes(chat.defaultCwd) ? chat.defaultCwd : undefined;
    return {
      ...base,
      agentProfile: chatProfile,
      modelProvider: useBaseModel ? base.modelProvider : undefined,
      modelId: useBaseModel ? base.modelId : undefined,
      defaultCwd: chatCwd || base.defaultCwd,
      skillMode: chat.skillMode || base.skillMode || 'all',
      skillPresetId: chat.skillPresetId === null ? undefined : chat.skillPresetId || base.skillPresetId,
    };
  }

  private async createSessionOptions(config: FeishuGatewayConfig) {
    const preset = config.skillPresetId ? this.presetStore.getById(config.skillPresetId) : null;
    return {
      cwd: config.defaultCwd,
      modelProvider: config.modelProvider,
      modelId: config.modelId,
      enabledSkills: preset?.mode === 'enabled' ? preset.skills : undefined,
      disabledSkills: preset?.mode === 'disabled' ? preset.skills : undefined,
      presetId: preset?.id,
      skillMode: preset?.mode || config.skillMode || 'all',
    };
  }

  private getChatConfig(clientId: string): FeishuChatConfig {
    const row = this.db.prepare('SELECT * FROM feishu_gateway_configs WHERE client_id = ?').get(clientId) as {
      agent_profile: string | null;
      default_cwd: string | null;
      skill_mode: FeishuChatConfig['skillMode'] | null;
      skill_preset_id: string | null;
    } | undefined;
    return row ? {
      agentProfile: row.agent_profile || undefined,
      defaultCwd: row.default_cwd || undefined,
      skillMode: row.skill_mode || undefined,
      skillPresetId: row.skill_preset_id || undefined,
    } : {};
  }

  private saveChatConfig(clientId: string, patch: FeishuChatConfig): void {
    const current = this.getChatConfig(clientId);
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO feishu_gateway_configs (client_id, agent_profile, default_cwd, skill_mode, skill_preset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        agent_profile = excluded.agent_profile,
        default_cwd = excluded.default_cwd,
        skill_mode = excluded.skill_mode,
        skill_preset_id = excluded.skill_preset_id,
        updated_at = excluded.updated_at
    `).run(clientId, next.agentProfile || null, next.defaultCwd || null, next.skillMode || null, next.skillPresetId || null, now, now);
  }

  private clearChatConfig(clientId: string): void {
    this.db.prepare('DELETE FROM feishu_gateway_configs WHERE client_id = ?').run(clientId);
  }

  private resetSession(clientId: string): void {
    this.sessionService.disposeSession(clientId);
    this.deleteSessionMapping(clientId);
  }

  private async setChatProfile(clientId: string, profileId?: string): Promise<void> {
    const profile = profileId?.trim();
    if (!profile) throw new Error('Usage: /profile <profile-id>');
    const profiles = await this.sessionService.listAgentProfiles();
    if (!profiles.some((item) => item.id === profile)) throw new Error(`Unknown profile: ${profile}`);
    this.saveChatConfig(clientId, { agentProfile: profile });
  }

  private async setChatCwd(clientId: string, slotText: string, config: FeishuGatewayConfig): Promise<void> {
    if (!config.cwdChoices.length) throw new Error('No Feishu CWD choices are configured in Web UI settings');
    const slot = Number(slotText.trim());
    if (!Number.isInteger(slot) || slot < 1 || slot > config.cwdChoices.length) throw new Error(`Usage: /cwd <1-${config.cwdChoices.length}>`);
    const target = config.cwdChoices[slot - 1];
    if (!isAbsolute(target)) throw new Error(`Configured CWD ${slot} must be an absolute path`);
    const info = await stat(target);
    if (!info.isDirectory()) throw new Error(`Configured CWD ${slot} must be an existing directory`);
    this.saveChatConfig(clientId, { defaultCwd: target });
  }

  private async setChatSkillset(clientId: string, skillset: string): Promise<void> {
    const selected = skillset.trim();
    if (!selected) throw new Error('Usage: /skillset <all|preset-name>');
    this.saveChatConfig(clientId, this.resolveSkillsetConfig(selected, true));
  }

  private async formatStatus(clientId: string, config: FeishuGatewayConfig, prefix?: string): Promise<string> {
    const profiles = await this.sessionService.listAgentProfiles();
    const profile = profiles.find((item) => item.id === (config.agentProfile || 'default')) || profiles[0];
    const active = this.sessionService.getSession(clientId);
    return [
      prefix,
      'Pi session status',
      '',
      `- Profile: ${profile?.id || 'default'}`,
      `- CWD: ${config.defaultCwd || '(not configured)'}`,
      `- Provider: ${active?.model?.provider || config.modelProvider || profile?.defaultProvider || '(profile default)'}`,
      `- Model: ${active?.model?.id || config.modelId || profile?.defaultModel || '(profile default)'}`,
      `- Skillset: ${this.formatSkillsetName(config.skillPresetId)}`,
      `- Session: ${active ? `active (${active.sessionId})` : 'not started'}`,
    ].filter((line) => line !== undefined).join('\n');
  }

  private async formatProfiles(currentProfile: string): Promise<string> {
    const profiles = await this.sessionService.listAgentProfiles();
    return ['Available profiles:', ...profiles.map((profile) => `${profile.id === currentProfile ? '*' : ' '} ${profile.id}`)].join('\n');
  }

  private resolveSkillsetConfig(skillset?: string, strict = false): FeishuChatConfig {
    const selected = skillset?.trim();
    if (!selected || selected.toLowerCase() === 'all') return { skillMode: 'all', skillPresetId: null };

    const preset = this.findSkillPreset(selected);
    if (preset) return { skillMode: preset.mode, skillPresetId: preset.id };
    if (strict) throw new Error(`Unknown skillset: ${selected}`);
    console.warn('[feishu-gateway] default gateway skillset was not found; using all skills', { skillset: selected });
    return { skillMode: 'all', skillPresetId: null };
  }

  private formatCwdChoices(config: FeishuGatewayConfig): string {
    if (!config.cwdChoices.length) return NO_GATEWAY_FOLDERS_MESSAGE;
    return config.cwdChoices.map((cwd, index) => `${index + 1}: ${cwd}`).join('\n');
  }

  private formatSkillsets(currentPresetId?: string | null): string {
    const presets = this.presetStore.list();
    return [
      'Available skillsets:',
      `${currentPresetId ? ' ' : '*'} all - use all skills`,
      ...presets.map((preset) => `${preset.id === currentPresetId ? '*' : ' '} ${preset.name} (${preset.mode}: ${preset.skills.join(', ') || 'none'})`),
    ].join('\n');
  }

  private formatSkillsetName(presetId?: string | null): string {
    if (!presetId) return 'all';
    const preset = this.presetStore.getById(presetId);
    return preset ? `${preset.name} (${preset.mode})` : `unknown preset (${presetId})`;
  }

  private findSkillPreset(nameOrId: string): SkillPresetRecord | null {
    const normalized = nameOrId.trim().toLowerCase();
    return this.presetStore.list().find((preset) => (
      preset.id === nameOrId || preset.name.toLowerCase() === normalized
    )) || null;
  }

  private formatHelp(): string {
    return [
      'Pi Feishu commands:',
      '- /status - show current profile, CWD, provider, model, skillset, and session',
      '- /profiles - list available profiles',
      '- /profile <profile-id> - switch profile and start a fresh session',
      '- /cwds or /pwds - list Web-configured working directories',
      '- /cwd [number] - show or switch to a listed working directory',
      '- /skillsets - list Web-configured skillsets',
      '- /skillset <all|preset-name> - switch skillset and start a fresh session',
      '- /reset or /new - start a fresh session with current config',
      '- /clear-config - return this chat to gateway environment defaults',
      '',
      ...GATEWAY_COMMON_ALIAS_HELP,
    ].join('\n');
  }

  private getMappedSessionId(clientId: string): string | undefined {
    const row = this.db.prepare('SELECT pi_session_id FROM feishu_gateway_sessions WHERE client_id = ?').get(clientId) as { pi_session_id: string } | undefined;
    return row?.pi_session_id;
  }

  private saveSessionMapping(clientId: string, sessionId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO feishu_gateway_sessions (session_key, client_id, pi_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET pi_session_id = excluded.pi_session_id, updated_at = excluded.updated_at
    `).run(clientId, clientId, sessionId, now, now);
  }

  private deleteSessionMapping(clientId: string): void {
    this.db.prepare('DELETE FROM feishu_gateway_sessions WHERE client_id = ?').run(clientId);
  }

  private async sendReply(config: FeishuGatewayConfig, messageId: string, text: string): Promise<void> {
    const token = await this.getTenantAccessToken(config);
    const endpoint = `${this.baseUrl(config)}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`;
    await feishuJsonRequest(endpoint, token, {
      msg_type: 'text',
      content: JSON.stringify({ text: truncateFeishuText(text) }),
    });
  }

  private async getTenantAccessToken(config: FeishuGatewayConfig): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
      return this.tokenCache.token;
    }

    const response = await fetch(`${this.baseUrl(config)}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || Number(data.code) !== 0 || typeof data.tenant_access_token !== 'string') {
      throw new Error(`Failed to get Feishu tenant token: ${stringValue(data.msg) || response.statusText}`);
    }

    const expiresInSeconds = Number(data.expire) || 7200;
    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: now + expiresInSeconds * 1000,
    };
    return this.tokenCache.token;
  }

  private baseUrl(config: FeishuGatewayConfig): string {
    return config.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
  }
}

async function feishuJsonRequest(url: string, token: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || Number(data.code) !== 0) {
    throw new Error(`Feishu API request failed: ${stringValue(data.msg) || response.statusText}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decryptFeishuPayload(encrypted: string, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, encryptedBuffer.subarray(0, 16));
  return Buffer.concat([
    decipher.update(encryptedBuffer.subarray(16)),
    decipher.final(),
  ]).toString('utf8');
}

function parseFeishuTextContent(content: string): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return content;
  }
}

function logUnsupportedFeishuMessage(message: Record<string, unknown>, messageType: string): void {
  const content = parseJsonRecord(stringValue(message.content));
  console.info('[feishu-gateway] unsupported inbound message', {
    messageType,
    messageId: stringValue(message.message_id) || undefined,
    chatType: stringValue(message.chat_type) || undefined,
    messageKeys: Object.keys(message).sort(),
    contentKeys: Object.keys(content).sort(),
    contentStringFields: Object.fromEntries(
      Object.entries(content)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, (value as string).length]),
    ),
  });
}

function parseJsonRecord(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function truncateFeishuText(text: string): string {
  const limit = 8000;
  return text.length > limit ? `${text.slice(0, limit - 40)}\n\n[truncated by Pi Cloud]` : text;
}

function extractLastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as any;
    if (message?.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((part) => typeof part === 'string' ? part : part?.text || part?.content || '')
        .join('')
        .trim();
      if (text) return text;
    }
  }
  return '';
}
