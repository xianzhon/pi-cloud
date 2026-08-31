import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { PiCloudDatabase } from '../db/database.js';
import { GATEWAY_COMMON_ALIAS_HELP, normalizeGatewayCommandText } from './gateway-command-aliases.js';
import { GatewaySettingsStore } from './gateway-settings-store.js';
import { MAX_IMAGE_BYTES, sniffImageMimeType, validateImages } from './image-input.js';
import type { PiSessionService } from './session-manager.js';
import { SkillPresetStore, type SkillPresetRecord } from './skill-preset-store.js';
import { decryptWecomPayload, verifyWecomSignature } from './wecom-crypto.js';

interface WecomGatewayConfig {
  corpId: string;
  corpSecret: string;
  agentId: string;
  callbackToken: string;
  encodingAesKey: string;
  allowedUsers: string[];
  defaultCwd?: string;
  cwdChoices: string[];
  agentProfile?: string;
  modelProvider?: string;
  modelId?: string;
  skillMode?: 'all' | 'enabled' | 'disabled';
  skillPresetId?: string | null;
}

interface WecomChatConfig {
  agentProfile?: string;
  defaultCwd?: string;
  skillMode?: 'all' | 'enabled' | 'disabled';
  skillPresetId?: string | null;
}

interface WecomCallbackQuery {
  msg_signature?: unknown;
  timestamp?: unknown;
  nonce?: unknown;
  echostr?: unknown;
}

interface WecomMessagePayload {
  messageId: string;
  userId: string;
  text: string;
  messageType: string;
  mediaId?: string;
  picUrl?: string;
}

interface WecomTokenCache {
  token: string;
  expiresAt: number;
}

interface SaveWecomConfigurationInput {
  corpId: string;
  corpSecret: string;
  agentId: string;
  allowedUsers: string[];
}

interface WecomGatewayStatus {
  configured: boolean;
  managedBy: 'database' | 'environment' | 'none';
  corpId?: string;
  agentId?: string;
  allowedUsers: string[];
  callbackVerified: boolean;
}

interface SavedWecomCredentials {
  corpId: string;
  corpSecret: string;
  agentId: string;
  callbackToken: string;
  encodingAesKey: string;
  allowedUsers: string[];
  callbackVerified: boolean;
}

const WECOM_API_BASE_URL = 'https://qyapi.weixin.qq.com';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEDUP_TTL_MS = 5 * 60 * 1000;
const TEXT_CHUNK_MAX_BYTES = 1900;
function generateEncodingAesKey(): string {
  while (true) {
    const key = randomBytes(32).toString('base64').slice(0, 43);
    if (/^[A-Za-z0-9]+$/.test(key)) return key;
  }
}

export class WecomGatewayService {
  private readonly gatewaySettings: GatewaySettingsStore;
  private readonly presetStore: SkillPresetStore;
  private readonly seen = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private tokenCache?: WecomTokenCache;
  private environmentCallbackVerified = false;

  constructor(
    private readonly db: PiCloudDatabase,
    gatewaySettings: GatewaySettingsStore | undefined,
    private readonly sessionService: PiSessionService,
  ) {
    this.gatewaySettings = gatewaySettings || new GatewaySettingsStore(db);
    this.presetStore = new SkillPresetStore(db);
  }

  status(): WecomGatewayStatus {
    const config = this.loadConfig();
    const managedBy = this.isEnvironmentManaged() ? 'environment' : this.loadSavedCredentials() ? 'database' : 'none';
    return {
      configured: Boolean(config.corpId && config.corpSecret && config.agentId && config.callbackToken && config.encodingAesKey),
      managedBy,
      ...(config.corpId ? { corpId: config.corpId } : {}),
      ...(config.agentId ? { agentId: config.agentId } : {}),
      allowedUsers: config.allowedUsers,
      callbackVerified: managedBy === 'database' ? Boolean(this.loadSavedCredentials()?.callbackVerified) : this.environmentCallbackVerified,
    };
  }

