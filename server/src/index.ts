// server/src/index.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { config as loadEnv } from 'dotenv';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionRoutes } from './routes/sessions.js';
import { memoryRoutes } from './routes/memories.js';
import { fileRoutes } from './routes/files.js';
import { slashCommandRoutes } from './routes/slash-commands.js';
import { changelogRoutes } from './routes/changelog.js';
import { gitRoutes } from './routes/git.js';
import { taskRoutes } from './routes/tasks.js';
import { feishuGatewayRoutes } from './routes/feishu-gateway.js';
import { gatewayRoutes } from './routes/gateways.js';
import { gitHostingRoutes, type GitHostingRouteOptions } from './routes/git-hosting.js';
import { reviewSourceRoutes } from './routes/review-sources.js';
import { authRoutes } from './routes/auth.js';
import { chatWebSocket } from './ws/chat.js';
import { terminalWebSocket } from './ws/terminal.js';
import { loadAuthConfig, type AuthConfig } from './config/auth.js';
import { renderDefaultConfig } from './config/default-config.js';
import { openPiuiDatabase, type PiuiDatabase } from './db/database.js';
import { AuditLog } from './auth/audit.js';
import { IpRateLimiter } from './auth/rate-limit.js';
import { isAllowedCorsOrigin, isAllowedRequestOrigin } from './auth/origin.js';
import { getRequestContext, renewSessionFromRequest } from './auth/request.js';
import { SessionStore } from './auth/sessions.js';
import { TotpService } from './auth/totp.js';
import { initializeSessionService, sessionService } from './services/session-manager.js';
import { SessionActivityStore, type SessionActivityRecord } from './services/session-activity-store.js';
import { SessionPinStore } from './services/session-pin-store.js';
import { SkillPolicyStore } from './services/skill-policy-store.js';
import { initializeWorktreeMetadataStore } from './services/worktree-metadata-store.js';
import { createMemoryRuntime, type MemoryRuntime } from './memory/runtime.js';
import { worktreeManager } from './services/worktree-manager.js';
import { GiteaClient } from './services/gitea-client.js';
import { GitHostingService } from './services/git-hosting.js';
import { GiteaSettingsStore } from './services/gitea-settings-store.js';
import { GithubClient } from './services/github-client.js';
import { GatewaySettingsStore } from './services/gateway-settings-store.js';
import { GithubSettingsStore } from './services/github-settings-store.js';
import { ProjectTaskStore } from './services/project-task-store.js';
import { SkillPresetStore } from './services/skill-preset-store.js';
import { CommitMessagePromptStore } from './services/commit-message-prompt-store.js';
import { ProjectTaskStarter } from './services/project-task-starter.js';
import { RepositoryCloner } from './services/repository-cloner.js';
import { FeishuGatewayService } from './services/feishu-gateway.js';
import { WeixinGatewayService } from './services/weixin-gateway.js';
import { ReviewSourceStore } from './services/review-source-store.js';
import { ReviewSourceService } from './services/review-source-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep source and working-directory files supported, then use the user file as a fallback.
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const userConfigDir = path.join(configHome, 'pi-webui');
const userConfigPath = path.join(userConfigDir, '.env');
loadEnv({ path: userConfigPath, quiet: true });

async function refreshPullRequestStatus(
  activity: SessionActivityRecord,
  stores: { giteaSettings: GiteaSettingsStore; githubSettings: GithubSettingsStore },
): Promise<'ready' | 'merged'> {
  const data = activity.data;
  const owner = typeof data.owner === 'string' ? data.owner : '';
  const repo = typeof data.repo === 'string' ? data.repo : '';
  const number = typeof data.number === 'number' ? data.number : Number(data.number);
  if (!owner || !repo || !Number.isInteger(number)) throw new Error('PR activity is missing repository metadata');

  let urlProvider: 'github' | 'gitea' = 'gitea';
  if (typeof data.url === 'string') {
    try {
      urlProvider = new URL(data.url).hostname.toLowerCase() === 'github.com' ? 'github' : 'gitea';
    } catch { /* Invalid legacy activity URLs fall back to Gitea. */ }
  }
  const provider = data.provider === 'github' ? 'github' : urlProvider;
  const result = provider === 'github'
    ? await new GithubClient(stores.githubSettings.get()).getPullRequestStatus(owner, repo, number)
    : await new GiteaClient(stores.giteaSettings.get()).getPullRequestStatus(owner, repo, number);
  return result.merged ? 'merged' : 'ready';
}

