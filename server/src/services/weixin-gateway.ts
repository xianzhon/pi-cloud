import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ImageContent } from '@earendil-works/pi-ai';
import QRCode from 'qrcode';
import { Agent, fetch as undiciFetch } from 'undici';
import type { PiuiDatabase } from '../db/database.js';
import { GATEWAY_COMMON_ALIAS_HELP, normalizeGatewayCommandText } from './gateway-command-aliases.js';
import { GatewaySettingsStore } from './gateway-settings-store.js';
import { MAX_IMAGE_COUNT, sniffImageMimeType, validateImages } from './image-input.js';
import type { PiSessionService } from './session-manager.js';
import { SkillPresetStore, type SkillPresetRecord } from './skill-preset-store.js';
import { saveWeixinImage } from './weixin-image-store.js';
import { buildWeixinCdnDownloadUrl, decryptWeixinMedia, parseWeixinAesKey } from './weixin-media-crypto.js';

interface WeixinGatewayConfig {
  enabled: boolean;
  accountId: string;
  token: string;
  baseUrl: string;
  defaultCwd?: string;
  cwdChoices: string[];
  agentProfile?: string;
  modelProvider?: string;
  modelId?: string;
  skillMode?: 'all' | 'enabled' | 'disabled';
  skillPresetId?: string | null;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowedUsers: string[];
}

interface WeixinChatConfig {
  agentProfile?: string;
  defaultCwd?: string;
  skillMode?: 'all' | 'enabled' | 'disabled';
  skillPresetId?: string | null;
}

interface WeixinCredential {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
}

interface WeixinPairingState {
  status: 'idle' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
  qrcode?: string;
  scanUrl?: string;
  qrDataUrl?: string;
  accountId?: string;
  userId?: string;
  error?: string;
  expiresAt?: string;
}

interface WeixinMessagePayload {
  messageId: string;
  chatId: string;
  chatType: 'dm' | 'group';
  senderId: string;
  text: string;
  images: ImageContent[];
  imageError?: string;
  contextToken?: string;
}

interface WeixinImageCandidate {
  source: string;
  data?: string;
  url?: string;
  encryptedQueryParam?: string;
  mimeType?: string;
  aesKey?: string;
}

interface WeixinImageExtractionResult {
  images: ImageContent[];
  error?: string;
}

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_APP_ID = 'bot';
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;
const CHANNEL_VERSION = '2.2.0';
const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const DEDUP_TTL_MS = 5 * 60 * 1000;
const NO_GATEWAY_FOLDERS_MESSAGE = 'No gateway folders configured.';
const GATEWAY_FOLDERS_REQUIRED_MESSAGE = `${NO_GATEWAY_FOLDERS_MESSAGE} Add at least one allowed folder in Web UI Settings > Gateway.`;
const ITEM_TEXT = 1;
const ITEM_IMAGE = 2;
const ITEM_VOICE = 3;
const MSG_TYPE_BOT = 2;
const MSG_STATE_FINISH = 2;
const TYPING_STATUS_TYPING = 1;
const TYPING_STATUS_CANCEL = 2;
const TYPING_KEEPALIVE_INTERVAL_MS = 5000;
const directImageFetchAgent = new Agent();

export class WeixinGatewayService {
  private readonly presetStore: SkillPresetStore;
  private readonly gatewaySettings: GatewaySettingsStore;
  private readonly seen = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly typingTickets = new Map<string, string>();
  private running = false;
  private pollPromise?: Promise<void>;
  private abortController?: AbortController;
  private pairingState: WeixinPairingState = { status: 'idle' };
  private pairingPromise?: Promise<void>;

  constructor(
    private readonly db: PiuiDatabase,
    gatewaySettings: GatewaySettingsStore | undefined,
    private readonly sessionService: PiSessionService,
  ) {
    this.presetStore = new SkillPresetStore(db);
    this.gatewaySettings = gatewaySettings || new GatewaySettingsStore(db);
  }

