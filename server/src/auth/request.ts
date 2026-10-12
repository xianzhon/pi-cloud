import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../config/auth';
import type { SessionRecord, SessionStore } from './sessions';

export interface RequestContext {
  ip: string;
  userAgent?: string;
}

// Use the right-most X-Forwarded-For hop: it is the address the trusted proxy
// observed. Left-most entries are supplied by the client and can be forged to
// evade per-IP login throttling.
export function getRequestContext(req: FastifyRequest, trustProxy: boolean): RequestContext {
  const forwardedFor = req.headers['x-forwarded-for'];
  const proxyIp = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor)
    ?.split(',').map((hop) => hop.trim()).filter(Boolean).at(-1);
  return {
    ip: trustProxy && proxyIp ? proxyIp : req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export function getSessionFromRequest(
  req: FastifyRequest,
  config: AuthConfig,
  sessions: SessionStore,
): SessionRecord | null {
  return sessions.validateToken(req.cookies?.[config.cookieName]);
}

export function renewSessionFromRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  config: AuthConfig,
  sessions: SessionStore,
): SessionRecord | null {
  const token = req.cookies?.[config.cookieName];
  const session = sessions.validateToken(token, { ttlHours: config.sessionTtlHours });
  if (session?.renewed && token) setSessionCookie(reply, config, token, new Date(session.expires_at));
  return session;
}

export function setSessionCookie(reply: FastifyReply, config: AuthConfig, token: string, expiresAt: Date): void {
  reply.setCookie(config.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AuthConfig): void {
  reply.clearCookie(config.cookieName, { path: '/' });
}