  saveConfiguration(input: SaveWecomConfigurationInput): { status: WecomGatewayStatus; callbackToken: string; encodingAesKey: string } {
    if (this.isEnvironmentManaged()) throw new Error('WeCom credentials are managed by environment variables');
    const corpId = input.corpId.trim();
    const corpSecret = input.corpSecret.trim();
    const agentId = input.agentId.trim();
    if (!corpId || !corpSecret || !/^\d+$/.test(agentId)) throw new Error('Corp ID, app secret, and a numeric Agent ID are required');
    const allowedUsers = normalizeList(input.allowedUsers);
    const existing = this.loadSavedCredentials();
    const callbackToken = existing?.callbackToken || randomBytes(16).toString('hex');
    const encodingAesKey = existing?.encodingAesKey || generateEncodingAesKey();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO wecom_gateway_credentials (
        id, corp_id, corp_secret, agent_id, callback_token, encoding_aes_key,
        allowed_users_json, callback_verified_at, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        corp_id = excluded.corp_id,
        corp_secret = excluded.corp_secret,
        agent_id = excluded.agent_id,
        callback_token = excluded.callback_token,
        encoding_aes_key = excluded.encoding_aes_key,
        allowed_users_json = excluded.allowed_users_json,
        callback_verified_at = NULL,
        updated_at = excluded.updated_at
    `).run(corpId, corpSecret, agentId, callbackToken, encodingAesKey, JSON.stringify(allowedUsers), now, now);
    this.tokenCache = undefined;
    return { status: this.status(), callbackToken, encodingAesKey };
  }

  regenerateCallbackSecrets(): { status: WecomGatewayStatus; callbackToken: string; encodingAesKey: string } {
    if (this.isEnvironmentManaged()) throw new Error('WeCom credentials are managed by environment variables');
    const saved = this.loadSavedCredentials();
    if (!saved) throw new Error('Save the WeCom configuration first');
    const callbackToken = randomBytes(16).toString('hex');
    const encodingAesKey = generateEncodingAesKey();
    this.db.prepare(`
      UPDATE wecom_gateway_credentials
      SET callback_token = ?, encoding_aes_key = ?, callback_verified_at = NULL, updated_at = ?
      WHERE id = 1
    `).run(callbackToken, encodingAesKey, new Date().toISOString());
    return { status: this.status(), callbackToken, encodingAesKey };
  }

  disconnect(): void {
    if (this.isEnvironmentManaged()) throw new Error('WeCom credentials are managed by environment variables');
    const clients = this.db.prepare('SELECT client_id FROM wecom_gateway_sessions').all() as Array<{ client_id: string }>;
    for (const { client_id: clientId } of clients) this.sessionService.disposeSession(clientId);
    this.db.exec('DELETE FROM wecom_gateway_sessions; DELETE FROM wecom_gateway_configs; DELETE FROM wecom_gateway_credentials;');
    this.tokenCache = undefined;
  }

  async testConnection(): Promise<WecomGatewayStatus> {
    const config = this.requireConfig();
    this.tokenCache = undefined;
    await this.getAccessToken(config);
    return this.status();
  }

  handleVerification(query: WecomCallbackQuery): string {
    const config = this.requireConfig();
    const encrypted = stringValue(query.echostr);
    this.verifySignature(query, encrypted, config);
    const challenge = decryptWecomPayload(encrypted, config.encodingAesKey, config.corpId);
    this.markCallbackVerified();
    return challenge;
  }

  handleCallback(query: WecomCallbackQuery, body: string): string {
    const config = this.requireConfig();
    const encrypted = xmlValue(body, 'Encrypt');
    if (!encrypted) throw gatewayError('Invalid WeCom callback envelope', 400);
    this.verifySignature(query, encrypted, config);

    const message = parseWecomMessage(decryptWecomPayload(encrypted, config.encodingAesKey, config.corpId));
    this.markCallbackVerified();
    if (!message || message.agentId !== config.agentId) return 'success';
    if (config.allowedUsers.length && !config.allowedUsers.includes(message.userId)) return 'success';
    if (this.markDuplicate(message.messageId)) return 'success';

    if (message.messageType !== 'text' && message.messageType !== 'image') {
      void this.sendReply(config, message.userId, 'This WeCom gateway supports text and image messages only.').catch((error) => {
        console.warn('[wecom-gateway] unsupported-message reply failed:', error instanceof Error ? error.message : error);
      });
      return 'success';
    }

    this.enqueue({
      messageId: message.messageId,
      userId: message.userId,
      text: message.text,
      messageType: message.messageType,
      mediaId: message.mediaId,
      picUrl: message.picUrl,
    }, config);
    return 'success';
  }

  private verifySignature(query: WecomCallbackQuery, encrypted: string, config: WecomGatewayConfig): void {
    const valid = encrypted && verifyWecomSignature({
      token: config.callbackToken,
      timestamp: stringValue(query.timestamp),
      nonce: stringValue(query.nonce),
      encrypted,
      signature: stringValue(query.msg_signature),
    });
    if (!valid) throw gatewayError('Invalid WeCom callback signature', 401);
  }

  private requireConfig(): WecomGatewayConfig {
    const config = this.loadConfig();
    if (!config.corpId || !config.corpSecret || !config.agentId || !config.callbackToken || !config.encodingAesKey) {
      throw gatewayError('WeCom gateway is not configured', 503);
    }
    return config;
  }

  private loadConfig(): WecomGatewayConfig {
    const gatewaySettings = this.gatewaySettings.get();
    const saved = this.loadSavedCredentials();
    const skillset = this.resolveSkillsetConfig(gatewaySettings.defaultSkillset);
    return {
      corpId: process.env.PI_CLOUD_WECOM_CORP_ID?.trim() || saved?.corpId || '',
      corpSecret: process.env.PI_CLOUD_WECOM_CORP_SECRET?.trim() || saved?.corpSecret || '',
      agentId: process.env.PI_CLOUD_WECOM_AGENT_ID?.trim() || saved?.agentId || '',
      callbackToken: process.env.PI_CLOUD_WECOM_CALLBACK_TOKEN?.trim() || saved?.callbackToken || '',
      encodingAesKey: process.env.PI_CLOUD_WECOM_ENCODING_AES_KEY?.trim() || saved?.encodingAesKey || '',
      allowedUsers: process.env.PI_CLOUD_WECOM_ALLOWED_USERS !== undefined
        ? parseList(process.env.PI_CLOUD_WECOM_ALLOWED_USERS)
        : saved?.allowedUsers || [],
      defaultCwd: gatewaySettings.cwds[0],
      cwdChoices: gatewaySettings.cwds,
      agentProfile: gatewaySettings.defaultProfile,
      modelProvider: gatewaySettings.defaultModelProvider,
      modelId: gatewaySettings.defaultModelId,
      ...skillset,
    };
  }

  private isEnvironmentManaged(): boolean {
    return [
      'PI_CLOUD_WECOM_CORP_ID',
      'PI_CLOUD_WECOM_CORP_SECRET',
      'PI_CLOUD_WECOM_AGENT_ID',
      'PI_CLOUD_WECOM_CALLBACK_TOKEN',
      'PI_CLOUD_WECOM_ENCODING_AES_KEY',
    ].some((key) => Boolean(process.env[key]?.trim()));
  }

  private loadSavedCredentials(): SavedWecomCredentials | null {
    const row = this.db.prepare(`
      SELECT corp_id, corp_secret, agent_id, callback_token, encoding_aes_key,
             allowed_users_json, callback_verified_at
      FROM wecom_gateway_credentials WHERE id = 1
    `).get() as {
      corp_id: string;
      corp_secret: string;
      agent_id: string;
      callback_token: string;
      encoding_aes_key: string;
      allowed_users_json: string;
      callback_verified_at: string | null;
    } | undefined;
    if (!row) return null;
    let allowedUsers: string[] = [];
    try { allowedUsers = normalizeList(JSON.parse(row.allowed_users_json)); } catch { /* use empty allowlist */ }
    return {
      corpId: row.corp_id,
      corpSecret: row.corp_secret,
      agentId: row.agent_id,
      callbackToken: row.callback_token,
      encodingAesKey: row.encoding_aes_key,
      allowedUsers,
      callbackVerified: Boolean(row.callback_verified_at),
    };
  }

  private markCallbackVerified(): void {
    if (this.isEnvironmentManaged()) {
      this.environmentCallbackVerified = true;
      return;
    }
    this.db.prepare('UPDATE wecom_gateway_credentials SET callback_verified_at = ?, updated_at = ? WHERE id = 1')
      .run(new Date().toISOString(), new Date().toISOString());
  }

  private markDuplicate(id: string): boolean {
    const now = Date.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
    if (this.seen.has(id)) return true;
    this.seen.set(id, now + DEDUP_TTL_MS);
    return false;
  }

  private enqueue(message: WecomMessagePayload, config: WecomGatewayConfig): void {
    const clientId = `wecom:dm:${message.userId}`;
    const previous = this.queues.get(clientId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.processMessage(clientId, message, config))
      .catch((error) => console.error('[wecom-gateway] message handling failed:', error))
      .finally(() => {
        if (this.queues.get(clientId) === next) this.queues.delete(clientId);
      });
    this.queues.set(clientId, next);
  }

  private async processMessage(clientId: string, message: WecomMessagePayload, config: WecomGatewayConfig): Promise<void> {
    const effectiveConfig = this.resolveChatConfig(clientId, config);
    if (await this.handleCommand(clientId, message, config, effectiveConfig)) return;
    if (!effectiveConfig.defaultCwd) {
      await this.sendReply(config, message.userId, 'No gateway folders configured. Add at least one allowed folder in Web UI Settings > Gateway.');
      return;
    }

    const session = await this.ensureSession(clientId, effectiveConfig);
    let images: ImageContent[] = [];
    if (message.messageType === 'image') {
      if (!message.mediaId) {
        await this.sendReply(config, message.userId, 'The WeCom image message did not include downloadable media. Try sending it again.');
        return;
      }
      try {
        images = [await this.downloadImage(config, message.mediaId)];
      } catch (error) {
        console.warn('[wecom-gateway] failed to download inbound image:', error instanceof Error ? error.message : error);
        await this.sendReply(config, message.userId, 'The image could not be downloaded from WeCom. Try sending it again.');
        return;
      }
    }
    const imageResult = validateImages(images, session.model);
    if (!imageResult.ok) {
      await this.sendReply(config, message.userId, imageResult.message);
      return;
    }

    const promptText = message.text || (imageResult.images.length ? 'Please analyze the attached image.' : '');
    const chunks: string[] = [];
    const unsubscribe = session.subscribe((event: any) => {
      const update = event?.type === 'message_update' ? event.assistantMessageEvent : undefined;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') chunks.push(update.delta);
    });
    try {
      await this.sessionService.runForegroundWithClientProfileProxy(clientId, () => (
        session.prompt(promptText, imageResult.images.length ? { images: imageResult.images } : undefined)
      ));
    } finally {
      unsubscribe();
    }
    const response = chunks.join('').trim() || extractLastAssistantText(session.messages) || '(Pi finished without a text response.)';
    await this.sendReply(config, message.userId, response);
  }

  private async ensureSession(clientId: string, config: WecomGatewayConfig) {
    await this.sessionService.setClientAgentProfile(clientId, config.agentProfile || 'default');
    const active = this.sessionService.getSession(clientId);
    if (active) return active;
    const mapped = this.db.prepare('SELECT pi_session_id FROM wecom_gateway_sessions WHERE client_id = ?').get(clientId) as { pi_session_id: string } | undefined;
    if (mapped) {
      const persisted = await this.sessionService.findPersistedSession(clientId, mapped.pi_session_id);
      if (persisted) return this.sessionService.resumeSession(clientId, persisted.path);
    }
    const preset = config.skillPresetId ? this.presetStore.getById(config.skillPresetId) : null;
    const result = await this.sessionService.createSession(clientId, {
      cwd: config.defaultCwd,
      modelProvider: config.modelProvider,
      modelId: config.modelId,
      enabledSkills: preset?.mode === 'enabled' ? preset.skills : undefined,
      disabledSkills: preset?.mode === 'disabled' ? preset.skills : undefined,
      presetId: preset?.id,
      skillMode: preset?.mode || config.skillMode || 'all',
    });
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO wecom_gateway_sessions (session_key, client_id, pi_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET pi_session_id = excluded.pi_session_id, updated_at = excluded.updated_at
    `).run(clientId, clientId, result.session.sessionId, now, now);
    return result.session;
  }

