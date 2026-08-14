import { fetch as undiciFetch, ProxyAgent } from 'undici';

const proxyAgents = new Map<string, ProxyAgent>();

export function fetchWithProxy(url: string, init: RequestInit, proxyEnv: Record<string, string | undefined> = process.env): Promise<Response> {
  const proxy = proxyForUrl(url, proxyEnv);
  if (!proxy) return fetch(url, init);
  let agent = proxyAgents.get(proxy);
  if (!agent) {
    agent = new ProxyAgent({ uri: proxy });
    proxyAgents.set(proxy, agent);
  }
  return undiciFetch(url, { ...init, dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as Promise<Response>;
}

function proxyForUrl(url: string, proxyEnv: Record<string, string | undefined>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (isNoProxyHost(parsed.hostname, proxyEnv)) return null;
  const protocolProxy = proxyForProtocol(parsed.protocol, proxyEnv);
  return protocolProxy || env('ALL_PROXY', proxyEnv) || null;
}

function proxyForProtocol(protocol: string, proxyEnv: Record<string, string | undefined>): string {
  if (protocol === 'http:') return env('HTTP_PROXY', proxyEnv);
  if (protocol === 'https:') return env('HTTPS_PROXY', proxyEnv);
  return '';
}

function env(name: string, proxyEnv: Record<string, string | undefined>): string {
  return proxyEnv[name] || proxyEnv[name.toLowerCase()] || '';
}

function isNoProxyHost(hostname: string, proxyEnv: Record<string, string | undefined>): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  const noProxy = env('NO_PROXY', proxyEnv);
  if (!noProxy) return false;
  return noProxy.split(',').some((entry) => matchesNoProxy(host, entry.trim().toLowerCase()));
}

function matchesNoProxy(host: string, entry: string): boolean {
  if (!entry) return false;
  if (entry === '*') return true;
  const normalized = entry.startsWith('.') ? entry.slice(1) : entry;
  return host === normalized || host.endsWith(`.${normalized}`);
}
