import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../config/auth';
import type { AuditLog } from '../auth/audit';
import type { IpRateLimiter } from '../auth/rate-limit';
import { clearSessionCookie, getRequestContext, renewSessionFromRequest, setSessionCookie } from '../auth/request.js';
import type { SessionRecord, SessionStore } from '../auth/sessions';
import type { TotpService } from '../auth/totp';
import { verifyConfiguredPassword } from '../auth/password.js';
import type { PiuiDatabase } from '../db/database';
import { SkillPresetStore } from '../services/skill-preset-store.js';
import type { SkillPresetMode } from '../services/skill-preset-store.js';

interface AuthRouteOptions {
  config: AuthConfig;
  sessions: SessionStore;
  audit: AuditLog;
  totp: TotpService;
  rateLimiter: IpRateLimiter;
  db: PiuiDatabase;
}

type PreferencePatchBody = {
  showHintInfo?: unknown;
  showCodeBlockLanguageHeaders?: unknown;
  streamingMessageBehavior?: unknown;
  editorAutoRefresh?: unknown;
  confirmSessionDelete?: unknown;
  newSessionShortcut?: unknown;
  fullscreenShortcut?: unknown;
  showGoToTopButton?: unknown;
  showChatViewOptionsButton?: unknown;
  autoExtractMemory?: unknown;
  theme?: unknown;
  language?: unknown;
  soundNotification?: unknown;
  gitCloneParentPath?: unknown;
};

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions) {
  const { config, sessions, audit, totp, rateLimiter, db } = options;
  const presetStore = new SkillPresetStore(db);

  function getPreferenceValue(key: string): string | undefined {
    const row = db
      .prepare('SELECT value FROM security_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  function setPreferenceValue(key: string, value: string): void {
    db.prepare(`
      INSERT INTO security_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  function hasPreference(body: PreferencePatchBody, key: keyof PreferencePatchBody): boolean {
    return Object.prototype.hasOwnProperty.call(body, key);
  }

  function getStreamingMessageBehavior(): 'steer' | 'followUp' {
    const value = getPreferenceValue('ui.streamingMessageBehavior');
    return value === 'followUp' ? 'followUp' : 'steer';
  }

  function getNewSessionShortcut(): 'ctrlAltN' | 'ctrlMetaN' | 'disabled' {
    const value = getPreferenceValue('ui.newSessionShortcut');
    return value === 'ctrlAltN' || value === 'disabled' ? value : 'ctrlMetaN';
  }

  function getFullscreenShortcut(): 'f11' | 'ctrlShiftF' {
    const value = getPreferenceValue('ui.fullscreenShortcut');
    return value === 'ctrlShiftF' ? 'ctrlShiftF' : 'f11';
  }

  function getTheme(): 'dark' | 'light' | 'system' {
    const value = getPreferenceValue('ui.theme');
    return value === 'dark' || value === 'light' ? value : 'system';
  }

  function getLanguage(): 'en' | 'zh-CN' {
    const value = getPreferenceValue('ui.language');
    return value === 'zh-CN' ? 'zh-CN' : 'en';
  }

  function getSoundNotification(): 'off' | 'beep' | 'chime' | 'ding' {
    const value = getPreferenceValue('ui.soundNotification');
    return value === 'off' || value === 'chime' || value === 'ding' ? value : 'beep';
  }

  function getPreferences() {
    return {
      gitCloneParentPath: getPreferenceValue('ui.gitCloneParentPath') || '~/git/github',
      showHintInfo: getPreferenceValue('ui.showHintInfo') !== 'false',
      showCodeBlockLanguageHeaders: getPreferenceValue('ui.showCodeBlockLanguageHeaders') !== 'false',
      streamingMessageBehavior: getStreamingMessageBehavior(),
      editorAutoRefresh: getPreferenceValue('ui.editorAutoRefresh') === 'true',
      confirmSessionDelete: getPreferenceValue('ui.confirmSessionDelete') !== 'false',
      newSessionShortcut: getNewSessionShortcut(),
      fullscreenShortcut: getFullscreenShortcut(),
      showGoToTopButton: getPreferenceValue('ui.showGoToTopButton') !== 'false',
      showChatViewOptionsButton: getPreferenceValue('ui.showChatViewOptionsButton') !== 'false',
      autoExtractMemory: getPreferenceValue('memory.autoExtract') === 'true',
      theme: getTheme(),
      language: getLanguage(),
      soundNotification: getSoundNotification(),
    };
  }

  function requireAuth(req: FastifyRequest, reply: FastifyReply): SessionRecord | null {
    const session = renewSessionFromRequest(req, reply, config, sessions);
    if (!session) {
      reply.status(401).send({ error: 'Authentication required' });
      return null;
    }
    return session;
  }

  function parsePresetBody(body: Record<string, unknown>): { name: string; mode: SkillPresetMode; skills: string[] } {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mode = body.mode;
    const skills = Array.isArray(body.skills) ? body.skills.filter((skill): skill is string => typeof skill === 'string') : null;

    if (!name) {
      throw new Error('name is required');
    }
    if (mode !== 'enabled' && mode !== 'disabled') {
      throw new Error('mode must be enabled or disabled');
    }
    if (!skills) {
      throw new Error('skills must be an array of strings');
    }

    return { name, mode, skills };
  }

  function isUniqueConstraintError(error: unknown) {
    return error instanceof Error && /unique/i.test(error.message);
  }

  function sendPresetError(reply: FastifyReply, error: unknown) {
    if (isUniqueConstraintError(error)) {
      return reply.status(409).send({ error: 'A preset with that name already exists' });
    }
    return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid preset payload' });
  }

  app.get('/me', async (req, reply) => {
    const session = renewSessionFromRequest(req, reply, config, sessions);
    return {
      authenticated: Boolean(session),
      user: session ? { username: session.username, totpEnabled: totp.getStatus().enabled } : null,
      sessionExpiresAt: session?.expires_at || null,
    };
  });

  app.post('/login', async (req, reply) => {
    const context = getRequestContext(req, config.trustProxy);
    const body = req.body as { username?: string; password?: string; totpCode?: string };

    if (rateLimiter.isBlocked(context.ip)) {
      audit.record({ type: 'login_rate_limited', status: 'failure', username: body.username, ...context });
      return reply.status(429).send({ error: 'Too many failed attempts. Try again later.' });
    }

    const validCredentials = body.username === config.username && await verifyConfiguredPassword(body.password || '', config);
    if (!validCredentials) {
      rateLimiter.recordFailure(context.ip);
      audit.record({ type: 'login_failure', status: 'failure', username: body.username, ...context, metadata: { reason: 'bad_credentials' } });
      return reply.status(401).send({ error: 'Invalid username, password, or verification code' });
    }

    const totpEnabled = totp.getStatus().enabled;
    if (totpEnabled && !config.skip2faVerify) {
      if (!body.totpCode) {
        return { authenticated: false, requires2fa: true };
      }
      if (!totp.verify(body.totpCode)) {
        rateLimiter.recordFailure(context.ip);
        audit.record({ type: 'totp_failure', status: 'failure', username: config.username, ...context });
        return reply.status(401).send({ error: 'Invalid username, password, or verification code' });
      }
      audit.record({ type: 'totp_success', status: 'success', username: config.username, ...context });
    }

    if (totpEnabled && config.skip2faVerify) {
      audit.record({ type: 'totp_bypassed', status: 'info', username: config.username, ...context });
    }

    rateLimiter.recordSuccess(context.ip);
    const created = sessions.createSession({ username: config.username, ttlHours: config.sessionTtlHours, maxLifetimeHours: config.sessionMaxHours, ...context });
    setSessionCookie(reply, config, created.token, created.expiresAt);
    audit.record({ type: 'login_success', status: 'success', username: config.username, ...context });

    return {
      authenticated: true,
      requires2fa: false,
      user: { username: config.username, totpEnabled },
      sessionExpiresAt: created.expiresAt.toISOString(),
    };
  });

  app.post('/logout', async (req, reply) => {
    const context = getRequestContext(req, config.trustProxy);
    const token = req.cookies?.[config.cookieName];
    const session = sessions.validateToken(token);
    sessions.revokeToken(token);
    clearSessionCookie(reply, config);
    audit.record({ type: 'logout', status: 'success', username: session?.username, ...context });
    return { success: true };
  });

  app.get('/preferences', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    return getPreferences();
  });

  app.patch('/preferences', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;

    const body = req.body as PreferencePatchBody;
    const hasShowHintInfo = hasPreference(body, 'showHintInfo');
    const hasShowCodeBlockLanguageHeaders = hasPreference(body, 'showCodeBlockLanguageHeaders');
    const hasStreamingMessageBehavior = hasPreference(body, 'streamingMessageBehavior');
    const hasEditorAutoRefresh = hasPreference(body, 'editorAutoRefresh');
    const hasConfirmSessionDelete = hasPreference(body, 'confirmSessionDelete');
    const hasNewSessionShortcut = hasPreference(body, 'newSessionShortcut');
    const hasFullscreenShortcut = hasPreference(body, 'fullscreenShortcut');
    const hasShowGoToTopButton = hasPreference(body, 'showGoToTopButton');
    const hasShowChatViewOptionsButton = hasPreference(body, 'showChatViewOptionsButton');
    const hasAutoExtractMemory = hasPreference(body, 'autoExtractMemory');
    const hasTheme = hasPreference(body, 'theme');
    const hasLanguage = hasPreference(body, 'language');
    const hasSoundNotification = hasPreference(body, 'soundNotification');
    const hasGitCloneParentPath = hasPreference(body, 'gitCloneParentPath');

    if (!hasShowHintInfo && !hasShowCodeBlockLanguageHeaders && !hasStreamingMessageBehavior && !hasEditorAutoRefresh && !hasConfirmSessionDelete && !hasNewSessionShortcut && !hasFullscreenShortcut && !hasShowGoToTopButton && !hasShowChatViewOptionsButton && !hasAutoExtractMemory && !hasTheme && !hasLanguage && !hasSoundNotification && !hasGitCloneParentPath) {
      return reply.status(400).send({ error: 'At least one preference must be provided' });
    }
    if (hasShowHintInfo && typeof body.showHintInfo !== 'boolean') {
      return reply.status(400).send({ error: 'showHintInfo must be a boolean' });
    }
    if (hasShowCodeBlockLanguageHeaders && typeof body.showCodeBlockLanguageHeaders !== 'boolean') {
      return reply.status(400).send({ error: 'showCodeBlockLanguageHeaders must be a boolean' });
    }
    if (hasStreamingMessageBehavior && body.streamingMessageBehavior !== 'steer' && body.streamingMessageBehavior !== 'followUp') {
      return reply.status(400).send({ error: 'streamingMessageBehavior must be steer or followUp' });
    }
    if (hasEditorAutoRefresh && typeof body.editorAutoRefresh !== 'boolean') {
      return reply.status(400).send({ error: 'editorAutoRefresh must be a boolean' });
    }
    if (hasConfirmSessionDelete && typeof body.confirmSessionDelete !== 'boolean') {
      return reply.status(400).send({ error: 'confirmSessionDelete must be a boolean' });
    }
    if (hasNewSessionShortcut && body.newSessionShortcut !== 'ctrlAltN' && body.newSessionShortcut !== 'ctrlMetaN' && body.newSessionShortcut !== 'disabled') {
      return reply.status(400).send({ error: 'newSessionShortcut must be ctrlAltN, ctrlMetaN, or disabled' });
    }
    if (hasFullscreenShortcut && body.fullscreenShortcut !== 'f11' && body.fullscreenShortcut !== 'ctrlShiftF') {
      return reply.status(400).send({ error: 'fullscreenShortcut must be f11 or ctrlShiftF' });
    }
    if (hasShowGoToTopButton && typeof body.showGoToTopButton !== 'boolean') {
      return reply.status(400).send({ error: 'showGoToTopButton must be a boolean' });
    }
    if (hasShowChatViewOptionsButton && typeof body.showChatViewOptionsButton !== 'boolean') {
      return reply.status(400).send({ error: 'showChatViewOptionsButton must be a boolean' });
    }
    if (hasAutoExtractMemory && typeof body.autoExtractMemory !== 'boolean') {
      return reply.status(400).send({ error: 'autoExtractMemory must be a boolean' });
    }
    if (hasTheme && body.theme !== 'dark' && body.theme !== 'light' && body.theme !== 'system') {
      return reply.status(400).send({ error: 'theme must be dark, light, or system' });
    }
    if (hasLanguage && body.language !== 'en' && body.language !== 'zh-CN') {
      return reply.status(400).send({ error: 'language must be en or zh-CN' });
    }
    if (hasSoundNotification && body.soundNotification !== 'off' && body.soundNotification !== 'beep' && body.soundNotification !== 'chime' && body.soundNotification !== 'ding') {
      return reply.status(400).send({ error: 'soundNotification must be off, beep, chime, or ding' });
    }
    if (hasGitCloneParentPath && (typeof body.gitCloneParentPath !== 'string' || !body.gitCloneParentPath.trim())) {
      return reply.status(400).send({ error: 'gitCloneParentPath must be a non-empty string' });
    }

    if (hasShowHintInfo) setPreferenceValue('ui.showHintInfo', String(body.showHintInfo));
    if (hasShowCodeBlockLanguageHeaders) setPreferenceValue('ui.showCodeBlockLanguageHeaders', String(body.showCodeBlockLanguageHeaders));
    if (hasStreamingMessageBehavior) setPreferenceValue('ui.streamingMessageBehavior', String(body.streamingMessageBehavior));
    if (hasEditorAutoRefresh) setPreferenceValue('ui.editorAutoRefresh', String(body.editorAutoRefresh));
    if (hasConfirmSessionDelete) setPreferenceValue('ui.confirmSessionDelete', String(body.confirmSessionDelete));
    if (hasNewSessionShortcut) setPreferenceValue('ui.newSessionShortcut', String(body.newSessionShortcut));
    if (hasFullscreenShortcut) setPreferenceValue('ui.fullscreenShortcut', String(body.fullscreenShortcut));
    if (hasShowGoToTopButton) setPreferenceValue('ui.showGoToTopButton', String(body.showGoToTopButton));
    if (hasShowChatViewOptionsButton) setPreferenceValue('ui.showChatViewOptionsButton', String(body.showChatViewOptionsButton));
    if (hasAutoExtractMemory) setPreferenceValue('memory.autoExtract', String(body.autoExtractMemory));
    if (hasTheme) setPreferenceValue('ui.theme', String(body.theme));
    if (hasLanguage) setPreferenceValue('ui.language', String(body.language));
    if (hasSoundNotification) setPreferenceValue('ui.soundNotification', String(body.soundNotification));
    if (hasGitCloneParentPath) setPreferenceValue('ui.gitCloneParentPath', String(body.gitCloneParentPath).trim());
    return getPreferences();
  });

  app.get('/skill-presets', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    return { presets: presetStore.list() };
  });

  app.post('/skill-presets', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;

    try {
      const payload = parsePresetBody((req.body as Record<string, unknown>) || {});
      return { preset: presetStore.create({ username: session.username, ...payload }) };
    } catch (error) {
      return sendPresetError(reply, error);
    }
  });

  app.patch('/skill-presets/:id', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;

    try {
      const payload = parsePresetBody((req.body as Record<string, unknown>) || {});
      return {
        preset: presetStore.update({
          id: (req.params as { id: string }).id,
          username: session.username,
          ...payload,
        }),
      };
    } catch (error) {
      return sendPresetError(reply, error);
    }
  });

  app.delete('/skill-presets/:id', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    presetStore.delete((req.params as { id: string }).id, session.username);
    return { success: true };
  });

  app.post('/2fa/setup', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    return await totp.createSetup();
  });

  app.post('/2fa/enable', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    const context = getRequestContext(req, config.trustProxy);
    const body = req.body as { secret?: string; code?: string };
    if (!body.secret || !body.code || !totp.enable(body.secret, body.code)) {
      audit.record({ type: 'totp_enable_failure', status: 'failure', username: config.username, ...context });
      return reply.status(400).send({ error: 'Invalid verification code' });
    }
    audit.record({ type: 'totp_enabled', status: 'success', username: config.username, ...context });
    return { success: true, enabled: true };
  });

  app.post('/2fa/disable', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    const context = getRequestContext(req, config.trustProxy);
    totp.disable();
    audit.record({ type: 'totp_disabled', status: 'success', username: config.username, ...context });
    return { success: true, enabled: false };
  });

  app.delete('/audit', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    audit.clear();
    return { success: true };
  });

  app.get('/audit', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    const limit = Number((req.query as { limit?: string }).limit || '100');
    return { events: audit.list(limit) };
  });
}