  private async handleCommand(clientId: string, message: Pick<WecomMessagePayload, 'userId' | 'text'>, baseConfig: WecomGatewayConfig, effectiveConfig: WecomGatewayConfig): Promise<boolean> {
    const commandText = normalizeGatewayCommandText(message.text);
    const [command = '', ...args] = commandText.split(/\s+/);
    const normalized = command.toLowerCase();
    if (!normalized.startsWith('/')) return false;
    try {
      if (normalized === '/new' || normalized === '/reset') {
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.userId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Reset this WeCom chat. A fresh Pi session will start with your next message.'));
        return true;
      }
      if (normalized === '/help') {
        await this.sendReply(baseConfig, message.userId, this.formatHelp());
        return true;
      }
      if (normalized === '/status') {
        await this.sendReply(baseConfig, message.userId, await this.formatStatus(clientId, effectiveConfig));
        return true;
      }
      if (normalized === '/profiles') {
        const profiles = await this.sessionService.listAgentProfiles();
        await this.sendReply(baseConfig, message.userId, ['Available profiles:', ...profiles.map((profile) => `${profile.id === (effectiveConfig.agentProfile || 'default') ? '*' : ' '} ${profile.id}`)].join('\n'));
        return true;
      }
      if (normalized === '/profile' || normalized === '/use-profile' || normalized === '/set-profile') {
        const profile = args[0]?.trim();
        if (!profile) throw new Error('Usage: /profile <profile-id>');
        const profiles = await this.sessionService.listAgentProfiles();
        if (!profiles.some((item) => item.id === profile)) throw new Error(`Unknown profile: ${profile}`);
        this.saveChatConfig(clientId, { agentProfile: profile });
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.userId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Profile updated.'));
        return true;
      }
      if (normalized === '/cwds' || normalized === '/pwds') {
        await this.sendReply(baseConfig, message.userId, baseConfig.cwdChoices.length
          ? baseConfig.cwdChoices.map((cwd, index) => `${index + 1}: ${cwd}`).join('\n')
          : 'No gateway folders configured.');
        return true;
      }
      if (normalized === '/cwd') {
        const slot = Number(args[0]);
        if (!Number.isInteger(slot) || slot < 1 || slot > baseConfig.cwdChoices.length) throw new Error(`Usage: /cwd <1-${baseConfig.cwdChoices.length}>`);
        const target = baseConfig.cwdChoices[slot - 1];
        if (!isAbsolute(target) || !(await stat(target)).isDirectory()) throw new Error(`Configured CWD ${slot} must be an existing absolute directory`);
        this.saveChatConfig(clientId, { defaultCwd: target });
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.userId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Working directory updated.'));
        return true;
      }
      if (normalized === '/skillsets') {
        await this.sendReply(baseConfig, message.userId, this.formatSkillsets(effectiveConfig.skillPresetId));
        return true;
      }
      if (normalized === '/skillset') {
        const selected = args.join(' ').trim();
        if (!selected) throw new Error('Usage: /skillset <all|preset-name>');
        this.saveChatConfig(clientId, this.resolveSkillsetConfig(selected, true));
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.userId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Skillset updated.'));
        return true;
      }
      if (normalized === '/clear-config') {
        this.db.prepare('DELETE FROM wecom_gateway_configs WHERE client_id = ?').run(clientId);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.userId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'WeCom chat config cleared.'));
        return true;
      }
    } catch (error) {
      await this.sendReply(baseConfig, message.userId, `Command failed: ${error instanceof Error ? error.message : 'unknown error'}\n\n${this.formatHelp()}`);
      return true;
    }
    await this.sendReply(baseConfig, message.userId, `Unknown command: ${command}\n\n${this.formatHelp()}`);
    return true;
  }

  private resolveChatConfig(clientId: string, base: WecomGatewayConfig): WecomGatewayConfig {
    const chat = this.loadChatConfig(clientId);
    const useBaseModel = !chat.agentProfile || chat.agentProfile === base.agentProfile;
    return {
      ...base,
      agentProfile: chat.agentProfile || base.agentProfile,
      defaultCwd: chat.defaultCwd && base.cwdChoices.includes(chat.defaultCwd) ? chat.defaultCwd : base.defaultCwd,
      modelProvider: useBaseModel ? base.modelProvider : undefined,
      modelId: useBaseModel ? base.modelId : undefined,
      skillMode: chat.skillMode || base.skillMode,
      skillPresetId: chat.skillMode ? chat.skillPresetId : base.skillPresetId,
    };
  }

  private loadChatConfig(clientId: string): WecomChatConfig {
    const row = this.db.prepare('SELECT agent_profile, default_cwd, skill_mode, skill_preset_id FROM wecom_gateway_configs WHERE client_id = ?').get(clientId) as { agent_profile: string | null; default_cwd: string | null; skill_mode: 'all' | 'enabled' | 'disabled' | null; skill_preset_id: string | null } | undefined;
    return row ? {
      agentProfile: row.agent_profile || undefined,
      defaultCwd: row.default_cwd || undefined,
      skillMode: row.skill_mode || undefined,
      skillPresetId: row.skill_preset_id,
    } : {};
  }

  private saveChatConfig(clientId: string, patch: WecomChatConfig): void {
    const next = { ...this.loadChatConfig(clientId), ...patch };
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO wecom_gateway_configs (client_id, agent_profile, default_cwd, skill_mode, skill_preset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        agent_profile = excluded.agent_profile,
        default_cwd = excluded.default_cwd,
        skill_mode = excluded.skill_mode,
        skill_preset_id = excluded.skill_preset_id,
        updated_at = excluded.updated_at
    `).run(clientId, next.agentProfile || null, next.defaultCwd || null, next.skillMode || null, next.skillPresetId || null, now, now);
  }

  private resetSession(clientId: string): void {
    this.sessionService.disposeSession(clientId);
    this.db.prepare('DELETE FROM wecom_gateway_sessions WHERE client_id = ?').run(clientId);
  }

  private async formatStatus(clientId: string, config: WecomGatewayConfig, prefix?: string): Promise<string> {
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

  private formatHelp(): string {
    return [
      'Pi Cloud WeCom commands',
      '/new - reset this chat session',
      '/status - show current configuration',
      '/profiles - list profiles',
      '/profile <id> - switch profile',
      '/cwds - list allowed folders',
      '/cwd <number> - switch folder',
      '/skillsets - list skillsets',
      '/skillset <name> - switch skillset',
      '/clear-config - restore gateway defaults',
      '/help - show this help',
      '',
      GATEWAY_COMMON_ALIAS_HELP,
    ].join('\n');
  }

  private resolveSkillsetConfig(skillset?: string, strict = false): WecomChatConfig {
    const selected = skillset?.trim();
    if (!selected || selected.toLowerCase() === 'all') return { skillMode: 'all', skillPresetId: null };
    const preset = this.findSkillPreset(selected);
    if (preset) return { skillMode: preset.mode, skillPresetId: preset.id };
    if (strict) throw new Error(`Unknown skillset: ${selected}`);
    console.warn('[wecom-gateway] default gateway skillset was not found; using all skills', { skillset: selected });
    return { skillMode: 'all', skillPresetId: null };
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
    return this.presetStore.list().find((preset) => preset.id === nameOrId || preset.name.toLowerCase() === normalized) || null;
  }

  private async sendReply(config: WecomGatewayConfig, userId: string, text: string): Promise<void> {
    for (const chunk of splitUtf8Text(formatWecomMarkdown(text), TEXT_CHUNK_MAX_BYTES)) {
      let token = await this.getAccessToken(config);
      let data = await this.sendApplicationMarkdown(config, token, userId, chunk);
      if ([40014, 42001].includes(Number(data.errcode))) {
        this.tokenCache = undefined;
        token = await this.getAccessToken(config);
        data = await this.sendApplicationMarkdown(config, token, userId, chunk);
      }
      if (Number(data.errcode) !== 0) throw new Error(`WeCom send message failed: ${stringValue(data.errmsg) || `errcode=${data.errcode}`}`);
    }
  }

  private async sendApplicationMarkdown(config: WecomGatewayConfig, token: string, userId: string, text: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${WECOM_API_BASE_URL}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: userId,
        msgtype: 'markdown',
        agentid: Number(config.agentId),
        markdown: { content: text },
        safe: 0,
        enable_duplicate_check: 1,
        duplicate_check_interval: 1800,
      }),
    });
    return parseWecomResponse(response);
  }

  private async downloadImage(config: WecomGatewayConfig, mediaId: string): Promise<ImageContent> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getAccessToken(config);
      const response = await fetch(`${WECOM_API_BASE_URL}/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.toLowerCase().includes('application/json')) {
        const data = await parseWecomResponse(response);
        const errorCode = Number(data.errcode);
        if (attempt === 0 && [40014, 42001].includes(errorCode)) {
          this.tokenCache = undefined;
          continue;
        }
        throw new Error(`WeCom media download failed: ${stringValue(data.errmsg) || `errcode=${data.errcode}`}`);
      }
      if (!response.ok) throw new Error(`WeCom media download failed: HTTP ${response.status}`);

      const bytes = await readResponseBytes(response, MAX_IMAGE_BYTES);
      const mimeType = sniffImageMimeType(bytes);
      if (!mimeType) throw new Error('WeCom media response was not a supported image');
      return { type: 'image', data: bytes.toString('base64'), mimeType };
    }
    throw new Error('WeCom media download failed after refreshing the access token');
  }

  private async getAccessToken(config: WecomGatewayConfig): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS > now) return this.tokenCache.token;
    const response = await fetch(`${WECOM_API_BASE_URL}/cgi-bin/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.corpSecret)}`);
    const data = await parseWecomResponse(response);
    const token = stringValue(data.access_token);
    if (Number(data.errcode) !== 0 || !token) throw new Error(`WeCom access token failed: ${stringValue(data.errmsg) || `errcode=${data.errcode}`}`);
    this.tokenCache = { token, expiresAt: now + (Number(data.expires_in) || 7200) * 1000 };
    return token;
  }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error('An image is larger than 10 MB.');
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('An image is larger than 10 MB.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function parseWecomMessage(xml: string): (WecomMessagePayload & { agentId: string }) | null {
  const messageType = xmlValue(xml, 'MsgType');
  const userId = xmlValue(xml, 'FromUserName');
  const messageId = xmlValue(xml, 'MsgId');
  const agentId = xmlValue(xml, 'AgentID');
  if (!messageType || !userId || !messageId || !agentId) return null;
  return {
    messageType,
    userId,
    messageId,
    agentId,
    text: xmlValue(xml, 'Content').trim(),
    mediaId: xmlValue(xml, 'MediaId') || undefined,
    picUrl: xmlValue(xml, 'PicUrl') || undefined,
  };
}

function xmlValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i').exec(xml);
  return decodeXmlEntities((match?.[1] ?? match?.[2] ?? '').trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseList(value?: string): string[] {
  return Array.from(new Set((value || '').split(',').map((item) => item.trim()).filter(Boolean)));
}

function normalizeList(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function gatewayError(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

async function parseWecomResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok) throw new Error(`WeCom HTTP ${response.status}: ${text.slice(0, 200)}`);
  return data;
}

function extractLastAssistantText(messages: any[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (typeof message.content === 'string' && message.content.trim()) return message.content.trim();
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('')
      .trim();
    if (text) return text;
  }
  return undefined;
}

function formatWecomMarkdown(text: string): string {
  return text.replace(/^([ \t]*)[-+*][ \t]+/gm, (_match, indentation: string) => `${indentation}${indentation ? '◦' : '•'} `);
}

function splitUtf8Text(text: string, maxBytes: number): string[] {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (current && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}
