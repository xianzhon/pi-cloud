// server/src/services/session-manager.ts
import { DefaultResourceLoader, ModelRuntime, SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentSession, InlineExtension, Skill } from '@earendil-works/pi-coding-agent';
import { execFile } from 'child_process';
import { createReadStream, type Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import { promisify } from 'util';
import { basename, dirname, join, resolve } from 'path';
import type { PiuiDatabase } from '../db/database.js';
import type { MemoryRuntime } from '../memory/runtime.js';
import type { AgentProfile, AppliedSkillPolicy, AvailableSkillInfo, CreateSessionResult, SessionCommandInfo, SessionInfo, SessionOptions, SessionRuntimeStatus } from '../types.js';
import { createWebuiAutoRenameExtension } from '../extensions/auto-rename.js';
import { expandHomePath } from '../utils/paths.js';
import { runWithAgentDirAndProxyEnv } from './profile-proxy.js';
import { SkillPolicyStore, type SkillPolicyRecord } from './skill-policy-store.js';
import type { WorktreeMetadataStore } from './worktree-metadata-store.js';

interface PiSessionServiceOptions {
  skillPolicyStore?: SkillPolicyStore;
  username?: string;
  db?: PiuiDatabase;
  memoryRuntime?: MemoryRuntime;
  worktreeMetadataStore?: Pick<WorktreeMetadataStore, 'getMany'>;
}

interface ResolvedSkillPolicy {
  mode: 'all' | 'enabled' | 'disabled';
  appliedSkills: string[];
  ignoredSkills: string[];
  presetId: string | null;
}

interface SessionListCacheEntry {
  expiresAt: number;
  sessions: SessionInfo[];
  promise?: Promise<SessionInfo[]>;
}

interface UserMessageCountCacheEntry {
  mtimeMs: number;
  count: number;
}

interface SessionDirHeader {
  id: string;
  cwd: string;
}

interface SessionManagerWithFile {
  getSessionFile?: () => string | undefined;
}

const AGENT_SESSION_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
const execFileAsync = promisify(execFile);
const PROXY_CHECK_URL = 'https://www.google.com/generate_204';
const PROXY_CHECK_ARGS = ['-fsSL', '--connect-timeout', '5', '--max-time', '10', PROXY_CHECK_URL];
const PROXY_COUNTRY_ARGS = ['-fsSL', '--connect-timeout', '5', '--max-time', '10', 'https://ipinfo.io/country'];
const PROXY_ENV_KEYS = ['ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy'];
const SESSION_LIST_CACHE_TTL_MS = 2000;
const USER_MESSAGE_COUNT_CONCURRENCY = 10;
const DEFAULT_AUTOMATION_PROVIDER = 'anthropic';
const DEFAULT_AUTOMATION_MODEL_ID = 'claude-haiku-4-5';
const LOCAL_LLM_PROVIDER_ID = 'pi-webui-local';
const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts';
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateNetworkHostname(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const octets = match.slice(1).map(Number);
    return octets.some((octet) => octet > 255)
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

function localLlmAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const value of (process.env.PI_WEBUI_LOCAL_LLM_ALLOWED_ORIGINS || '').split(',')) {
    try {
      const parsed = new URL(value.trim());
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password) {
        origins.add(parsed.origin);
      }
    } catch { /* Ignore malformed allowlist entries. */ }
  }
  return origins;
}