function createDefaultConfig(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.PI_WEBUI_AUTH_USERNAME || process.env.PI_WEBUI_AUTH_PASSWORD || process.env.PI_WEBUI_AUTH_PASSWORD_HASH) return;

  const username = 'admin';
  const password = randomBytes(6).toString('base64url');
  const samplePath = path.resolve(__dirname, '../../.env.example');
  const content = renderDefaultConfig(readFileSync(samplePath, 'utf8'), username, password);

  mkdirSync(userConfigDir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(userConfigPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log(`Created default configuration at ${userConfigPath}`);
    console.log(`Pi WebUI login: ${username} / ${password}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  loadEnv({ path: userConfigPath, quiet: true });
}

createDefaultConfig();

const DEFAULT_PORT = 3000;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
].join('; ');

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value "${value}". PORT must be an integer between 1 and 65535.`);
  }

  return port;
};

const port = parsePort(process.env.PORT);

interface AuthServices {
  authConfig: AuthConfig;
  db: PiuiDatabase;
  audit: AuditLog;
  sessions: SessionStore;
  totp: TotpService;
  rateLimiter: IpRateLimiter;
}

declare module 'fastify' {
  interface FastifyInstance {
    authServices: AuthServices;
    memoryRuntime: MemoryRuntime;
  }
}

function isPublicRoute(req: { method: string; url: string }): boolean {
  const url = req.url.split('?')[0];
  if (url === '/api/health') return true;
  if (url.startsWith('/api/auth')) return true;
  if (url === '/api/gateways/feishu/events') return true;
  if (req.method === 'GET' && !url.startsWith('/api/')) return true;
  return false;
}

function isMutatingRequest(req: { method: string }): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
}

function isSpaRoute(req: { method: string; url: string }): boolean {
  const url = req.url.split('?')[0];
  if (req.method !== 'GET') return false;
  if (url.startsWith('/api/') || url.startsWith('/ws/')) return false;
  if (path.extname(url)) return false;
  return true;
}

