import type { FastifyRequest } from 'fastify';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

function parseHostHeader(hostHeader: string): { hostname: string; port: string } | null {
  const value = hostHeader.trim().toLowerCase();
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== '/') return null;
    // URL drops the scheme default port, so restore an explicit `:80`.
    return { hostname: url.hostname, port: url.port || (/:\d+$/.test(value) ? '80' : '') };
  } catch {
    return null;
  }
}

/**
 * Browser origins must match the requested host and port exactly. Ports are
 * part of the check because cookies are shared across ports on the same host,
 * so a page on another local port must not be able to drive this server.
 *
 * Reverse proxies that rewrite Host without the port (nginx `$host`) are only
 * tolerated when the operator has declared a trusted proxy.
 */
export function isAllowedOrigin(origin: string | undefined, hostHeader: string | undefined, trustProxy = false): boolean {
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (!hostHeader) return false;

  const requestHost = parseHostHeader(hostHeader);
  if (!requestHost || originUrl.hostname.toLowerCase() !== requestHost.hostname) return false;

  const originPort = originUrl.port || DEFAULT_PORTS[originUrl.protocol] || '';
  if (requestHost.port) return originPort === requestHost.port;
  return trustProxy || originPort === DEFAULT_PORTS[originUrl.protocol];
}

export function isAllowedRequestOrigin(req: FastifyRequest, trustProxy = false): boolean {
  const headers = req.headers ?? {};
  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  const host = Array.isArray(headers.host) ? headers.host[0] : headers.host;
  return isAllowedOrigin(origin, host, trustProxy);
}
