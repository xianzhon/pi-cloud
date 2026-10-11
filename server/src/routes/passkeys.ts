import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { PasskeyService, PASSKEY_CHALLENGE_SECONDS } from '../auth/passkeys.js';
import { getRequestContext, setSessionCookie } from '../auth/request.js';
import type { AuditLog } from '../auth/audit.js';
import type { IpRateLimiter } from '../auth/rate-limit.js';
import type { SessionRecord, SessionStore } from '../auth/sessions.js';
import type { AuthConfig } from '../config/auth.js';
import type { PiCloudDatabase } from '../db/database.js';

interface PasskeyRouteOptions {
  config: AuthConfig;
  db: PiCloudDatabase;
  sessions: SessionStore;
  audit: AuditLog;
  rateLimiter: IpRateLimiter;
  totpEnabled: () => boolean;
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => SessionRecord | null;
  requireSensitiveActionAuth: (req: FastifyRequest, reply: FastifyReply,
    body: { password?: string; totpCode?: string }, action: string) => Promise<boolean>;
}

export async function passkeyRoutes(app: FastifyInstance, options: PasskeyRouteOptions) {
  const { config, db, sessions, audit, rateLimiter, requireAuth, requireSensitiveActionAuth } = options;
  const service = config.passkeyOrigin ? new PasskeyService(db, config.username, config.passkeyOrigin) : null;
  const cookieName = 'pi_cloud_passkey_flow';
  const cookieOptions = { path: '/api/auth/passkeys', httpOnly: true, sameSite: 'strict' as const, secure: config.cookieSecure };
  app.addHook('onClose', async () => { service?.dispose(); });
  await app.register(rateLimit, {
    max: 30, timeWindow: '1 minute',
    keyGenerator: req => getRequestContext(req, config.trustProxy).ip,
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!service) return reply.status(503).send({ error: 'Configure PI_CLOUD_PASSKEY_ORIGIN first' });
    if (req.method !== 'GET' && req.headers.origin !== config.passkeyOrigin) {
      return reply.status(403).send({ error: 'Untrusted passkey origin' });
    }
    if (rateLimiter.isBlocked(getRequestContext(req, config.trustProxy).ip)) {
      return reply.status(429).send({ error: 'Too many failed attempts. Try again later.' });
    }
  });

  function record(req: FastifyRequest, type: string, status: 'success' | 'failure') {
    audit.record({ type, status, username: config.username, ...getRequestContext(req, config.trustProxy) });
  }

  app.get('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return { passkeys: service!.list() };
  });

  app.delete('/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as { password?: string; totpCode?: string };
    if (!await requireSensitiveActionAuth(req, reply, body, 'passkey_delete')) return;
    if (!requireAuth(req, reply)) return;
    if (!service!.delete((req.params as { id: string }).id)) return reply.status(404).send({ error: 'Passkey not found' });
    record(req, 'passkey_deleted', 'success');
    return { success: true };
  });

  app.post('/register/options', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    const body = (req.body || {}) as { password?: string; totpCode?: string; name?: unknown };
    if (!await requireSensitiveActionAuth(req, reply, body, 'passkey_add')) return;
    if (!requireAuth(req, reply)) return;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    try {
      const issued = await service!.registrationOptions(session.id, name || 'Passkey', req.cookies[cookieName]);
      reply.setCookie(cookieName, issued.token, { ...cookieOptions, maxAge: PASSKEY_CHALLENGE_SECONDS });
      return issued.options;
    } catch (error) {
      return reply.status(409).send({ error: error instanceof Error ? error.message : 'Cannot create passkey challenge' });
    }
  });

  app.post('/login/options', async (req, reply) => {
    try {
      const issued = await service!.loginOptions(req.cookies[cookieName]);
      reply.setCookie(cookieName, issued.token, { ...cookieOptions, maxAge: PASSKEY_CHALLENGE_SECONDS });
      return issued.options;
    } catch {
      return reply.status(429).send({ error: 'Cannot create passkey challenge. Try again later.' });
    }
  });

  app.post('/register/verify', async (req, reply) => {
    const session = requireAuth(req, reply);
    if (!session) return;
    reply.clearCookie(cookieName, cookieOptions);
    try {
      await service!.register(req.cookies[cookieName], session.id, (req.body as { response: RegistrationResponseJSON })?.response);
      record(req, 'passkey_added', 'success');
      return { success: true };
    } catch {
      rateLimiter.recordFailure(getRequestContext(req, config.trustProxy).ip);
      record(req, 'passkey_registration_failure', 'failure');
      return reply.status(400).send({ error: 'Passkey verification failed. Please try again.' });
    }
  });

  app.post('/login/verify', async (req, reply) => {
    reply.clearCookie(cookieName, cookieOptions);
    const context = getRequestContext(req, config.trustProxy);
    try {
      await service!.authenticate(req.cookies[cookieName], (req.body as { response: AuthenticationResponseJSON })?.response);
      rateLimiter.recordSuccess(context.ip);
      const created = sessions.createSession({ username: config.username, ttlHours: config.sessionTtlHours,
        maxLifetimeHours: config.sessionMaxHours, ...context });
      setSessionCookie(reply, config, created.token, created.expiresAt);
      record(req, 'passkey_login_success', 'success');
      return { authenticated: true, requires2fa: false,
        user: { username: config.username, totpEnabled: options.totpEnabled() },
        sessionExpiresAt: created.expiresAt.toISOString() };
    } catch {
      rateLimiter.recordFailure(context.ip);
      record(req, 'passkey_login_failure', 'failure');
      return reply.status(400).send({ error: 'Passkey verification failed. Please try again.' });
    }
  });
}