  start(): void {
    const config = this.loadConfig();
    if (!config.enabled) return;
    if (this.running) return;
    if (!config.accountId || !config.token) {
      console.warn('[weixin-gateway] enabled but PI_WEBUI_WECHAT_ACCOUNT_ID and PI_WEBUI_WECHAT_TOKEN are required');
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    this.pollPromise = this.pollLoop(config).finally(() => {
      this.running = false;
      this.pollPromise = undefined;
    });
    console.info('[weixin-gateway] started', { accountId: safeId(config.accountId) });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    if (this.pollPromise) await this.pollPromise.catch(() => undefined);
    this.abortController = undefined;
  }

  status(): Record<string, unknown> {
    const config = this.loadConfig();
    return {
      enabled: config.enabled,
      running: this.running,
      configured: Boolean(config.accountId && config.token),
      accountId: config.accountId ? safeId(config.accountId) : undefined,
      baseUrl: config.baseUrl,
      dmPolicy: config.dmPolicy,
      paired: Boolean(this.loadCredential()),
    };
  }

  async beginPairing(): Promise<WeixinPairingState> {
    if (this.pairingState.status === 'waiting' || this.pairingState.status === 'scanned') return this.pairingState;
    const qrResponse = await this.weixinGet('ilink/bot/get_bot_qrcode?bot_type=3', ILINK_BASE_URL, 35_000);
    const qrcode = stringValue(qrResponse.qrcode);
    const scanUrl = stringValue(qrResponse.qrcode_img_content) || qrcode;
    if (!qrcode || !scanUrl) throw new Error('WeChat QR response did not include a qrcode');

    this.pairingState = {
      status: 'waiting',
      qrcode,
      scanUrl,
      qrDataUrl: await QRCode.toDataURL(scanUrl),
      expiresAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
    };
    this.pairingPromise = this.pollPairing(qrcode).finally(() => {
      this.pairingPromise = undefined;
    });
    return this.pairingState;
  }

  getPairing(): WeixinPairingState {
    return this.pairingState;
  }

  async unpair(): Promise<void> {
    this.pairingState = { status: 'idle' };
    this.db.prepare('DELETE FROM weixin_gateway_credentials WHERE id = 1').run();
    await this.stop();
  }

  private loadConfig(): WeixinGatewayConfig {
    const gatewaySettings = this.gatewaySettings.get();
    const credential = this.loadCredential();
    const cwdChoices = gatewaySettings.cwds;
    return {
      enabled: parseBoolean(process.env.PI_WEBUI_WECHAT_GATEWAY_ENABLED, false),
      accountId: process.env.PI_WEBUI_WECHAT_ACCOUNT_ID?.trim() || credential?.accountId || '',
      token: process.env.PI_WEBUI_WECHAT_TOKEN?.trim() || credential?.token || '',
      baseUrl: (process.env.PI_WEBUI_WECHAT_BASE_URL?.trim() || credential?.baseUrl || ILINK_BASE_URL).replace(/\/+$/, ''),
      defaultCwd: cwdChoices[0],
      cwdChoices,
      agentProfile: gatewaySettings.defaultProfile,
      modelProvider: gatewaySettings.defaultModelProvider,
      modelId: gatewaySettings.defaultModelId,
      ...this.resolveSkillsetConfig(gatewaySettings.defaultSkillset),
      dmPolicy: parseDmPolicy(process.env.PI_WEBUI_WECHAT_DM_POLICY),
      allowedUsers: parseList(process.env.PI_WEBUI_WECHAT_ALLOWED_USERS),
    };
  }

  private async pollPairing(qrcode: string): Promise<void> {
    const deadline = Date.now() + 8 * 60 * 1000;
    let baseUrl = ILINK_BASE_URL;
    while (Date.now() < deadline && this.pairingState.qrcode === qrcode) {
      try {
        const response = await this.weixinGet(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, baseUrl, 35_000);
        const status = stringValue(response.status) || 'wait';
        if (status === 'wait') {
          this.pairingState = { ...this.pairingState, status: 'waiting' };
        } else if (status === 'scaned') {
          this.pairingState = { ...this.pairingState, status: 'scanned' };
        } else if (status === 'scaned_but_redirect') {
          const redirectHost = stringValue(response.redirect_host);
          if (redirectHost) baseUrl = `https://${redirectHost}`;
        } else if (status === 'expired') {
          this.pairingState = { status: 'expired', error: 'QR code expired. Start pairing again.' };
          return;
        } else if (status === 'confirmed') {
          const credential = this.credentialFromPairingResponse(response);
          this.saveCredential(credential);
          this.pairingState = {
            status: 'confirmed',
            accountId: credential.accountId,
            userId: credential.userId,
          };
          if (this.loadConfig().enabled && !this.running) this.start();
          return;
        }
      } catch (error) {
        this.pairingState = { ...this.pairingState, status: 'error', error: error instanceof Error ? error.message : 'Pairing failed' };
        return;
      }
      await delay(1000);
    }
    if (this.pairingState.qrcode === qrcode) this.pairingState = { status: 'expired', error: 'WeChat pairing timed out.' };
  }

  private credentialFromPairingResponse(response: Record<string, unknown>): WeixinCredential {
    const credential = {
      accountId: stringValue(response.ilink_bot_id),
      token: stringValue(response.bot_token),
      baseUrl: stringValue(response.baseurl) || ILINK_BASE_URL,
      userId: stringValue(response.ilink_user_id) || undefined,
    };
    if (!credential.accountId || !credential.token) throw new Error('WeChat confirmed but did not return account credentials');
    return credential;
  }

  private loadCredential(): WeixinCredential | null {
    const row = this.db.prepare('SELECT account_id, token, base_url, user_id FROM weixin_gateway_credentials WHERE id = 1').get() as {
      account_id: string;
      token: string;
      base_url: string;
      user_id: string | null;
    } | undefined;
    return row ? {
      accountId: row.account_id,
      token: row.token,
      baseUrl: row.base_url,
      userId: row.user_id || undefined,
    } : null;
  }

  private saveCredential(credential: WeixinCredential): void {
    this.db.prepare(`
      INSERT INTO weixin_gateway_credentials (id, account_id, token, base_url, user_id, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        token = excluded.token,
        base_url = excluded.base_url,
        user_id = excluded.user_id,
        updated_at = excluded.updated_at
    `).run(credential.accountId, credential.token, credential.baseUrl, credential.userId || null, new Date().toISOString());
  }

  private async pollLoop(initialConfig: WeixinGatewayConfig): Promise<void> {
    let syncBuf = this.getSyncBuf(initialConfig.accountId);
    let consecutiveFailures = 0;

    while (this.running) {
      const config = this.loadConfig();
      if (!config.enabled || !config.accountId || !config.token) break;

      try {
        const response = await this.weixinJsonRequest(config, 'ilink/bot/getupdates', { get_updates_buf: syncBuf }, LONG_POLL_TIMEOUT_MS);
        const ret = Number(response.ret || 0);
        const errcode = Number(response.errcode || 0);
        if (ret !== 0 || errcode !== 0) {
          console.warn('[weixin-gateway] getupdates failed', { ret, errcode, errmsg: stringValue(response.errmsg) || stringValue(response.msg) });
          consecutiveFailures += 1;
          await delay(consecutiveFailures >= 3 ? 30_000 : 2_000);
          if (consecutiveFailures >= 3) consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures = 0;
        const nextSyncBuf = stringValue(response.get_updates_buf);
        if (nextSyncBuf) {
          syncBuf = nextSyncBuf;
          this.saveSyncBuf(config.accountId, syncBuf);
        }

        const messages = Array.isArray(response.msgs) ? response.msgs : [];
        for (const raw of messages) {
          const message = await this.parseMessage(asRecord(raw), config);
          if (!message) continue;
          if (this.markDuplicate(message.messageId)) continue;
          if (message.contextToken) this.saveContextToken(config.accountId, message.senderId, message.contextToken);
          this.enqueue(message, config);
        }
      } catch (error) {
        if (!this.running) break;
        consecutiveFailures += 1;
        console.error('[weixin-gateway] poll error:', error);
        await delay(consecutiveFailures >= 3 ? 30_000 : 2_000);
        if (consecutiveFailures >= 3) consecutiveFailures = 0;
      }
    }
    console.info('[weixin-gateway] stopped');
  }

  private async parseMessage(message: Record<string, unknown>, config: WeixinGatewayConfig): Promise<WeixinMessagePayload | null> {
    const senderId = stringValue(message.from_user_id);
    if (!senderId || senderId === config.accountId) return null;

    const { chatType, chatId } = this.guessChat(message, config.accountId);
    if (chatType === 'group') return null; // MVP: iLink group delivery is unreliable; keep WebUI Weixin DM-only for now.
    if (!this.isDmAllowed(senderId, config)) return null;

    const items = Array.isArray(message.item_list) ? message.item_list.map(asRecord) : [];
    const text = extractText(items).trim();
    const imageResult = await this.extractImages(config, items);
    const messageId = stringValue(message.message_id) || randomUUID();
    if (!text && imageResult.images.length === 0 && !imageResult.error) this.logUnsupportedInboundMessage(message, items, 'no text or supported image item');
    if ((!text && imageResult.images.length === 0 && !imageResult.error) || !chatId) return null;
    return {
      messageId,
      chatId,
      chatType,
      senderId,
      text,
      images: imageResult.images,
      imageError: imageResult.error,
      contextToken: stringValue(message.context_token) || undefined,
    };
  }

  private guessChat(message: Record<string, unknown>, accountId: string): Pick<WeixinMessagePayload, 'chatType' | 'chatId'> {
    const roomId = stringValue(message.room_id) || stringValue(message.chat_room_id);
    const toUserId = stringValue(message.to_user_id);
    const isGroup = Boolean(roomId) || Boolean(toUserId && accountId && toUserId !== accountId && Number(message.msg_type) === 1);
    if (isGroup) return { chatType: 'group', chatId: roomId || toUserId || stringValue(message.from_user_id) };
    return { chatType: 'dm', chatId: stringValue(message.from_user_id) };
  }

  private isDmAllowed(senderId: string, config: WeixinGatewayConfig): boolean {
    if (config.dmPolicy === 'disabled') return false;
    if (config.dmPolicy === 'allowlist') return config.allowedUsers.includes(senderId);
    if (config.dmPolicy === 'open') return parseBoolean(process.env.PI_WEBUI_WECHAT_ALLOW_ALL_USERS || process.env.GATEWAY_ALLOW_ALL_USERS, false);
    return true; // pairing mode accepts inbound DMs so operators can discover sender IDs.
  }

  private logUnsupportedInboundMessage(message: Record<string, unknown>, items: Record<string, unknown>[], reason: string): void {
    console.info('[weixin-gateway] unsupported inbound message', JSON.stringify({
      reason,
      messageId: message.message_id,
      msgType: message.msg_type,
      messageType: message.message_type,
      messageKeys: Object.keys(message).sort(),
      itemSummaries: items.map(summarizeWeixinItem),
    }, null, 2));
  }

  private async extractImages(config: WeixinGatewayConfig, items: Record<string, unknown>[]): Promise<WeixinImageExtractionResult> {
    const candidates = collectWeixinImageCandidates(items).slice(0, MAX_IMAGE_COUNT);
    if (candidates.length === 0) {
      const mediaItems = items.filter((item) => Number(item.type) !== ITEM_TEXT && Number(item.type) !== ITEM_VOICE);
      if (mediaItems.length) {
        console.info('[weixin-gateway] inbound media item shape needs image parser support', JSON.stringify({
          itemSummaries: mediaItems.map(summarizeWeixinItem),
          imageItemDetails: mediaItems
            .filter((item) => Number(item.type) === ITEM_IMAGE)
            .map((item) => summarizeWeixinImageItem(asRecord(item.image_item))),
        }, null, 2));
      }
      return { images: [] };
    }

    console.info('[weixin-gateway] inbound image candidates', JSON.stringify({
      count: candidates.length,
      candidates: candidates.map((candidate) => ({
        source: candidate.source,
        hasData: Boolean(candidate.data),
        hasUrl: Boolean(candidate.url),
        hasEncryptedQueryParam: Boolean(candidate.encryptedQueryParam),
        mimeType: candidate.mimeType,
      })),
    }, null, 2));

    const images: ImageContent[] = [];
    let error: string | undefined;
    for (const candidate of candidates) {
      try {
        const image = candidate.data
          ? imageContentFromCandidateData(candidate)
          : await this.downloadImageCandidate(config, candidate);
        if (image) images.push(image);
      } catch (candidateError) {
        error = candidateError instanceof Error ? candidateError.message : 'unknown error';
        console.warn('[weixin-gateway] failed to read inbound image candidate', {
          source: candidate.source,
          hasUrl: Boolean(candidate.url),
          hasAesKey: Boolean(candidate.aesKey),
          hasEncryptedQueryParam: Boolean(candidate.encryptedQueryParam),
          reason: error,
        });
      }
    }
    return { images, error: images.length === 0 ? error : undefined };
  }

  private async downloadImageCandidate(config: WeixinGatewayConfig, candidate: WeixinImageCandidate): Promise<ImageContent | null> {
    if (!candidate.url && !candidate.encryptedQueryParam) return null;
    const url = candidate.url
      ? resolveWeixinUrl(config.baseUrl, candidate.url)
      : buildWeixinCdnDownloadUrl(candidate.encryptedQueryParam!);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await undiciFetch(url, {
        dispatcher: directImageFetchAgent,
        headers: weixinHeaders(config.token, ''),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const downloadedBytes = Buffer.from(await response.arrayBuffer());
      const bytes = candidate.aesKey
        ? decryptWeixinMedia(downloadedBytes, parseWeixinAesKey(candidate.aesKey))
        : downloadedBytes;
      const mimeType = sniffImageMimeType(bytes);
      if (!mimeType) {
        console.warn('[weixin-gateway] downloaded image bytes are not a readable image', {
          source: candidate.source,
          downloadedByteLength: downloadedBytes.byteLength,
          decodedByteLength: bytes.byteLength,
          firstBytesHex: bytes.subarray(0, 16).toString('hex'),
          responseContentType: response.headers.get('content-type') || undefined,
          candidateMimeType: candidate.mimeType,
          hasAesKey: Boolean(candidate.aesKey),
          hasEncryptedQueryParam: Boolean(candidate.encryptedQueryParam),
        });
        throw new Error('WeChat image download could not be decoded into a readable image.');
      }
      return { type: 'image', data: bytes.toString('base64'), mimeType };
    } finally {
      clearTimeout(timeout);
    }
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

  private enqueue(message: WeixinMessagePayload, config: WeixinGatewayConfig): void {
    const clientId = this.clientIdForMessage(message);
    const previous = this.queues.get(clientId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.processMessage(clientId, message, config))
      .catch((error) => console.error('[weixin-gateway] message handling failed:', error))
      .finally(() => {
        if (this.queues.get(clientId) === next) this.queues.delete(clientId);
      });
    this.queues.set(clientId, next);
  }

  private clientIdForMessage(message: WeixinMessagePayload): string {
    return `weixin:${message.chatType}:${message.chatId}`;
  }

  private async processMessage(clientId: string, message: WeixinMessagePayload, config: WeixinGatewayConfig): Promise<void> {
    const effectiveConfig = this.resolveChatConfig(clientId, config);
    if (await this.handleCommand(clientId, message, config, effectiveConfig)) return;
    if (!effectiveConfig.defaultCwd) {
      await this.sendReply(config, message.chatId, GATEWAY_FOLDERS_REQUIRED_MESSAGE);
      return;
    }
    if (message.imageError && message.images.length === 0) {
      await this.sendReply(config, message.chatId, message.imageError);
      return;
    }

    const session = await this.ensureSession(clientId, effectiveConfig);
    const imageResult = validateImages(message.images, session.model);
    if (!imageResult.ok) {
      await this.sendReply(config, message.chatId, imageResult.message);
      return;
    }
    await this.saveInboundImages(effectiveConfig.defaultCwd, message.messageId, imageResult.images);

    const promptText = message.text || (imageResult.images.length ? 'Please analyze the attached image.' : '');
    const chunks: string[] = [];
    const unsubscribe = session.subscribe((event: any) => {
      if (event?.type !== 'message_update') return;
      const update = event.assistantMessageEvent;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        chunks.push(update.delta);
      }
    });

    const stopTypingIndicator = this.startTypingIndicator(config, message.chatId);
    try {
      await this.sessionService.runForegroundWithClientProfileProxy(clientId, async () => {
        await session.prompt(promptText, imageResult.images.length ? { images: imageResult.images } : undefined);
      });
    } finally {
      stopTypingIndicator();
      unsubscribe();
    }

    const response = chunks.join('').trim() || extractLastAssistantText(session.messages) || '(Pi finished without a text response.)';
    await this.sendReply(config, message.chatId, response);
  }

  private async saveInboundImages(projectRoot: string | undefined, messageId: string, images: ImageContent[]): Promise<void> {
    if (!projectRoot || images.length === 0) return;
    await Promise.all(images.map(async (image, index) => {
      try {
        const savedPath = await saveWeixinImage(projectRoot, messageId, index + 1, image.mimeType, Buffer.from(image.data, 'base64'));
        console.info('[weixin-gateway] saved inbound image', { path: savedPath });
      } catch (error) {
        // Persistence is helpful for project context, but image processing should continue if the project is read-only.
        console.warn('[weixin-gateway] failed to save inbound image', {
          projectRoot,
          messageId,
          index: index + 1,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }));
  }

  private async ensureSession(clientId: string, config: WeixinGatewayConfig) {
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

  private async handleCommand(clientId: string, message: WeixinMessagePayload, baseConfig: WeixinGatewayConfig, effectiveConfig: WeixinGatewayConfig): Promise<boolean> {
    const commandText = normalizeGatewayCommandText(message.text);
    const [command = '', ...args] = commandText.split(/\s+/);
    const normalized = command.toLowerCase();
    if (!normalized.startsWith('/')) return false;

    try {
      if (normalized === '/new' || normalized === '/reset') {
        this.resetSession(clientId);
        await this.sendReply(
          baseConfig,
          message.chatId,
          await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Reset this WeChat chat. A fresh Pi session will start with your next message.'),
        );
        return true;
      }
      if (normalized === '/help') {
        await this.sendReply(baseConfig, message.chatId, this.formatHelp());
        return true;
      }
      if (normalized === '/status') {
        await this.sendReply(baseConfig, message.chatId, await this.formatStatus(clientId, effectiveConfig));
        return true;
      }
      if (normalized === '/profiles') {
        await this.sendReply(baseConfig, message.chatId, await this.formatProfiles(effectiveConfig.agentProfile || 'default'));
        return true;
      }
      if (normalized === '/profile' || normalized === '/use-profile' || normalized === '/set-profile') {
        await this.setChatProfile(clientId, args[0]);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.chatId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Profile updated.'));
        return true;
      }
      if (normalized === '/cwds' || normalized === '/pwds') {
        await this.sendReply(baseConfig, message.chatId, this.formatCwdChoices(baseConfig));
        return true;
      }
      if (normalized === '/cwd') {
        if (args.length === 0) {
          await this.sendReply(baseConfig, message.chatId, effectiveConfig.defaultCwd || NO_GATEWAY_FOLDERS_MESSAGE);
          return true;
        }
        await this.setChatCwd(clientId, args[0], baseConfig);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.chatId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Working directory updated.'));
        return true;
      }
      if (normalized === '/skillsets') {
        await this.sendReply(baseConfig, message.chatId, this.formatSkillsets(effectiveConfig.skillPresetId));
        return true;
      }
      if (normalized === '/skillset') {
        await this.setChatSkillset(clientId, args.join(' '));
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.chatId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'Skillset updated.'));
        return true;
      }
      if (normalized === '/clear-config') {
        this.clearChatConfig(clientId);
        this.resetSession(clientId);
        await this.sendReply(baseConfig, message.chatId, await this.formatStatus(clientId, this.resolveChatConfig(clientId, baseConfig), 'WeChat chat config cleared.'));
        return true;
      }
    } catch (error) {
      await this.sendReply(baseConfig, message.chatId, `Command failed: ${error instanceof Error ? error.message : 'unknown error'}\n\n${this.formatHelp()}`);
      return true;
    }

    await this.sendReply(baseConfig, message.chatId, `Unknown command: ${command}\n\n${this.formatHelp()}`);
    return true;
  }

  private resolveChatConfig(clientId: string, base: WeixinGatewayConfig): WeixinGatewayConfig {
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

  private async createSessionOptions(config: WeixinGatewayConfig) {
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

  private getChatConfig(clientId: string): WeixinChatConfig {
    const row = this.db.prepare('SELECT * FROM weixin_gateway_configs WHERE client_id = ?').get(clientId) as {
      agent_profile: string | null;
      default_cwd: string | null;
      skill_mode: WeixinChatConfig['skillMode'] | null;
      skill_preset_id: string | null;
    } | undefined;
    return row ? {
      agentProfile: row.agent_profile || undefined,
      defaultCwd: row.default_cwd || undefined,
      skillMode: row.skill_mode || undefined,
      skillPresetId: row.skill_preset_id || undefined,
    } : {};
  }

  private saveChatConfig(clientId: string, patch: WeixinChatConfig): void {
    const current = this.getChatConfig(clientId);
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO weixin_gateway_configs (client_id, agent_profile, default_cwd, skill_mode, skill_preset_id, created_at, updated_at)
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
    this.db.prepare('DELETE FROM weixin_gateway_configs WHERE client_id = ?').run(clientId);
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

  private async setChatCwd(clientId: string, slotText: string, config: WeixinGatewayConfig): Promise<void> {
    if (!config.cwdChoices.length) throw new Error('No WeChat CWD choices are configured in Web UI settings');
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

  private async formatStatus(clientId: string, config: WeixinGatewayConfig, prefix?: string): Promise<string> {
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

  private resolveSkillsetConfig(skillset?: string, strict = false): WeixinChatConfig {
    const selected = skillset?.trim();
    if (!selected || selected.toLowerCase() === 'all') return { skillMode: 'all', skillPresetId: null };

    const preset = this.findSkillPreset(selected);
    if (preset) return { skillMode: preset.mode, skillPresetId: preset.id };
    if (strict) throw new Error(`Unknown skillset: ${selected}`);
    console.warn('[weixin-gateway] default gateway skillset was not found; using all skills', { skillset: selected });
    return { skillMode: 'all', skillPresetId: null };
  }

  private formatCwdChoices(config: WeixinGatewayConfig): string {
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
      'Pi WeChat commands:',
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
    const row = this.db.prepare('SELECT pi_session_id FROM weixin_gateway_sessions WHERE client_id = ?').get(clientId) as { pi_session_id: string } | undefined;
    return row?.pi_session_id;
  }

  private saveSessionMapping(clientId: string, sessionId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO weixin_gateway_sessions (session_key, client_id, pi_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET pi_session_id = excluded.pi_session_id, updated_at = excluded.updated_at
    `).run(clientId, clientId, sessionId, now, now);
  }

  private deleteSessionMapping(clientId: string): void {
    this.db.prepare('DELETE FROM weixin_gateway_sessions WHERE client_id = ?').run(clientId);
  }

  private getSyncBuf(accountId: string): string {
    const row = this.db.prepare('SELECT sync_buf FROM weixin_gateway_state WHERE account_id = ?').get(accountId) as { sync_buf: string | null } | undefined;
    return row?.sync_buf || '';
  }

  private saveSyncBuf(accountId: string, syncBuf: string): void {
    this.db.prepare(`
      INSERT INTO weixin_gateway_state (account_id, sync_buf, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET sync_buf = excluded.sync_buf, updated_at = excluded.updated_at
    `).run(accountId, syncBuf, new Date().toISOString());
  }

  private getContextToken(accountId: string, peerId: string): string | undefined {
    const row = this.db.prepare('SELECT context_token FROM weixin_gateway_context_tokens WHERE account_id = ? AND peer_id = ?').get(accountId, peerId) as { context_token: string } | undefined;
    return row?.context_token;
  }

  private saveContextToken(accountId: string, peerId: string, contextToken: string): void {
    this.db.prepare(`
      INSERT INTO weixin_gateway_context_tokens (account_id, peer_id, context_token, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, peer_id) DO UPDATE SET context_token = excluded.context_token, updated_at = excluded.updated_at
    `).run(accountId, peerId, contextToken, new Date().toISOString());
  }

  private startTypingIndicator(config: WeixinGatewayConfig, chatId: string): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keepalive = async () => {
      try {
        await this.sendTypingIndicator(config, chatId, TYPING_STATUS_TYPING);
      } catch (error) {
        console.warn('[weixin-gateway] typing indicator failed:', error instanceof Error ? error.message : error);
      }
      if (!stopped) timer = setTimeout(keepalive, TYPING_KEEPALIVE_INTERVAL_MS);
    };
    void keepalive();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void this.sendTypingIndicator(config, chatId, TYPING_STATUS_CANCEL).catch((error) => {
        console.warn('[weixin-gateway] typing cancel failed:', error instanceof Error ? error.message : error);
      });
    };
  }

  private async sendTypingIndicator(config: WeixinGatewayConfig, chatId: string, status: number): Promise<void> {
    const typingTicket = await this.getTypingTicket(config, chatId);
    if (!typingTicket) return;
    const response = await this.weixinJsonRequest(config, 'ilink/bot/sendtyping', {
      ilink_user_id: chatId,
      typing_ticket: typingTicket,
      status,
    }, API_TIMEOUT_MS);
    const ret = Number(response.ret || 0);
    if (ret !== 0) throw new Error(`WeChat sendtyping failed: ret=${ret} errmsg=${stringValue(response.errmsg) || stringValue(response.msg) || 'unknown error'}`);
  }

  private async getTypingTicket(config: WeixinGatewayConfig, chatId: string): Promise<string> {
    const cacheKey = `${config.accountId}:${chatId}`;
    const cached = this.typingTickets.get(cacheKey);
    if (cached) return cached;

    const response = await this.weixinJsonRequest(config, 'ilink/bot/getconfig', {
      ilink_user_id: chatId,
      ...withContextToken(this.getContextToken(config.accountId, chatId)),
    }, API_TIMEOUT_MS);
    const ret = Number(response.ret || 0);
    if (ret !== 0) throw new Error(`WeChat getconfig failed: ret=${ret} errmsg=${stringValue(response.errmsg) || stringValue(response.msg) || 'unknown error'}`);

    const typingTicket = stringValue(response.typing_ticket);
    if (typingTicket) this.typingTickets.set(cacheKey, typingTicket);
    return typingTicket;
  }

  private async sendReply(config: WeixinGatewayConfig, chatId: string, text: string): Promise<void> {
    for (const chunk of splitWeixinText(text)) {
      await this.sendMessage(config, chatId, {
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: ITEM_TEXT, text_item: { text: chunk } }],
      });
      await delay(1000);
    }
  }

  private async sendMessage(config: WeixinGatewayConfig, chatId: string, msg: Record<string, unknown>): Promise<void> {
    const response = await this.weixinJsonRequest(config, 'ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: chatId,
        client_id: randomUUID(),
        message_type: MSG_TYPE_BOT,
        ...msg,
        ...withContextToken(this.getContextToken(config.accountId, chatId)),
      },
    }, API_TIMEOUT_MS);
    const ret = Number(response.ret || 0);
    const errcode = Number(response.errcode || 0);
    if (ret !== 0 || errcode !== 0) {
      throw new Error(`WeChat sendmessage failed: ret=${ret} errcode=${errcode} errmsg=${stringValue(response.errmsg) || stringValue(response.msg) || 'unknown error'}`);
    }
  }

  private async weixinGet(endpoint: string, baseUrl: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/${endpoint}`, {
        headers: {
          'ilink-app-id': ILINK_APP_ID,
          'ilink-app-clientversion': String(ILINK_APP_CLIENT_VERSION),
        },
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`iLink GET ${endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
      return asRecord(JSON.parse(raw));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async weixinJsonRequest(config: WeixinGatewayConfig, endpoint: string, payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } });
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, timeoutMs);
    this.abortController?.signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${config.baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: weixinHeaders(config.token, body),
        body,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`iLink POST ${endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
      return asRecord(JSON.parse(raw));
    } finally {
      clearTimeout(timeout);
      this.abortController?.signal.removeEventListener('abort', abort);
    }
  }
}

function weixinHeaders(token: string, _body: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorizationtype: 'ilink_bot_token',
    // Let undici/fetch calculate Content-Length. Supplying it manually can be rejected
    // before the iLink request is sent, leaving the bot shown as disconnected.
    'x-wechat-uin': randomUin(),
    'ilink-app-id': ILINK_APP_ID,
    'ilink-app-clientversion': String(ILINK_APP_CLIENT_VERSION),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function randomUin(): string {
  return Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString('base64');
}

function summarizeWeixinItem(item: Record<string, unknown>): Record<string, unknown> {
  const nestedKeys: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(item)) {
    const nested = asRecord(value);
    if (Object.keys(nested).length > 0) nestedKeys[key] = Object.keys(nested).sort();
  }
  return {
    type: item.type,
    keys: Object.keys(item).sort(),
    nestedKeys,
  };
}

function summarizeWeixinImageItem(imageItem: Record<string, unknown>): Record<string, unknown> {
  const scalarFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(imageItem)) {
    if (value && typeof value === 'object') continue;
    scalarFields[key] = summarizeScalarValue(value);
  }
  return {
    keys: Object.keys(imageItem).sort(),
    scalarFields,
    media: summarizeRecordScalars(asRecord(imageItem.media)),
  };
}

function summarizeRecordScalars(record: Record<string, unknown>): Record<string, unknown> {
  const scalars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object') continue;
    scalars[key] = summarizeScalarValue(value);
  }
  return scalars;
}

function summarizeScalarValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return {
    type: 'string',
    length: value.length,
    startsWithHttp: /^https?:\/\//i.test(value),
    startsWithSlash: value.startsWith('/'),
    sample: value.slice(0, 24),
  };
}

function extractText(items: Record<string, unknown>[]): string {
  for (const item of items) {
    if (Number(item.type) === ITEM_TEXT) {
      const textItem = asRecord(item.text_item);
      return stringValue(textItem.text);
    }
    if (Number(item.type) === ITEM_VOICE) {
      const voiceItem = asRecord(item.voice_item);
      // iLink includes WeChat-side speech recognition here when available.
      return stringValue(voiceItem.text);
    }
  }
  return '';
}

function collectWeixinImageCandidates(items: Record<string, unknown>[]): WeixinImageCandidate[] {
  const candidates: WeixinImageCandidate[] = [];
  items.forEach((item, index) => collectImageCandidatesFromRecord(item, `item_list[${index}]`, candidates, 0));
  return candidates;
}

function collectImageCandidatesFromRecord(
  record: Record<string, unknown>,
  source: string,
  candidates: WeixinImageCandidate[],
  depth: number,
  inheritedAesKey?: string,
): void {
  if (depth > 3 || candidates.length >= MAX_IMAGE_COUNT) return;

  const aesKey = firstUsableWeixinAesKey(record, inheritedAesKey);
  const data = firstString(record, ['data', 'base64', 'base64_data', 'image_base64', 'content']);
  const rawUrl = firstString(record, ['url', 'full_url', 'download_url', 'image_url', 'file_url', 'cdn_url', 'preview_url', 'thumb_url', 'media']);
  const url = looksDownloadableUrl(rawUrl) ? rawUrl : '';
  const encryptedQueryParam = firstString(record, ['encrypt_query_param', 'encrypted_query_param']);
  const mimeType = normalizeImageMimeType(firstString(record, ['mimeType', 'mime_type', 'content_type', 'contentType', 'type_name']));
  const parsedData = parseImageData(data, mimeType);
  const urlMimeType = url ? mimeTypeFromUrl(url) : undefined;
  const sourceLooksImage = /image|img|pic|thumb|preview/i.test(source);
  if ((parsedData && (sourceLooksImage || mimeType)) || ((url || encryptedQueryParam) && sourceLooksImage)) {
    candidates.push({
      source,
      data: parsedData?.data,
      url,
      encryptedQueryParam,
      mimeType: parsedData?.mimeType || mimeType || urlMimeType,
      aesKey,
    });
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    const nested = asRecord(value);
    if (Object.keys(nested).length === 0) continue;
    const keyLooksRelevant = /image|img|pic|media|file|cdn|thumb|preview/i.test(key);
    if (keyLooksRelevant || depth < 2) {
      collectImageCandidatesFromRecord(nested, `${source}.${key}`, candidates, depth + 1, aesKey);
    }
  }
}

function parseImageData(value: string, mimeType?: string): { data: string; mimeType?: string } | undefined {
  if (!value) return undefined;
  const dataUrl = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataUrl) return { mimeType: normalizeImageMimeType(dataUrl[1]) || mimeType, data: dataUrl[2].trim() };
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) return { data: value, mimeType };
  return undefined;
}

function imageContentFromCandidateData(candidate: WeixinImageCandidate): ImageContent {
  const data = candidate.data!;
  const sniffedMimeType = sniffImageMimeType(Buffer.from(data, 'base64'));
  // validateImages re-sniffs and compares MIME types, so prefer the bytes over gateway metadata.
  return { type: 'image', data, mimeType: sniffedMimeType || candidate.mimeType || 'image/jpeg' };
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return '';
}

function firstUsableWeixinAesKey(record: Record<string, unknown>, inheritedAesKey?: string): string | undefined {
  const aesKey = firstString(record, ['aeskey', 'aes_key']);
  if (!aesKey) return inheritedAesKey;
  try {
    parseWeixinAesKey(aesKey);
    return aesKey;
  } catch {
    return inheritedAesKey;
  }
}

function normalizeImageMimeType(value: string | null | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'jpg') return 'image/jpeg';
  if (normalized === 'jpeg' || normalized === 'png' || normalized === 'webp' || normalized === 'gif') return `image/${normalized}`;
  return normalized.startsWith('image/') ? normalized : undefined;
}

function looksDownloadableUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

function mimeTypeFromUrl(value: string): string | undefined {
  const pathname = value.split('?', 1)[0]?.toLowerCase() || '';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  return undefined;
}

function resolveWeixinUrl(baseUrl: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
}

function splitWeixinText(text: string): string[] {
  const normalized = text.trim() || '(empty response)';
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += 1900) {
    chunks.push(normalized.slice(index, index + 1900));
  }
  return chunks;
}

function withContextToken(contextToken?: string): Record<string, string> {
  return contextToken ? { context_token: contextToken } : {};
}

function parseDmPolicy(value?: string): WeixinGatewayConfig['dmPolicy'] {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'open' || normalized === 'allowlist' || normalized === 'disabled' || normalized === 'pairing' ? normalized : 'pairing';
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseList(value?: string): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) || [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

export function extractLastAssistantText(messages: any[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (typeof message.content === 'string') return message.content.trim();
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part: any) => typeof part === 'string' ? part : part?.text || part?.content || '')
        .join('')
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}