function getSecuritySetting(db: PiuiDatabase, key: string): string {
  const row = db.prepare('SELECT value FROM security_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

function formatServerTimestamp(): string {
  const date = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Keep timestamps compact and readable in the server's local timezone.
      timestamp: () => `,"time":"${formatServerTimestamp()}"`,
      hooks: {
        logMethod(inputArgs, method) {
          const payload = inputArgs[0];
          if (payload && typeof payload === 'object' && 'responseTime' in payload) {
            const responseTime = (payload as { responseTime?: unknown }).responseTime;
            if (typeof responseTime === 'number' && Number.isFinite(responseTime)) {
              inputArgs[0] = { ...payload, responseTime: Math.round(responseTime * 10) / 10 };
            }
          }
          method.apply(this, inputArgs);
        },
      },
    },
  });

  const authConfig = loadAuthConfig();
  const db = openPiuiDatabase(authConfig.dbPath);
  const worktreeMetadataStore = initializeWorktreeMetadataStore(db);
  const memoryRuntime = createMemoryRuntime({
    db,
    worktrees: worktreeMetadataStore,
    resolveProfile: async (profileId) => (
      (await sessionService.listAgentProfiles()).find((profile) => profile.id === profileId)
    ),
    resolveProxyEnv: (agentDir) => {
      const profileId = path.basename(agentDir) === 'agent' ? 'default' : path.basename(agentDir);
      const row = db.prepare('SELECT proxy_json FROM agent_profile_settings WHERE profile_id = ?').get(profileId) as { proxy_json?: string } | undefined;
      try { return row?.proxy_json ? JSON.parse(row.proxy_json) as Record<string, string> : {}; } catch { return {}; }
    },
  });
  const piSessionService = initializeSessionService({
    skillPolicyStore: new SkillPolicyStore(db),
    username: authConfig.username,
    db,
    memoryRuntime,
  });
  memoryRuntime.start();
  const projectTaskStore = new ProjectTaskStore(db);
  const skillPresetStore = new SkillPresetStore(db);
  const reviewSourceStore = new ReviewSourceStore(db);
  const reviewSourceService = new ReviewSourceService(reviewSourceStore);
  const sessionActivityStore = new SessionActivityStore(db);
  const sessionPinStore = new SessionPinStore(db);
  projectTaskStore.restoreAllStarting();
  const giteaSettings = new GiteaSettingsStore(db);
  const gatewaySettings = new GatewaySettingsStore(db);
  const githubSettings = new GithubSettingsStore(db);
  const feishuGateway = new FeishuGatewayService(db, gatewaySettings);
  const weixinGateway = new WeixinGatewayService(db, gatewaySettings);
  weixinGateway.start();
  const repositoryCloner = new RepositoryCloner({
    spawnGit: (args, options) => spawn('git', args, options),
    githubSettings: () => githubSettings.get(),
    giteaSettings: () => giteaSettings.get(),
    githubProxyEnv: async (clientId) => ({
      ...await piSessionService.getClientAgentProxyEnvForRoutes(clientId || 'default'),
      ...githubSettings.proxyEnv(),
    }),
    gitCloneParentPath: () => getSecuritySetting(db, 'ui.gitCloneParentPath') || path.join(os.homedir(), 'git', 'github'),
  });
  const gitHosting = new GitHostingService();
  const projectTaskStarter = new ProjectTaskStarter({
    store: projectTaskStore,
    sessionService: piSessionService,
    worktreeManager,
    worktreeMetadataStore,
    presetStore: skillPresetStore,
  });
  const audit = new AuditLog(db);
  const sessions = new SessionStore(db, authConfig.cookieName);
  const totp = new TotpService(db, 'Pi WebUI', authConfig.username);
  const rateLimiter = new IpRateLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });
  app.decorate('authServices', { authConfig, db, audit, sessions, totp, rateLimiter });
  app.decorate('memoryRuntime', memoryRuntime);
  app.addHook('onClose', async () => {
    await weixinGateway.stop();
    await memoryRuntime.stop();
    db.close();
  });

  await app.register(cors, {
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin)),
  });

  await app.register(cookie);

  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (authConfig.cookieSecure) {
      reply.header('Strict-Transport-Security', 'max-age=31536000');
    }
    return payload;
  });

  // Serve static files from client/dist. Static assets remain public so the SPA login screen can load.
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../../client/dist'),
    prefix: '/',
  });

  await app.register(websocket);

  app.addHook('onRequest', async (req, reply) => {
    if (isMutatingRequest(req) && !isAllowedRequestOrigin(req)) {
      const context = getRequestContext(req, authConfig.trustProxy);
      audit.record({
        type: 'http_origin_rejected',
        status: 'failure',
        ...context,
        metadata: { url: req.url.split('?')[0], method: req.method, origin: req.headers.origin },
      });
      return reply.status(403).send({ error: 'Origin not allowed' });
    }

    if (isPublicRoute(req)) return;

    const session = renewSessionFromRequest(req, reply, authConfig, sessions);
    if (!session) {
      const context = getRequestContext(req, authConfig.trustProxy);
      audit.record({
        type: 'unauthorized_http',
        status: 'failure',
        ...context,
        metadata: { url: req.url.split('?')[0], method: req.method },
      });
      return reply.status(401).send({ error: 'Authentication required' });
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth', config: authConfig, sessions, audit, totp, rateLimiter, db });
  await app.register(sessionRoutes, {
    prefix: '/api/sessions',
    projectTaskStore,
    pinStore: sessionPinStore,
    activityStore: sessionActivityStore,
    refreshPrStatus: (activity: SessionActivityRecord) => refreshPullRequestStatus(activity, { giteaSettings, githubSettings }),
    repositoryCloner,
  });
  await app.register(memoryRoutes, { prefix: '/api/memories' });
  await app.register(taskRoutes, { prefix: '/api/tasks', store: projectTaskStore, starter: projectTaskStarter, activityStore: sessionActivityStore });
  await app.register(gatewayRoutes, { prefix: '/api/gateways', settings: gatewaySettings, weixin: weixinGateway });
  await app.register(feishuGatewayRoutes, { prefix: '/api/gateways/feishu', service: feishuGateway });
  const gitHostingRouteOptions: GitHostingRouteOptions = {
    settings: giteaSettings,
    githubSettings,
    tasks: projectTaskStore,
    git: gitHosting,
    createClient: (settings) => new GiteaClient(settings),
    createGithubClient: (settings) => new GithubClient(settings),
    activityStore: sessionActivityStore,
  };
  await app.register(gitHostingRoutes, { prefix: '/api/git-hosting', ...gitHostingRouteOptions });
  // Backward-compatible alias for clients that still call the original Gitea-only prefix.
  await app.register(gitHostingRoutes, { prefix: '/api/gitea', ...gitHostingRouteOptions });
  await app.register(fileRoutes, { prefix: '/api/files' });
  await app.register(gitRoutes, {
    prefix: '/api/git',
    activityStore: sessionActivityStore,
    commitMessagePrompts: new CommitMessagePromptStore(db),
  });
  await app.register(slashCommandRoutes, { prefix: '/api/slash-commands' });
  await app.register(changelogRoutes, { prefix: '/api/changelog' });
  await app.register(reviewSourceRoutes, { prefix: '/api/review-sources', reviewSourceService, pinStore: sessionPinStore });
  await app.register(chatWebSocket);
  await app.register(terminalWebSocket);

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (isSpaRoute(req)) {
      return reply.sendFile('index.html');
    }

    return reply.status(404).send({
      message: `Route ${req.method}:${req.url.split('?')[0]} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.listen({ port, host: process.env.HOST || '127.0.0.1' });
  return app;
}

// The npm CLI imports this module to start the server and report its bound URL.
if (process.env.NODE_ENV !== 'test' && process.env.PI_WEBUI_CLI_IMPORT !== '1') {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
