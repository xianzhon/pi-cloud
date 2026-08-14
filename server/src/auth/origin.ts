import type { FastifyRequest } from 'fastify';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostnameFromHostHeader(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1);
  return trimmed.split(':')[0];
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function isAllowedOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const requestHost = hostnameFromHostHeader(hostHeader);
  const originHost = originUrl.hostname.toLowerCase();
  if (!requestHost) return false;
  if (originHost === requestHost) return true;

  // Permit local development where the frontend and backend run on different loopback ports.
  return isLoopbackHost(originHost) && isLoopbackHost(requestHost);
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function isAllowedRequestOrigin(req: FastifyRequest): boolean {
  const headers = req.headers ?? {};
  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  const host = Array.isArray(headers.host) ? headers.host[0] : headers.host;
  return isAllowedOrigin(origin, host);
}