// Some environment variables authenticate multiple Pi providers. Saving each provider entry
// preserves the same behavior users get when they export the corresponding variable.
const API_KEY_PROVIDERS = [
  { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', providerIds: ['anthropic'] },
  { envVar: 'ANT_LING_API_KEY', label: 'Ant Ling', providerIds: ['ant-ling'] },
  { envVar: 'OPENAI_API_KEY', label: 'OpenAI GPT', providerIds: ['openai'] },
  { envVar: 'AZURE_OPENAI_API_KEY', label: 'Azure OpenAI', providerIds: ['azure-openai-responses'] },
  { envVar: 'DEEPSEEK_API_KEY', label: 'DeepSeek', providerIds: ['deepseek'] },
  { envVar: 'NVIDIA_API_KEY', label: 'NVIDIA NIM', providerIds: ['nvidia'] },
  { envVar: 'GEMINI_API_KEY', label: 'Google Gemini', providerIds: ['google'] },
  { envVar: 'GROQ_API_KEY', label: 'Groq', providerIds: ['groq'] },
  { envVar: 'CEREBRAS_API_KEY', label: 'Cerebras', providerIds: ['cerebras'] },
  { envVar: 'XAI_API_KEY', label: 'xAI Grok', providerIds: ['xai'] },
  { envVar: 'FIREWORKS_API_KEY', label: 'Fireworks', providerIds: ['fireworks'] },
  { envVar: 'TOGETHER_API_KEY', label: 'Together AI', providerIds: ['together'] },
  { envVar: 'BASETEN_API_KEY', label: 'Baseten', providerIds: ['baseten'] },
  { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter', providerIds: ['openrouter'] },
  { envVar: 'AI_GATEWAY_API_KEY', label: 'Vercel AI Gateway', providerIds: ['vercel-ai-gateway'] },
  { envVar: 'ZAI_API_KEY', label: 'ZAI Coding Plan (Global)', providerIds: ['zai'] },
  { envVar: 'ZAI_CODING_CN_API_KEY', label: 'ZAI Coding Plan (China)', providerIds: ['zai-coding-cn'] },
  { envVar: 'MISTRAL_API_KEY', label: 'Mistral', providerIds: ['mistral'] },
  { envVar: 'MINIMAX_API_KEY', label: 'MiniMax', providerIds: ['minimax'] },
  { envVar: 'MOONSHOT_API_KEY', label: 'Moonshot AI', providerIds: ['moonshotai', 'moonshotai-cn'] },
  { envVar: 'OPENCODE_API_KEY', label: 'OpenCode Zen / OpenCode Go', providerIds: ['opencode', 'opencode-go'] },
  { envVar: 'KIMI_API_KEY', label: 'Kimi For Coding', providerIds: ['kimi-coding'] },
  { envVar: 'CLOUDFLARE_API_KEY', label: 'Cloudflare', providerIds: ['cloudflare-workers-ai', 'cloudflare-ai-gateway'] },
  { envVar: 'QWEN_TOKEN_PLAN_API_KEY', label: 'Qwen Token Plan (International)', providerIds: ['qwen-token-plan'] },
  { envVar: 'QWEN_TOKEN_PLAN_CN_API_KEY', label: 'Qwen Token Plan (China)', providerIds: ['qwen-token-plan-cn'] },
  { envVar: 'XIAOMI_API_KEY', label: 'Xiaomi MiMo', providerIds: ['xiaomi'] },
  { envVar: 'XIAOMI_TOKEN_PLAN_CN_API_KEY', label: 'Xiaomi MiMo Token Plan (China)', providerIds: ['xiaomi-token-plan-cn'] },
  { envVar: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', label: 'Xiaomi MiMo Token Plan (Amsterdam)', providerIds: ['xiaomi-token-plan-ams'] },
  { envVar: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', label: 'Xiaomi MiMo Token Plan (Singapore)', providerIds: ['xiaomi-token-plan-sgp'] },
] as const;

type ProfileSettings = {
  proxy: Record<string, string>;
  autoRenameProvider: string;
  autoRenameModelId: string;
  autoRenameLanguage: 'english' | 'chinese';
  automationProvider: string;
  automationModelId: string;
};

export class PiSessionService {
  private skillPolicyStore?: SkillPolicyStore;
  private username: string;
  private memoryRuntime?: MemoryRuntime;
  private db?: PiuiDatabase;
  private worktreeMetadataStore?: Pick<WorktreeMetadataStore, 'getMany'>;
  private sessions: Map<string, AgentSession> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private currentClientSession: Map<string, string> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private clientProfiles: Map<string, string> = new Map();
  private sessionListCache: Map<string, SessionListCacheEntry> = new Map();
  private userMessageCountCache: Map<string, UserMessageCountCacheEntry> = new Map();

  constructor(options: PiSessionServiceOptions = {}) {
    this.skillPolicyStore = options.skillPolicyStore;
    this.username = options.username || 'me';
    this.db = options.db;
    this.memoryRuntime = options.memoryRuntime;
    this.worktreeMetadataStore = options.worktreeMetadataStore;
  }

  async listAgentProfiles(): Promise<AgentProfile[]> {
    const baseDir = join(os.homedir(), '.pi');
    const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
    const profileEntries: Dirent<string>[] = [];
    for (const entry of entries) {
      if (entry.name === 'agent') continue;
      const linkedTarget = entry.isSymbolicLink?.()
        ? await fs.stat(join(baseDir, entry.name)).catch(() => null)
        : null;
      if (entry.isDirectory() || linkedTarget?.isDirectory()) profileEntries.push(entry);
    }
    const profiles = await Promise.all(profileEntries.map(async (entry) => {
      const path = join(baseDir, entry.name);
      const settings = await this.readAgentSettings(path);
      const profileSettings = this.getProfileSettings(entry.name);
      return {
        id: entry.name,
        label: `${entry.name} (~/.pi/${entry.name})`,
        path,
        isDefault: false,
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        automationProvider: profileSettings.automationProvider,
        automationModel: profileSettings.automationModelId,
      };
    }));

    const defaultPath = join(baseDir, 'agent');
    const defaultSettings = await this.readAgentSettings(defaultPath);
    const defaultProfileSettings = this.getProfileSettings('default');

    return [
      {
        id: 'default',
        label: 'default (~/.pi/agent)',
        path: defaultPath,
        isDefault: true,
        defaultProvider: defaultSettings.defaultProvider,
        defaultModel: defaultSettings.defaultModel,
        automationProvider: defaultProfileSettings.automationProvider,
        automationModel: defaultProfileSettings.automationModelId,
      },
      ...profiles.sort((a, b) => a.id.localeCompare(b.id)),
    ];
  }

  async getClientAgentProfile(clientId: string): Promise<AgentProfile> {
    const profiles = await this.listAgentProfiles();
    const selectedProfileId = this.clientProfiles.get(clientId) || 'default';
    return profiles.find((profile) => profile.id === selectedProfileId) || profiles[0];
  }

  async setClientAgentProfile(clientId: string, profileId: string): Promise<AgentProfile> {
    const profiles = await this.listAgentProfiles();
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      throw new Error(`Unknown agent profile: ${profileId}`);
    }

    this.clientProfiles.set(clientId, profile.id);
    return profile;
  }

  async createAgentProfile(name: string, copySettingsFrom?: string): Promise<AgentProfile> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || name === 'agent' || name === 'default') {
      throw new Error('Profile name must use letters, numbers, hyphens, or underscores');
    }

    const baseDir = join(os.homedir(), '.pi');
    const profilePath = join(baseDir, name);
    try {
      if (copySettingsFrom) {
        const source = (await this.listAgentProfiles()).find((profile) => profile.id === copySettingsFrom);
        if (!source) throw new Error('Unknown source profile');
        await fs.cp(source.path, profilePath, {
          recursive: true,
          filter: (sourcePath) => sourcePath !== join(source.path, 'sessions'),
        });
      } else {
        await fs.mkdir(profilePath, { recursive: false });
      }
    } catch (error: any) {
      if (error?.code === 'EEXIST') throw new Error('A profile with that name already exists');
      throw error;
    }

    return (await this.listAgentProfiles()).find((profile) => profile.id === name)!;
  }

  async deleteAgentProfile(profileId: string): Promise<{ activeProfileChanged: boolean }> {
    if (profileId === 'default' || profileId === 'agent') throw new Error('The default profile cannot be deleted');
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');

    let activeProfileChanged = false;
    for (const [clientId, selectedProfile] of this.clientProfiles.entries()) {
      if (selectedProfile === profileId) {
        activeProfileChanged = true;
        this.clientProfiles.set(clientId, 'default');
        this.disposeSession(clientId);
      }
    }
    await fs.rm(profile.path, { recursive: true, force: false });
    this.memoryRuntime?.deleteProfile(profileId);
    return { activeProfileChanged };
  }

  async getAgentProfileProxy(profileId: string) {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    return this.getProfileSettings(profileId).proxy;
  }

  async getClientAgentProxyEnvForRoutes(clientId: string): Promise<Record<string, string>> {
    return (await this.getClientProfileProxyEnv(clientId)).proxyEnv;
  }

  async listAgentProfileApiKeyProviders(profileId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const config = await this.readModelsJson(profile.path);
    const customProviderIds = new Set(Object.entries(this.modelsJsonProviders(config)).flatMap(([id, value]) => (
      id !== LOCAL_LLM_PROVIDER_ID
        && value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.baseUrl === 'string' && Array.isArray(value.models)
        ? [id]
        : []
    )));
    const modelRuntime = await this.createProfileModelRuntime(profile.path);
    const providers = modelRuntime.getProviders().filter((provider) => !customProviderIds.has(provider.id));

    return Promise.all(providers.map(async (provider) => {
      // checkAuth only inspects local credentials and ambient configuration; it does not refresh OAuth tokens.
      const auth = await modelRuntime.checkAuth(provider.id);
      const status = modelRuntime.getProviderAuthStatus(provider.id);
      const apiKeyProvider = API_KEY_PROVIDERS.find(({ providerIds }) => (
        (providerIds as readonly string[]).includes(provider.id)
      ));
      const label = provider.id === 'openai'
        ? 'OpenAI API'
        : provider.id === 'openai-codex'
          ? 'OpenAI Codex / ChatGPT Plus/Pro'
          : provider.name;

      return {
        id: provider.id,
        label,
        envVar: apiKeyProvider?.envVar,
        configured: Boolean(auth),
        authType: auth?.type,
        source: status.source,
        sourceLabel: auth?.source,
        subscription: auth?.type === 'oauth' && provider.auth.oauth?.isSubscription === true,
      };
    }));
  }

  async saveAgentProfileApiKey(profileId: string, envVar: string, apiKey: string) {
    const profile = await this.requireAgentProfile(profileId);
    const provider = API_KEY_PROVIDERS.find((item) => item.envVar === envVar);
    if (!provider) throw new Error('Unknown API key provider');
    if (!apiKey.trim()) throw new Error('API key is required');

    const modelRuntime = await this.createProfileModelRuntime(profile.path);
    for (const providerId of provider.providerIds) {
      await modelRuntime.login(providerId, 'api_key', {
        prompt: async () => apiKey.trim(),
        notify: () => {},
      });
    }
    return this.listAgentProfileApiKeyProviders(profileId);
  }

  async removeAgentProfileApiKey(profileId: string, envVar: string) {
    const profile = await this.requireAgentProfile(profileId);
    const provider = API_KEY_PROVIDERS.find((item) => item.envVar === envVar);
    if (!provider) throw new Error('Unknown API key provider');

    const modelRuntime = await this.createProfileModelRuntime(profile.path);
    for (const providerId of provider.providerIds) await modelRuntime.logout(providerId);
    return this.listAgentProfileApiKeyProviders(profileId);
  }

  async logoutAgentProfileProvider(profileId: string, providerId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const modelRuntime = await this.createProfileModelRuntime(profile.path);
    if (!modelRuntime.getProvider(providerId)) throw new Error('Unknown authentication provider');

    await modelRuntime.logout(providerId);
    return this.listAgentProfileApiKeyProviders(profileId);
  }

  async listAgentProfileModels(profileId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const modelRuntime = await this.createProfileModelRuntime(profile.path);
    return (await modelRuntime.getAvailable()).map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
      input: model.input,
      current: profile.defaultProvider === model.provider && profile.defaultModel === model.id,
    }));
  }

  async listAgentProfileCustomProviders(profileId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const config = await this.readModelsJson(profile.path);
    const modelRuntime = await this.createProfileModelRuntime(profile.path);
    return Object.entries(this.modelsJsonProviders(config)).flatMap(([id, value]) => {
      if (id === LOCAL_LLM_PROVIDER_ID || !value || typeof value !== 'object' || Array.isArray(value)) return [];
      const provider = value as Record<string, any>;
      if (typeof provider.baseUrl !== 'string' || !Array.isArray(provider.models)) return [];
      const status = modelRuntime.getProviderAuthStatus(id);
      const models = provider.models as unknown[];
      return [{
        id,
        baseUrl: provider.baseUrl,
        modelIds: models.flatMap((model) => this.localModelId(model) || []),
        imageModelIds: models.flatMap((model) => {
          const modelId = this.localModelId(model);
          return modelId && this.modelSupportsImages(model) ? [modelId] : [];
        }),
        configured: status.configured || typeof provider.apiKey === 'string',
      }];
    });
  }

  async discoverAgentProfileCustomProvider(profileId: string, baseUrl: string, apiKey?: string) {
    await this.requireAgentProfile(profileId);
    return this.discoverOpenAiModels(this.normalizeCustomProviderBaseUrl(baseUrl), apiKey);
  }

  async discoverAgentProfileCloudflareModels(profileId: string, accountId: string, apiKey?: string) {
    await this.requireAgentProfile(profileId);
    const normalizedAccountId = accountId.trim();
    const key = apiKey?.trim();
    if (!/^[a-f0-9]{32}$/i.test(normalizedAccountId)) throw new Error('Enter a valid Cloudflare Account ID');
    if (!key) throw new Error('Cloudflare API token is required to load models');

    const models = new Map<string, boolean>();
    let page = 1;
    let totalPages = 1;
    do {
      const endpoint = `${CLOUDFLARE_API_BASE_URL}/${normalizedAccountId}/ai/models/search?page=${page}&per_page=50`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null) as {
        success?: boolean;
        errors?: Array<{ message?: unknown }>;
        result?: unknown;
        result_info?: { total_pages?: unknown; total_count?: unknown; per_page?: unknown };
      } | null;
      if (!response.ok || body?.success === false) {
        const cloudflareMessage = body?.errors
          ?.map((error) => typeof error.message === 'string' ? error.message.trim() : '')
          .filter(Boolean)
          .join('; ');
        throw new Error(cloudflareMessage
          ? `Cloudflare: ${cloudflareMessage}`
          : `Cloudflare returned HTTP ${response.status}`);
      }
      if (!body) throw new Error('Cloudflare returned an invalid model catalog response');
      const candidates = Array.isArray(body.result) ? body.result : [];
      for (const model of candidates) {
        if (!model || typeof model !== 'object') continue;
        const candidate = model as {
          id?: unknown;
          name?: unknown;
          task?: { name?: unknown };
          properties?: Array<{ property_id?: unknown; value?: unknown }>;
        };
        const modelId = [candidate.name, candidate.id]
          .find((value) => typeof value === 'string' && /^@(cf|hf)\//.test(value)) as string | undefined;
        if (!modelId) continue;
        const taskName = typeof candidate.task?.name === 'string' ? candidate.task.name : '';
        if (!/(text generation|text-to-text|image-to-text|vision)/i.test(taskName)) continue;
        const hasVisionProperty = candidate.properties?.some((property) => property.property_id === 'vision'
          && (property.value === true || property.value === 'true')) || false;
        const supportsImages = hasVisionProperty
          || /(image|vision)/i.test(taskName)
          || /(vision|llava|moondream|uform)/i.test(modelId);
        models.set(modelId, (models.get(modelId) || false) || supportsImages);
      }
      const resultInfo = body.result_info;
      const reportedTotalPages = resultInfo?.total_pages;
      const calculatedTotalPages = typeof resultInfo?.total_count === 'number'
        && typeof resultInfo.per_page === 'number'
        && resultInfo.per_page > 0
        ? Math.ceil(resultInfo.total_count / resultInfo.per_page)
        : 1;
      totalPages = typeof reportedTotalPages === 'number' && Number.isSafeInteger(reportedTotalPages)
        ? Math.max(1, Math.min(reportedTotalPages, 100))
        : Math.max(1, Math.min(calculatedTotalPages, 100));
      page += 1;
    } while (page <= totalPages);

    if (models.size === 0) throw new Error('Cloudflare returned no chat-compatible Workers AI models');
    return [...models.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, supportsImages]) => ({ id, supportsImages }));
  }

  async saveAgentProfileCustomProvider(profileId: string, providerId: string, baseUrl: string, modelIds: string[], imageModelIds?: string[], apiKey?: string) {
    const profile = await this.requireAgentProfile(profileId);
    const id = this.normalizeCustomProviderId(providerId);
    const normalizedBaseUrl = this.normalizeCustomProviderBaseUrl(baseUrl);
    const normalizedModelIds = [...new Set(modelIds.map((modelId) => modelId.trim()).filter(Boolean))];
    const normalizedImageModelIds = imageModelIds === undefined
      ? undefined
      : new Set(imageModelIds.map((modelId) => modelId.trim()).filter((modelId) => normalizedModelIds.includes(modelId)));
    if (normalizedModelIds.length === 0) throw new Error('Select at least one model');

    const config = await this.readModelsJson(profile.path);
    const previousConfig = `${JSON.stringify(config, null, 2)}\n`;
    const providers = this.modelsJsonProviders(config);
    const existing = providers[id];
    const existingModels = new Map<string, Record<string, unknown>>();
    if (existing && typeof existing === 'object' && !Array.isArray(existing) && Array.isArray(existing.models)) {
      for (const model of existing.models) {
        const modelId = this.localModelId(model);
        if (modelId) existingModels.set(modelId, model as Record<string, unknown>);
      }
    }
    const key = apiKey?.trim();
    if (!key && !(existing && typeof existing === 'object' && !Array.isArray(existing) && typeof existing.apiKey === 'string')) {
      const status = (await this.createProfileModelRuntime(profile.path)).getProviderAuthStatus(id);
      if (!status.configured) throw new Error('API key is required');
    }

    providers[id] = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      baseUrl: normalizedBaseUrl,
      api: 'openai-completions',
      models: normalizedModelIds.map((modelId) => {
        const model = existingModels.get(modelId) || { id: modelId };
        if (normalizedImageModelIds === undefined) return model;
        return { ...model, input: normalizedImageModelIds.has(modelId) ? ['text', 'image'] : ['text'] };
      }),
    };
    if (key) delete providers[id].apiKey;
    config.providers = providers;
    await fs.mkdir(profile.path, { recursive: true });
    await fs.writeFile(join(profile.path, 'models.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    if (key) {
      try {
        const modelRuntime = await this.createProfileModelRuntime(profile.path);
        await modelRuntime.login(id, 'api_key', { prompt: async () => key, notify: () => {} });
      } catch (error) {
        await fs.writeFile(join(profile.path, 'models.json'), previousConfig, 'utf8');
        throw error;
      }
    }
    const savedModels = providers[id].models as Record<string, unknown>[];
    return {
      id,
      baseUrl: normalizedBaseUrl,
      modelIds: normalizedModelIds,
      imageModelIds: savedModels.flatMap((model) => this.modelSupportsImages(model) ? [model.id as string] : []),
      configured: true,
    };
  }

  async removeAgentProfileCustomProvider(profileId: string, providerId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const id = this.normalizeCustomProviderId(providerId);
    const config = await this.readModelsJson(profile.path);
    const providers = this.modelsJsonProviders(config);
    if (!providers[id] || id === LOCAL_LLM_PROVIDER_ID) throw new Error('Unknown custom provider');
    delete providers[id];
    config.providers = providers;
    await fs.mkdir(profile.path, { recursive: true });
    await fs.writeFile(join(profile.path, 'models.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const settingsPath = join(profile.path, 'settings.json');
    const settingsContent = await fs.readFile(settingsPath, 'utf8').catch(() => '');
    try {
      const settings = settingsContent.trim() ? JSON.parse(settingsContent) as Record<string, unknown> : {};
      if (settings.defaultProvider === id) {
        delete settings.defaultProvider;
        delete settings.defaultModel;
        await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      }
    } catch { /* Ignore unrelated invalid settings while removing the provider. */ }
    this.db?.prepare(`
      UPDATE agent_profile_settings
      SET automation_provider = NULL, automation_model_id = NULL, updated_at = ?
      WHERE profile_id = ? AND automation_provider = ?
    `).run(new Date().toISOString(), profileId, id);
    await (await this.createProfileModelRuntime(profile.path)).logout(id);
    return { id };
  }

  async getAgentProfileLocalLlm(profileId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const config = await this.readModelsJson(profile.path);
    const provider = this.getLocalLlmProvider(config);
    const providerModels = provider?.models;
    const models: unknown[] = Array.isArray(providerModels) ? providerModels : [];
    return {
      baseUrl: typeof provider?.baseUrl === 'string' ? provider.baseUrl : '',
      modelIds: models.flatMap((model) => {
        const id = this.localModelId(model);
        return id ? [id] : [];
      }),
    };
  }

  async discoverAgentProfileLocalLlm(profileId: string, baseUrl: string) {
    await this.requireAgentProfile(profileId);
    const endpoint = `${this.normalizeLocalLlmBaseUrl(baseUrl)}/models`;
    const response = await fetch(endpoint, {
      redirect: 'manual',
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Local LLM returned HTTP ${response.status}`);

    const body = await response.json() as { data?: unknown; models?: unknown };
    const candidates = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    const modelIds = candidates.flatMap((model) => {
      if (!model || typeof model !== 'object') return [];
      const candidate = model as { id?: unknown; name?: unknown; model?: unknown };
      const id = [candidate.id, candidate.model, candidate.name].find((value) => typeof value === 'string' && value.trim());
      return typeof id === 'string' ? [id.trim()] : [];
    });
    if (modelIds.length === 0) throw new Error('No models were returned by the local LLM');
    return [...new Set(modelIds)].sort((a, b) => a.localeCompare(b)).map((id) => ({ id }));
  }

  async removeAgentProfileLocalLlm(profileId: string) {
    const profile = await this.requireAgentProfile(profileId);
    const config = await this.readModelsJson(profile.path);
    const providers = this.modelsJsonProviders(config);
    delete providers[LOCAL_LLM_PROVIDER_ID];
    config.providers = providers;
    await fs.mkdir(profile.path, { recursive: true });
    await fs.writeFile(join(profile.path, 'models.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const settingsPath = join(profile.path, 'settings.json');
    const settingsContent = await fs.readFile(settingsPath, 'utf8').catch(() => '');
    try {
      const settings = settingsContent.trim() ? JSON.parse(settingsContent) as Record<string, unknown> : {};
      if (settings.defaultProvider === LOCAL_LLM_PROVIDER_ID) {
        delete settings.defaultProvider;
        delete settings.defaultModel;
        await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      }
    } catch { /* Ignore unrelated invalid settings while removing the local provider. */ }
    this.db?.prepare(`
      UPDATE agent_profile_settings
      SET automation_provider = NULL, automation_model_id = NULL, updated_at = ?
      WHERE profile_id = ? AND automation_provider = ?
    `).run(new Date().toISOString(), profileId, LOCAL_LLM_PROVIDER_ID);
    return { baseUrl: '', modelIds: [] };
  }

  async saveAgentProfileLocalLlm(profileId: string, baseUrl: string, modelIds: string[]) {
    const profile = await this.requireAgentProfile(profileId);
    const normalizedBaseUrl = this.normalizeLocalLlmBaseUrl(baseUrl);
    const normalizedModelIds = [...new Set(modelIds.map((id) => id.trim()).filter(Boolean))];
    if (normalizedModelIds.length === 0) throw new Error('Select at least one local model');

    const config = await this.readModelsJson(profile.path);
    const providers = this.modelsJsonProviders(config);
    const existing = this.getLocalLlmProvider(config);
    const existingModels = new Map<string, Record<string, unknown>>();
    const configuredModels = existing?.models;
    for (const model of Array.isArray(configuredModels) ? configuredModels : []) {
      const id = this.localModelId(model);
      if (id) existingModels.set(id, model as Record<string, unknown>);
    }
    const existingCompat = existing?.compat;
    providers[LOCAL_LLM_PROVIDER_ID] = {
      ...existing,
      baseUrl: normalizedBaseUrl,
      api: 'openai-completions',
      // Pi requires configured auth for a custom model to become available; local servers ignore this placeholder.
      apiKey: 'local',
      compat: {
        ...(existingCompat && typeof existingCompat === 'object' ? existingCompat : {}),
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
      models: normalizedModelIds.map((id) => ({
        input: ['text', 'image'],
        ...(existingModels.get(id) || { id }),
      })),
    };
    config.providers = providers;
    await fs.mkdir(profile.path, { recursive: true });
    await fs.writeFile(join(profile.path, 'models.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return { baseUrl: normalizedBaseUrl, modelIds: normalizedModelIds };
  }

  private async readModelsJson(profilePath: string): Promise<Record<string, any>> {
    const content = await fs.readFile(join(profilePath, 'models.json'), 'utf8').catch(() => '');
    if (!content.trim()) return {};
    try {
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch {
      throw new Error('models.json contains invalid JSON');
    }
  }

  private modelsJsonProviders(config: Record<string, any>): Record<string, any> {
    return config.providers && typeof config.providers === 'object' && !Array.isArray(config.providers)
      ? config.providers
      : {};
  }

  private getLocalLlmProvider(config: Record<string, any>): Record<string, any> | undefined {
    const provider = this.modelsJsonProviders(config)[LOCAL_LLM_PROVIDER_ID];
    return provider && typeof provider === 'object' && !Array.isArray(provider) ? provider : undefined;
  }

  private localModelId(model: unknown): string | undefined {
    if (!model || typeof model !== 'object') return undefined;
    const id = (model as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() ? id.trim() : undefined;
  }

  private normalizeCustomProviderId(providerId: string): string {
    const id = providerId.trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id === LOCAL_LLM_PROVIDER_ID) {
      throw new Error('Provider ID must use lowercase letters, numbers, dots, hyphens, or underscores');
    }
    return id;
  }

  private normalizeCustomProviderBaseUrl(baseUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl.trim());
    } catch {
      throw new Error('Enter a valid custom provider URL');
    }
    if (parsed.protocol !== 'https:') throw new Error('Custom provider URL must use HTTPS');
    if (parsed.username || parsed.password) throw new Error('Custom provider URL must not include credentials');
    if (isLoopbackHostname(parsed.hostname) || isPrivateNetworkHostname(parsed.hostname)) {
      throw new Error('Use Local LLM for loopback or private-network endpoints');
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  }

  private modelSupportsImages(model: unknown): boolean {
    if (!model || typeof model !== 'object') return false;
    const value = model as Record<string, any>;
    const modalityLists = [
      value.input,
      value.input_modalities,
      value.modalities,
      value.architecture?.input_modalities,
      value.model_info?.input_modalities,
    ];
    const declaredModalities = modalityLists.filter(Array.isArray);
    if (declaredModalities.length) return declaredModalities.some((modalities) => modalities.includes('image'));
    const capabilityFlags = [
      value.supports_vision,
      value.supportsVision,
      value.capabilities?.vision,
      value.capabilities?.image,
      value.model_info?.supports_vision,
    ].filter((supported) => typeof supported === 'boolean');
    if (capabilityFlags.length) return capabilityFlags.some((supported) => supported === true);
    return [value.id, value.model, value.name]
      .some((name) => typeof name === 'string' && name.toLowerCase().includes('image'));
  }

  private async discoverOpenAiModels(baseUrl: string, apiKey?: string) {
    const response = await fetch(`${baseUrl}/models`, {
      headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Custom provider returned HTTP ${response.status}`);
    const body = await response.json() as { data?: unknown; models?: unknown };
    const candidates = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    const models = new Map<string, boolean>();
    for (const model of candidates) {
      if (!model || typeof model !== 'object') continue;
      const candidate = model as { id?: unknown; name?: unknown; model?: unknown };
      const id = [candidate.id, candidate.model, candidate.name].find((value) => typeof value === 'string' && value.trim());
      if (typeof id !== 'string') continue;
      const normalizedId = id.trim();
      models.set(normalizedId, (models.get(normalizedId) || false) || this.modelSupportsImages(model));
    }
    if (models.size === 0) throw new Error('No models were returned by the custom provider');
    return [...models.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, supportsImages]) => ({ id, supportsImages }));
  }

  private normalizeLocalLlmBaseUrl(baseUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl.trim());
    } catch {
      throw new Error('Enter a valid local LLM endpoint URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Local LLM endpoint must use HTTP or HTTPS');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Local LLM endpoint must not include credentials');
    }
    if (!isLoopbackHostname(parsed.hostname) && !localLlmAllowedOrigins().has(parsed.origin)) {
      throw new Error('Local LLM endpoint origin is not allowed');
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  }

  private async requireAgentProfile(profileId: string): Promise<AgentProfile> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    return profile;
  }

  async saveAgentProfileDefaultModel(profileId: string, provider: string, modelId: string): Promise<AgentProfile> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    const models = await this.listAgentProfileModels(profileId);
    if (!models.some((model) => model.provider === provider && model.id === modelId)) {
      throw new Error(`Unknown model: ${provider}/${modelId}`);
    }

    const settingsPath = join(profile.path, 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf8').catch(() => '');
    let settings: Record<string, unknown> = {};
    try { settings = content.trim() ? JSON.parse(content) : {}; } catch { /* replace invalid settings */ }
    settings.defaultProvider = provider;
    settings.defaultModel = modelId;
    await fs.mkdir(profile.path, { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return { ...profile, defaultProvider: provider, defaultModel: modelId };
  }

  private getProfileSettings(profileId: string): ProfileSettings {
    if (!this.db) {
      return {
        proxy: {},
        autoRenameProvider: DEFAULT_AUTOMATION_PROVIDER,
        autoRenameModelId: DEFAULT_AUTOMATION_MODEL_ID,
        autoRenameLanguage: 'english',
        automationProvider: DEFAULT_AUTOMATION_PROVIDER,
        automationModelId: DEFAULT_AUTOMATION_MODEL_ID,
      };
    }
    const row = this.db.prepare('SELECT * FROM agent_profile_settings WHERE profile_id = ?').get(profileId) as {
      proxy_json?: string;
      auto_rename_provider?: string;
      auto_rename_model_id?: string;
      auto_rename_language?: 'english' | 'chinese';
      automation_provider?: string;
      automation_model_id?: string;
    } | undefined;
    let proxy: Record<string, string> = {};
    try {
      proxy = row?.proxy_json ? JSON.parse(row.proxy_json) : {};
    } catch {
      proxy = {};
    }
    return {
      proxy,
      autoRenameProvider: row?.auto_rename_provider || DEFAULT_AUTOMATION_PROVIDER,
      autoRenameModelId: row?.auto_rename_model_id || DEFAULT_AUTOMATION_MODEL_ID,
      autoRenameLanguage: row?.auto_rename_language || 'english',
      automationProvider: row?.automation_provider || row?.auto_rename_provider || DEFAULT_AUTOMATION_PROVIDER,
      automationModelId: row?.automation_model_id || row?.auto_rename_model_id || DEFAULT_AUTOMATION_MODEL_ID,
    };
  }

  private saveProfileProxy(profileId: string, proxy: Record<string, string>): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT INTO agent_profile_settings (profile_id, proxy_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        proxy_json = excluded.proxy_json,
        -- Backfill profiles created before automation had its own setting.
        automation_provider = COALESCE(agent_profile_settings.automation_provider, agent_profile_settings.auto_rename_provider),
        automation_model_id = COALESCE(agent_profile_settings.automation_model_id, agent_profile_settings.auto_rename_model_id),
        updated_at = excluded.updated_at
    `).run(profileId, JSON.stringify(proxy), new Date().toISOString());
  }

  private saveProfileAutomationModel(profileId: string, provider: string, modelId: string): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT INTO agent_profile_settings (profile_id, automation_provider, automation_model_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        automation_provider = excluded.automation_provider,
        automation_model_id = excluded.automation_model_id,
        updated_at = excluded.updated_at
    `).run(profileId, provider, modelId, new Date().toISOString());
  }

  private saveProfileAutoRenameLanguage(profileId: string, language: 'english' | 'chinese'): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT INTO agent_profile_settings (profile_id, auto_rename_language, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        auto_rename_language = excluded.auto_rename_language,
        updated_at = excluded.updated_at
    `).run(profileId, language, new Date().toISOString());
  }

  async saveAgentProfileProxy(profileId: string, proxyEnv: Record<string, unknown>): Promise<void> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    const allowedKeys = ['ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
    const proxy: Record<string, string> = {};
    for (const key of allowedKeys) {
      const value = proxyEnv[key];
      if (typeof value === 'string' && value.trim()) proxy[key] = value.trim();
    }
    this.saveProfileProxy(profileId, proxy);
  }

  async checkAgentProfileProxy(profileId: string, proxyEnv?: Record<string, unknown>): Promise<{ ok: boolean; country?: string }> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');

    const env = await this.buildProxyCheckEnv(profile.path, proxyEnv);
    try {
      await execFileAsync('curl', PROXY_CHECK_ARGS, { env, timeout: 12_000 });
    } catch {
      return { ok: false };
    }

    try {
      const output = await execFileAsync('curl', PROXY_COUNTRY_ARGS, { env, timeout: 12_000 });
      const stdout = typeof output === 'string' ? output : output.stdout;
      const country = stdout.trim().toUpperCase();
      return /^[A-Z]{2}$/.test(country) ? { ok: true, country } : { ok: true };
    } catch {
      return { ok: true };
    }
  }

  private async buildProxyCheckEnv(profilePath: string, proxyEnv?: Record<string, unknown>): Promise<NodeJS.ProcessEnv> {
    const profileId = (await this.listAgentProfiles()).find((item) => item.path === profilePath)?.id;
    const sourceEnv: Record<string, unknown> = proxyEnv || (profileId ? this.getProfileSettings(profileId).proxy : {});
    const env = { ...process.env };
    for (const key of PROXY_ENV_KEYS) delete env[key];
    for (const key of PROXY_ENV_KEYS) {
      const value = sourceEnv[key];
      if (typeof value === 'string' && value.trim()) env[key] = value.trim();
    }
    return env;
  }

  async getAgentProfileAutomationModel(profileId: string): Promise<{ provider: string; modelId: string }> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    const config = this.getProfileSettings(profileId);
    return { provider: config.automationProvider, modelId: config.automationModelId };
  }

  async saveAgentProfileAutomationModel(profileId: string, provider: string, modelId: string): Promise<{ provider: string; modelId: string }> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    const models = await this.listAgentProfileModels(profileId);
    if (!models.some((model) => model.provider === provider && model.id === modelId)) {
      throw new Error(`Unknown model: ${provider}/${modelId}`);
    }

    this.saveProfileAutomationModel(profileId, provider, modelId);
    return { provider, modelId };
  }

  async getAgentProfileAutoRenameConfig(profileId: string): Promise<{ language: 'english' | 'chinese' }> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    const config = this.getProfileSettings(profileId);
    return { language: config.autoRenameLanguage };
  }

  async saveAgentProfileAutoRenameConfig(
    profileId: string,
    input: { language?: string },
  ): Promise<{ language: 'english' | 'chinese' }> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('Unknown agent profile');
    const language = this.normalizeAutoRenameLanguage(input.language || '');
    if (!language) throw new Error('language is required');

    this.saveProfileAutoRenameLanguage(profileId, language);
    return { language };
  }

  async listSessions(clientId: string, projectPath?: string): Promise<SessionInfo[]> {
    let cacheKey: string | undefined;
    try {
      const agentDir = await this.getClientAgentDir(clientId);
      const cwd = projectPath ? expandHomePath(projectPath) : undefined;
      cacheKey = `${agentDir}\u0000${cwd || '*'}`;
      const now = Date.now();
      const cached = this.sessionListCache.get(cacheKey);
      if (cached && cached.expiresAt > now) return cached.sessions;
      if (cached?.promise) return cached.promise;

      const promise = this.readSessionList(agentDir, cwd);
      this.sessionListCache.set(cacheKey, { expiresAt: now + SESSION_LIST_CACHE_TTL_MS, sessions: cached?.sessions || [], promise });
      const sessions = await promise;
      this.sessionListCache.set(cacheKey, { expiresAt: Date.now() + SESSION_LIST_CACHE_TTL_MS, sessions });
      return sessions;
    } catch (error) {
      if (cacheKey) this.sessionListCache.delete(cacheKey);
      console.error('Failed to list sessions:', error);
      return [];
    }
  }

  async listProjectPaths(clientId: string): Promise<string[]> {
    const agentDir = await this.getClientAgentDir(clientId);
    const sessionsRoot = join(agentDir, 'sessions');
    const entries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const headers = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readSessionDirHeader(join(sessionsRoot, entry.name))),
    );
    const validHeaders = headers.filter((header): header is SessionDirHeader => Boolean(header?.id && header.cwd));
    const worktrees = this.worktreeMetadataStore?.getMany(validHeaders.map((header) => header.id))
      ?? new Map<string, { baseRepoPath: string }>();
    const paths = validHeaders.map((header) => worktrees.get(header.id)?.baseRepoPath || header.cwd);
    return Array.from(new Set(paths.filter((path) => path.trim())));
  }

  async getSessionSummary(clientId: string, sessionId: string): Promise<SessionInfo | undefined> {
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) {
      const sessionPath = (activeSession.sessionManager as SessionManagerWithFile).getSessionFile?.() || '';
      const cwd = this.getSessionManagerCwd(activeSession.sessionManager, sessionPath);
      const firstUserMessage = this.getFirstUserMessageContent(activeSession.messages);
      return {
        id: activeSession.sessionId,
        name: activeSession.sessionManager.getSessionName(),
        path: sessionPath || cwd,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        messageCount: activeSession.messages.filter((message) => message.role === 'user').length,
        cwd,
        firstMessage: typeof firstUserMessage === 'string' ? firstUserMessage : undefined,
        isStreaming: activeSession.isStreaming,
      };
    }

    return this.findPersistedSession(clientId, sessionId);
  }

  invalidateSessionListCache(): void {
    this.sessionListCache.clear();
  }

  private async readSessionList(agentDir: string, cwd?: string): Promise<SessionInfo[]> {
    const sessions = cwd
      ? await SessionManager.list(cwd, this.getProjectSessionDir(cwd, agentDir))
      : await this.listAllSessions(agentDir);

    // The upstream list API counts assistant and user entries together. Counting user
    // entries requires reading each JSONL file, so keep this behind the existing short
    // session-list cache rather than doing it on every sidebar render.
    const userMessageCounts = await this.countUserMessages(sessions.map((session: any) => session.path));

    return sessions.map((session: any) => ({
      id: session.id,
      name: session.name === '(no messages)' ? undefined : session.name,
      path: session.path,
      created: session.created || session.createdAt,
      modified: session.modified || session.updatedAt,
      messageCount: userMessageCounts.get(session.path) || 0,
      cwd: session.cwd,
      firstMessage: session.firstMessage === '(no messages)' ? undefined : session.firstMessage,
      allMessagesText: session.allMessagesText,
    }));
  }

  private async countUserMessages(paths: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < paths.length) {
        const path = paths[nextIndex++];
        let count = 0;
        try {
          const mtimeMs = (await fs.stat(path)).mtimeMs;
          const cached = this.userMessageCountCache.get(path);
          if (cached?.mtimeMs === mtimeMs) {
            counts.set(path, cached.count);
            continue;
          }

          const stream = createReadStream(path, { encoding: 'utf8' });
          let buffer = '';
          for await (const chunk of stream as unknown as AsyncIterable<string>) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry?.type === 'message' && entry.message?.role === 'user') count++;
              } catch {
                // Ignore malformed lines just as the upstream session listing does.
              }
            }
          }
          if (buffer) {
            try {
              const entry = JSON.parse(buffer);
              if (entry?.type === 'message' && entry.message?.role === 'user') count++;
            } catch {
              // Ignore a malformed trailing line.
            }
          }
          const finalMtimeMs = (await fs.stat(path)).mtimeMs;
          this.userMessageCountCache.set(path, { mtimeMs: finalMtimeMs, count });
        } catch {
          // A session can disappear between directory listing and file reading.
        }
        counts.set(path, count);
      }
    };

    await Promise.all(Array.from({ length: Math.min(USER_MESSAGE_COUNT_CONCURRENCY, paths.length) }, worker));
    return counts;
  }

  async createSession(clientId: string, options: SessionOptions = {}): Promise<CreateSessionResult> {
    this.cancelCleanup(clientId);

    const cwd = expandHomePath(options.cwd || process.cwd());
    const { profile, agentDir } = await this.getClientProfileProxyEnv(clientId, options.agentProfileId);
    const sessionManager = options.noSession
      ? SessionManager.inMemory(cwd)
      : SessionManager.create(cwd, this.getProjectSessionDir(cwd, agentDir));
    const availableSkills = await this.loadSkills(cwd, agentDir);
    const skillPolicy = this.resolveAppliedSkillPolicy(availableSkills, options);
    const memoryEnabled = Boolean(this.memoryRuntime) && options.memoryEnabled !== false && !options.noSession;
    const autoRenameConfig = this.getProfileSettings(profile.id);
    const extensionFactories = this.createInlineExtensions({
      profileId: profile.id,
      cwd,
      memoryEnabled,
      autoRenameEnabled: !options.noSession,
      autoRenameConfig,
    });
    const resourceLoader = await this.createResourceLoader(cwd, agentDir, skillPolicy, extensionFactories);
    const modeOptions = { tools: [...AGENT_SESSION_TOOLS, ...(memoryEnabled ? ['memory'] : [])] };

    const { session } = await createAgentSession({
      sessionManager,
      agentDir,
      resourceLoader,
      ...modeOptions,
    });

    if (options.modelProvider && options.modelId) {
      await this.setModelForSession(session, options.modelProvider, options.modelId);
    }
    this.registerClientSession(clientId, session);
    if (!options.noSession) {
      this.skillPolicyStore?.save({
        sessionId: session.sessionId,
        username: this.username,
        mode: skillPolicy.mode,
        skills: skillPolicy.appliedSkills,
        presetId: skillPolicy.presetId,
      });
    }
    this.invalidateSessionListCache();
    return { session, skillPolicy };
  }

  async resumeSession(clientId: string, sessionPath: string): Promise<AgentSession> {
    this.cancelCleanup(clientId);

    const { profile, agentDir } = await this.getClientProfileProxyEnv(clientId);
    const sessionManager = SessionManager.open(sessionPath, dirname(sessionPath));
    const cwd = this.getSessionManagerCwd(sessionManager, sessionPath);
    const extensionFactories = this.createInlineExtensions({
      profileId: profile.id,
      cwd,
      memoryEnabled: Boolean(this.memoryRuntime),
      autoRenameEnabled: true,
      autoRenameConfig: this.getProfileSettings(profile.id),
    });
    const resourceLoader = await this.createResourceLoader(
      cwd,
      agentDir,
      this.policyFromStoredRecord(sessionPath),
      extensionFactories,
    );

    const { session } = await createAgentSession({
      sessionManager,
      agentDir,
      resourceLoader,
      tools: AGENT_SESSION_TOOLS,
    });

    const existing = this.getSessionBySessionId(session.sessionId);
    if (existing) {
      session.dispose();
      this.registerClientSession(clientId, existing);
      return existing;
    }

    this.registerClientSession(clientId, session);
    return session;
  }

  async readSessionSnapshot(clientId: string, sessionPath: string): Promise<Pick<AgentSession, 'sessionId' | 'messages' | 'model' | 'thinkingLevel' | 'isStreaming'>> {
    return this.withTemporarySession(clientId, sessionPath, async (session) => ({
      sessionId: session.sessionId,
      messages: session.messages,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
    }));
  }

  async readSessionRuntimeStatus(clientId: string, sessionPath: string): Promise<SessionRuntimeStatus> {
    return this.withTemporarySession(clientId, sessionPath, async (session) => this.getRuntimeStatus(session));
  }

  async getSessionCommandInfo(clientId: string, sessionId: string): Promise<SessionCommandInfo> {
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) {
      return this.buildSessionCommandInfo(activeSession);
    }

    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!sessionInfo) {
      throw new Error('Session not found');
    }

    return this.withTemporarySession(clientId, sessionInfo.path, (session) => this.buildSessionCommandInfo(session));
  }

  async listAvailableModels(clientId: string, sessionId: string) {
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) {
      return this.getAvailableModelSummaries(activeSession);
    }

    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!sessionInfo) {
      throw new Error('Session not found');
    }

    return this.withTemporarySession(clientId, sessionInfo.path, (session) => this.getAvailableModelSummaries(session));
  }

  async setSessionModel(clientId: string, sessionId: string, provider: string, modelId: string): Promise<SessionRuntimeStatus> {
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) {
      return this.setModelForSession(activeSession, provider, modelId);
    }

    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!sessionInfo) {
      throw new Error('Session not found');
    }

    return this.withTemporarySession(clientId, sessionInfo.path, (session) => this.setModelForSession(session, provider, modelId));
  }

  async setSessionThinkingLevel(clientId: string, sessionId: string, level: string): Promise<SessionRuntimeStatus> {
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) {
      return this.setThinkingLevelForSession(activeSession, level);
    }

    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!sessionInfo) {
      throw new Error('Session not found');
    }

    return this.withTemporarySession(clientId, sessionInfo.path, (session) => this.setThinkingLevelForSession(session, level));
  }

  private async getAvailableModelSummaries(session: AgentSession) {
    await session.modelRuntime.refresh();
    return (await session.modelRuntime.getAvailable()).map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
      input: model.input,
      current: session.model?.provider === model.provider && session.model?.id === model.id,
    }));
  }

  private async setModelForSession(session: AgentSession, provider: string, modelId: string): Promise<SessionRuntimeStatus> {
    if (session.isStreaming) {
      throw new Error('Cannot change model while session is streaming');
    }

    await session.modelRuntime.refresh();
    const model = session.modelRuntime.getModel(provider, modelId);
    if (!model) {
      throw new Error(`Unknown model: ${provider}/${modelId}`);
    }

    await session.setModel(model);
    return this.getRuntimeStatus(session);
  }

  private setThinkingLevelForSession(session: AgentSession, level: string): SessionRuntimeStatus {
    if (session.isStreaming) {
      throw new Error('Cannot change thinking level while session is streaming');
    }

    const availableLevels = session.getAvailableThinkingLevels();
    if (!availableLevels.includes(level as typeof availableLevels[number])) {
      throw new Error(`Unsupported thinking level: ${level}`);
    }

    session.setThinkingLevel(level as typeof availableLevels[number]);
    return this.getRuntimeStatus(session);
  }

  getRuntimeStatus(session: AgentSession): SessionRuntimeStatus {
    const stats = session.getSessionStats();
    const model = session.model;
    return {
      model: model ? {
        provider: model.provider,
        id: model.id,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        input: model.input,
      } : undefined,
      thinkingLevel: session.thinkingLevel,
      thinkingLevels: session.getAvailableThinkingLevels(),
      usingSubscription: model ? session.modelRuntime.isUsingSubscription(model.provider) : false,
      autoCompactionEnabled: session.autoCompactionEnabled,
      stats: {
        tokens: stats.tokens,
        cost: stats.cost,
      },
      contextUsage: session.getContextUsage(),
    };
  }

  private buildSessionCommandInfo(session: AgentSession): SessionCommandInfo {
    return {
      name: session.sessionManager.getSessionName(),
      workDir: session.sessionManager.getCwd(),
      model: session.model ? {
        provider: session.model.provider,
        id: session.model.id,
      } : undefined,
      stats: session.getSessionStats(),
    };
  }

  private async withTemporarySession<T>(clientId: string, sessionPath: string, fn: (session: AgentSession) => T | Promise<T>): Promise<T> {
    const { agentDir } = await this.getClientProfileProxyEnv(clientId);
    const sessionManager = SessionManager.open(sessionPath, dirname(sessionPath));
    const cwd = this.getSessionManagerCwd(sessionManager, sessionPath);
    const resourceLoader = await this.createResourceLoader(cwd, agentDir, this.policyFromStoredRecord(sessionPath));
    const { session } = await createAgentSession({
      sessionManager,
      agentDir,
      resourceLoader,
      tools: AGENT_SESSION_TOOLS,
    });

    try {
      return await fn(session);
    } finally {
      session.dispose();
    }
  }

  async listAvailableSkills(clientId: string, projectPath?: string): Promise<AvailableSkillInfo[]> {
    const { agentDir } = await this.getClientProfileProxyEnv(clientId);
    const skills = await this.loadSkills(projectPath ? expandHomePath(projectPath) : process.cwd(), agentDir);
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.filePath,
    }));
  }

  async listAgentProfileSkills(profileId: string, cwd: string): Promise<AvailableSkillInfo[]> {
    const profile = (await this.listAgentProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error(`Unknown agent profile: ${profileId}`);
    const skills = await this.loadSkills(expandHomePath(cwd), profile.path);
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.filePath,
    }));
  }

  async getSessionSkillConfiguration(clientId: string, sessionId: string): Promise<{
    skills: AvailableSkillInfo[];
    policy: AppliedSkillPolicy;
    availableSkillNames: string[];
  }> {
    const activeSession = this.getSession(clientId, sessionId);
    const sessionInfo = activeSession ? undefined : await this.findPersistedSession(clientId, sessionId);
    if (!activeSession && !sessionInfo) {
      throw new Error('Session not found');
    }

    const { agentDir } = await this.getClientProfileProxyEnv(clientId);
    const cwd = activeSession ? this.getActiveSessionCwd(activeSession) : sessionInfo?.cwd || process.cwd();
    const loadedSkills = await this.loadSkills(cwd, agentDir);
    const skills = loadedSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.filePath,
    }));
    const skillNames = skills.map((skill) => skill.name);
    const policy = this.getAppliedSkillPolicy(sessionId, skillNames);
    return {
      skills,
      policy,
      availableSkillNames: this.applySkillPolicy(skillNames, policy),
    };
  }

  async updateSessionSkillPolicy(clientId: string, sessionId: string, mode: 'all' | 'enabled' | 'disabled', skills: string[] = []): Promise<{
    policy: AppliedSkillPolicy;
    availableSkillNames: string[];
  }> {
    const activeSession = this.getSession(clientId, sessionId);
    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!activeSession && !sessionInfo) {
      throw new Error('Session not found');
    }
    if (activeSession?.isStreaming) {
      throw new Error('Cannot change skills while session is streaming');
    }

    const { profile, agentDir } = await this.getClientProfileProxyEnv(clientId);
    const cwd = sessionInfo?.cwd || (activeSession ? this.getActiveSessionCwd(activeSession) : process.cwd());
    const availableSkills = await this.loadSkills(cwd, agentDir);
    const policy = this.resolveExplicitSkillPolicy(availableSkills, mode, skills);
    this.skillPolicyStore?.save({
      sessionId,
      username: this.username,
      mode: policy.mode,
      skills: policy.appliedSkills,
      presetId: policy.presetId,
    });

    if (activeSession) {
      if (sessionInfo) {
        this.forceDisposeBySessionId(sessionId);
        await this.resumeSession(clientId, sessionInfo.path);
      } else {
        await this.recreateActiveSession(clientId, activeSession, cwd, agentDir, profile.id, policy);
      }
    }

    return {
      policy,
      availableSkillNames: this.applySkillPolicy(availableSkills.map((skill) => skill.name), policy),
    };
  }

  getSkillPolicy(sessionId: string): SkillPolicyRecord | null {
    return this.skillPolicyStore?.get(sessionId) || null;
  }

  deleteSkillPolicy(sessionId: string): void {
    this.skillPolicyStore?.delete(sessionId);
  }

  deleteSessionMetadata(sessionId: string): void {
    this.skillPolicyStore?.delete(sessionId);
  }

  async listSessionAvailableSkillNames(clientId: string, sessionId: string): Promise<string[]> {
    const availableSkills = await this.listAvailableSkills(clientId);
    const policy = this.getAppliedSkillPolicy(sessionId, availableSkills.map((skill) => skill.name));
    return this.applySkillPolicy(availableSkills.map((skill) => skill.name), policy);
  }

  async findPersistedSession(clientId: string, sessionId: string): Promise<SessionInfo | undefined> {
    const sessions = await this.listSessions(clientId);
    return sessions.find((session) => session.id === sessionId);
  }

  async withActiveSession<T>(clientId: string, sessionId: string, fn: (session: AgentSession) => T | Promise<T>): Promise<T> {
    this.cancelCleanup(clientId);
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) return fn(activeSession);

    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!sessionInfo) {
      throw new Error('Session not found');
    }

    const session = await this.resumeSession(clientId, sessionInfo.path);
    return fn(session);
  }

  async runWithClientProfileProxy<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
    const { agentDir, proxyEnv } = await this.getClientProfileProxyEnv(clientId);
    return this.runWithResolvedProfileProxy(clientId, agentDir, proxyEnv, fn);
  }

  async runForegroundWithClientProfileProxy<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
    const { profile, agentDir, proxyEnv } = await this.getClientProfileProxyEnv(clientId);
    const work = () => this.runWithResolvedProfileProxy(clientId, agentDir, proxyEnv, fn);
    return this.memoryRuntime ? this.memoryRuntime.withForeground(profile.id, work) : work();
  }

  getSession(clientId: string, sessionId?: string): AgentSession | undefined {
    if (sessionId) return this.getSessionBySessionId(sessionId);
    const currentSessionId = this.currentClientSession.get(clientId);
    return currentSessionId ? this.sessions.get(currentSessionId) : undefined;
  }

  getAllSessions(): Map<string, AgentSession> {
    return this.sessions;
  }

  getSessionBySessionId(sessionId: string): AgentSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        return session;
      }
    }
    return undefined;
  }

  getClientSessionId(clientId: string): string | undefined {
    return this.currentClientSession.get(clientId);
  }

  isSessionStreaming(sessionId: string): boolean {
    return this.getSessionBySessionId(sessionId)?.isStreaming === true;
  }

  isCwdStreaming(cwd: string): boolean {
    return Array.from(this.sessions.values()).some((session) => (
      session.sessionManager.getCwd() === cwd && session.isStreaming === true
    ));
  }

  scheduleCleanup(clientId: string, delayMs: number = 5 * 60 * 1000): void {
    this.cancelCleanup(clientId);
    
    const timer = setTimeout(() => {
      this.disposeSession(clientId);
    }, delayMs);
    
    this.cleanupTimers.set(clientId, timer);
  }

  cancelCleanup(clientId: string): void {
    const timer = this.cleanupTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(clientId);
    }
  }

  disposeSession(clientId: string): void {
    this.cancelCleanup(clientId);
    const sessionIds = this.clientSessions.get(clientId) || new Set();
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (!session) continue;
      session.dispose();
      this.sessions.delete(sessionId);
    }
    this.clientSessions.delete(clientId);
    this.currentClientSession.delete(clientId);
  }

  disposeAll(): void {
    for (const clientId of Array.from(this.clientSessions.keys())) {
      this.disposeSession(clientId);
    }
  }

  async getClientAgentDirForRoutes(clientId: string): Promise<string> {
    return this.getClientAgentDir(clientId);
  }

  getProjectSessionDirForPath(cwd: string, agentDir: string): string {
    return this.getProjectSessionDir(cwd, agentDir);
  }

  /**
   * Force dispose a session by its sessionId (not clientId).
   * Used when deleting a session that may be active.
   */
  forceDisposeBySessionId(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
    }

    for (const [clientId, sessionIds] of this.clientSessions) {
      sessionIds.delete(sessionId);
      if (this.currentClientSession.get(clientId) === sessionId) {
        this.currentClientSession.delete(clientId);
      }
      if (sessionIds.size === 0) {
        this.clientSessions.delete(clientId);
        this.cancelCleanup(clientId);
      }
    }
  }

  forceDisposeByCwd(cwd: string): void {
    const sessionIds = Array.from(this.sessions.values())
      .filter((session) => session.sessionManager.getCwd() === cwd)
      .map((session) => session.sessionId);

    for (const sessionId of sessionIds) {
      this.forceDisposeBySessionId(sessionId);
    }
  }

  private createProfileModelRuntime(profilePath: string): Promise<ModelRuntime> {
    return ModelRuntime.create({
      authPath: join(profilePath, 'auth.json'),
      modelsPath: join(profilePath, 'models.json'),
      allowModelNetwork: false,
    });
  }

  private async loadSkills(cwd: string, agentDir: string): Promise<Skill[]> {
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
    await resourceLoader.reload();
    return resourceLoader.getSkills().skills;
  }

  private createInlineExtensions(options: {
    profileId: string;
    cwd: string;
    memoryEnabled: boolean;
    autoRenameEnabled: boolean;
    autoRenameConfig: Pick<ProfileSettings, 'automationProvider' | 'automationModelId' | 'autoRenameLanguage'>;
  }): InlineExtension[] {
    return [
      ...(options.autoRenameEnabled ? [createWebuiAutoRenameExtension({
        model: {
          provider: options.autoRenameConfig.automationProvider,
          id: options.autoRenameConfig.automationModelId,
        },
        language: options.autoRenameConfig.autoRenameLanguage,
      })] : []),
      ...(options.memoryEnabled && this.memoryRuntime
        ? [this.memoryRuntime.createExtension({ profileId: options.profileId, cwd: options.cwd })]
        : []),
    ];
  }

  private async recreateActiveSession(
    clientId: string,
    activeSession: AgentSession,
    cwd: string,
    agentDir: string,
    profileId: string,
    policy: ResolvedSkillPolicy,
  ): Promise<void> {
    const sessionManager = activeSession.sessionManager;
    const model = activeSession.model ? { provider: activeSession.model.provider, id: activeSession.model.id } : undefined;
    const extensionFactories = this.createInlineExtensions({
      profileId,
      cwd,
      memoryEnabled: Boolean(this.memoryRuntime),
      autoRenameEnabled: true,
      autoRenameConfig: this.getProfileSettings(profileId),
    });
    const resourceLoader = await this.createResourceLoader(cwd, agentDir, policy, extensionFactories);

    this.forceDisposeBySessionId(activeSession.sessionId);
    const { session } = await createAgentSession({
      sessionManager,
      agentDir,
      resourceLoader,
      tools: AGENT_SESSION_TOOLS,
    });
    if (model) await this.setModelForSession(session, model.provider, model.id);
    this.registerClientSession(clientId, session);
  }

  private async createResourceLoader(
    cwd: string,
    agentDir: string,
    policy: ResolvedSkillPolicy,
    extensionFactories: InlineExtension[] = [],
  ): Promise<DefaultResourceLoader> {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      extensionFactories,
      skillsOverride: (base) => ({
        skills: filterSkills(base.skills, policy),
        diagnostics: base.diagnostics,
      }),
    });
    await resourceLoader.reload();
    return resourceLoader;
  }

  private resolveAppliedSkillPolicy(skills: Skill[], options: SessionOptions): ResolvedSkillPolicy {
    const enabledSkills = normalizeSkillNames(options.enabledSkills);
    const disabledSkills = normalizeSkillNames(options.disabledSkills);

    if (enabledSkills.length > 0 && disabledSkills.length > 0) {
      throw new Error('Cannot provide both enabledSkills and disabledSkills');
    }

    if (options.skillMode) {
      let selectedSkills: string[] = [];
      if (options.skillMode === 'enabled') {
        selectedSkills = enabledSkills;
      } else if (options.skillMode === 'disabled') {
        selectedSkills = disabledSkills;
      }
      return this.resolveExplicitSkillPolicy(skills, options.skillMode, selectedSkills, options.presetId ?? null);
    }

    if (enabledSkills.length > 0) {
      return this.resolveExplicitSkillPolicy(skills, 'enabled', enabledSkills, options.presetId ?? null);
    }

    if (disabledSkills.length > 0) {
      return this.resolveExplicitSkillPolicy(skills, 'disabled', disabledSkills, options.presetId ?? null);
    }

    return this.resolveExplicitSkillPolicy(skills, 'all', [], options.presetId ?? null);
  }

  private resolveExplicitSkillPolicy(skills: Skill[], mode: 'all' | 'enabled' | 'disabled', skillNames: string[], presetId: string | null = null): ResolvedSkillPolicy {
    const availableNames = new Set(skills.map((skill) => skill.name));
    const normalizedSkills = normalizeSkillNames(skillNames);

    if (mode === 'all') {
      return { mode: 'all', appliedSkills: [], ignoredSkills: [], presetId };
    }

    return {
      mode,
      appliedSkills: normalizedSkills.filter((name) => availableNames.has(name)),
      ignoredSkills: normalizedSkills.filter((name) => !availableNames.has(name)),
      presetId,
    };
  }

  private policyFromStoredRecord(sessionPath: string): ResolvedSkillPolicy {
    if (!this.skillPolicyStore) {
      return { mode: 'all', appliedSkills: [], ignoredSkills: [], presetId: null };
    }

    const sessionId = basename(sessionPath, '.jsonl');
    const policyRecord = this.skillPolicyStore.get(sessionId);
    if (!policyRecord) {
      return { mode: 'all', appliedSkills: [], ignoredSkills: [], presetId: null };
    }

    return {
      mode: policyRecord.mode,
      appliedSkills: policyRecord.skills,
      ignoredSkills: [],
      presetId: policyRecord.presetId,
    };
  }

  private getAppliedSkillPolicy(sessionId: string, availableNames: string[]): AppliedSkillPolicy {
    const policy = this.getSkillPolicy(sessionId);
    if (!policy) {
      return { mode: 'all', appliedSkills: [], ignoredSkills: [] };
    }

    const available = new Set(availableNames);
    return {
      mode: policy.mode,
      appliedSkills: policy.skills.filter((name) => available.has(name)),
      ignoredSkills: policy.skills.filter((name) => !available.has(name)),
      presetId: policy.presetId,
    };
  }

  private applySkillPolicy(availableNames: string[], policy: Pick<AppliedSkillPolicy, 'mode' | 'appliedSkills'>): string[] {
    if (policy.mode === 'all') return availableNames;

    const policyNames = new Set(policy.appliedSkills);
    if (policy.mode === 'enabled') {
      return availableNames.filter((name) => policyNames.has(name));
    }

    return availableNames.filter((name) => !policyNames.has(name));
  }

  private getActiveSessionCwd(session: AgentSession): string {
    return this.getSessionManagerCwd(session.sessionManager, this.getActiveSessionPath(session));
  }

  private getActiveSessionPath(session: AgentSession): string {
    return (session.sessionManager as SessionManagerWithFile).getSessionFile?.() || '';
  }

  private getSessionManagerCwd(sessionManager: { getCwd?: () => string }, sessionPath: string): string {
    return typeof sessionManager.getCwd === 'function' ? sessionManager.getCwd() : dirname(sessionPath);
  }

  private async getClientAgentDir(clientId: string): Promise<string> {
    return (await this.getClientAgentProfile(clientId)).path;
  }

  private async getClientProfileProxyEnv(clientId: string, profileId?: string): Promise<{
    profile: AgentProfile;
    agentDir: string;
    proxyEnv: Record<string, string>;
  }> {
    const profile = profileId
      ? (await this.listAgentProfiles()).find((item) => item.id === profileId)
      : await this.getClientAgentProfile(clientId);
    if (!profile) throw new Error(`Unknown agent profile: ${profileId}`);
    const agentDir = profile.path;
    const proxyEnv = this.getProfileSettings(profile.id).proxy;
    return { profile, agentDir, proxyEnv };
  }

  private async runWithResolvedProfileProxy<T>(
    clientId: string,
    agentDir: string,
    proxyEnv: Record<string, string>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const proxyKeys = Object.keys(proxyEnv).sort();
    if (proxyKeys.length > 0) {
      console.info('[proxy] enabled for agent request', { clientId, agentDir, proxyKeys });
    }
    return runWithAgentDirAndProxyEnv(agentDir, proxyEnv, fn);
  }

  private normalizeAutoRenameLanguage(input: string): 'english' | 'chinese' | null {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'english' || normalized === 'en') return 'english';
    if (normalized === 'chinese' || normalized === 'zh' || normalized === 'zh-cn' || normalized === '中文') return 'chinese';
    return null;
  }

  private async readAgentSettings(agentDir: string): Promise<{ defaultProvider?: string; defaultModel?: string }> {
    const content = await fs.readFile(join(agentDir, 'settings.json'), 'utf8').catch(() => '');
    if (!content.trim()) return {};

    try {
      const settings = JSON.parse(content);
      return {
        defaultProvider: typeof settings.defaultProvider === 'string' ? settings.defaultProvider : undefined,
        defaultModel: typeof settings.defaultModel === 'string' ? settings.defaultModel : undefined,
      };
    } catch {
      return {};
    }
  }

  private getProjectSessionDir(cwd: string, agentDir: string): string {
    const resolvedCwd = resolve(cwd);
    const safePath = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    return join(agentDir, 'sessions', safePath);
  }

  private async listAllSessions(agentDir: string): Promise<any[]> {
    const sessionsRoot = join(agentDir, 'sessions');
    const entries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const nestedSessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const sessionDir = join(sessionsRoot, entry.name);
          const cwd = await this.readSessionDirCwd(sessionDir);
          if (!cwd) return [];
          return SessionManager.list(cwd, sessionDir);
        }),
    );

    const flattenedSessions = nestedSessions.flat() as any[];

    return flattenedSessions.sort((a, b) => {
      const aTime = new Date(a.modified || a.updatedAt || a.created || a.createdAt).getTime();
      const bTime = new Date(b.modified || b.updatedAt || b.created || b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  private async readSessionDirCwd(sessionDir: string): Promise<string | undefined> {
    return (await this.readSessionDirHeader(sessionDir))?.cwd;
  }

  private getFirstUserMessageContent(messages: unknown[]): string | undefined {
    const firstUserMessage = messages.find((message): message is { role: string; content?: unknown } => (
      Boolean(message) && typeof message === 'object' && (message as { role?: unknown }).role === 'user'
    ));
    return typeof firstUserMessage?.content === 'string' ? firstUserMessage.content : undefined;
  }

  private async readSessionDirHeader(sessionDir: string): Promise<SessionDirHeader | undefined> {
    const entries = await fs.readdir(sessionDir).catch(() => []);
    const sessionFile = entries.find((entry) => entry.endsWith('.jsonl'));
    if (!sessionFile) return undefined;

    const content = await fs.readFile(join(sessionDir, sessionFile), 'utf8').catch(() => '');
    const firstLine = content.split('\n').find((line) => line.trim());
    if (!firstLine) return undefined;

    try {
      const header = JSON.parse(firstLine);
      if (header?.type !== 'session' || typeof header.cwd !== 'string') return undefined;
      const fileSessionId = basename(sessionFile, '.jsonl').split('_').pop() || '';
      return { id: typeof header.id === 'string' ? header.id : fileSessionId, cwd: header.cwd };
    } catch {
      return undefined;
    }
  }

  private registerClientSession(clientId: string, session: AgentSession): void {
    this.sessions.set(session.sessionId, session);
    const sessionIds = this.clientSessions.get(clientId) || new Set<string>();
    sessionIds.add(session.sessionId);
    this.clientSessions.set(clientId, sessionIds);
    this.currentClientSession.set(clientId, session.sessionId);
  }

  /**
   * Rename a session by appending a session_info entry with the new name.
   */
  async renameSession(clientId: string, sessionId: string, name: string): Promise<{ success: boolean; name: string }> {
    const activeSession = this.getSession(clientId, sessionId);
    if (activeSession) {
      activeSession.sessionManager.appendSessionInfo(name);
      this.invalidateSessionListCache();
      return { success: true, name };
    }

    const sessionInfo = await this.findPersistedSession(clientId, sessionId);
    if (!sessionInfo) {
      throw new Error('Session not found');
    }

    return this.withTemporarySession(clientId, sessionInfo.path, (session) => {
      session.sessionManager.appendSessionInfo(name);
      this.invalidateSessionListCache();
      return { success: true, name };
    });
  }

  /**
   * Delete session directory from disk permanently.
   */
  async deleteSessionFiles(sessionPath: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.rm(sessionPath, { recursive: true, force: true });
    this.invalidateSessionListCache();
  }
}

function normalizeSkillNames(names?: string[]): string[] {
  return Array.from(new Set((names || []).map((name) => name.trim()).filter(Boolean)));
}

function filterSkills(skills: Skill[], policy: ResolvedSkillPolicy): Skill[] {
  if (policy.mode === 'all') return skills;
  const applied = new Set(policy.appliedSkills);
  if (policy.mode === 'enabled') {
    return skills.filter((skill) => applied.has(skill.name));
  }
  return skills.filter((skill) => !applied.has(skill.name));
}
