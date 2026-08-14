import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

const PROXY_ENV_KEYS = [
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number];
export type ProxyEnv = Partial<Record<ProxyEnvKey, string>>;
export type ProxyEnvSnapshot = Map<string, string | undefined>;

let proxyLock: Promise<void> = Promise.resolve();
interface ActiveEnvContext {
  key: string;
  count: number;
  done: Promise<void>;
  releaseDone: () => void;
  restore: () => void;
}

let activeEnvContext: ActiveEnvContext | null = null;

export function parseProxyEnvFile(content: string): ProxyEnv {
  const env: ProxyEnv = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if ((PROXY_ENV_KEYS as readonly string[]).includes(key)) {
      env[key as ProxyEnvKey] = value;
    }
  }

  return env;
}

export function applyProxyEnv(nextEnv: ProxyEnv): ProxyEnvSnapshot {
  const snapshot = new Map<string, string | undefined>();

  for (const key of PROXY_ENV_KEYS) {
    snapshot.set(key, process.env[key]);
    if (nextEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = nextEnv[key];
    }
  }

  return snapshot;
}

export function restoreProxyEnv(snapshot: ProxyEnvSnapshot): void {
  restoreEnvSnapshot(snapshot);
}

export function applyAgentDirEnv(agentDir: string): ProxyEnvSnapshot {
  const snapshot = new Map<string, string | undefined>();
  snapshot.set('PI_CODING_AGENT_DIR', process.env.PI_CODING_AGENT_DIR);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return snapshot;
}

export function restoreAgentDirEnv(snapshot: ProxyEnvSnapshot): void {
  restoreEnvSnapshot(snapshot);
}

export async function runWithAgentDirAndProxyEnv<T>(
  agentDir: string,
  proxyEnv: ProxyEnv,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireEnvProxyContext(agentDir, proxyEnv);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function runWithProxyEnv<T>(proxyEnv: ProxyEnv, fn: () => Promise<T>): Promise<T> {
  const release = await acquireEnvProxyContext(undefined, proxyEnv);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function runWithProxyEnvLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = proxyLock;
  let release!: () => void;
  proxyLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function acquireEnvProxyContext(agentDir: string | undefined, proxyEnv: ProxyEnv): Promise<() => void> {
  const key = envContextKey(agentDir, proxyEnv);

  // Calls using identical env can safely overlap; different env still waits to avoid
  // mutating process.env or the undici global dispatcher out from under a request.

  while (activeEnvContext && activeEnvContext.key !== key) {
    await activeEnvContext.done;
  }

  if (activeEnvContext) {
    activeEnvContext.count += 1;
    return releaseEnvProxyContext(activeEnvContext);
  }

  const dispatcher = getGlobalDispatcher();
  const proxySnapshot = applyProxyEnv(proxyEnv);
  const agentDirSnapshot = agentDir === undefined ? undefined : applyAgentDirEnv(agentDir);
  setGlobalDispatcher(new EnvHttpProxyAgent());

  let releaseDone!: () => void;
  const context = {
    key,
    count: 1,
    done: new Promise<void>((resolve) => {
      releaseDone = resolve;
    }),
    releaseDone,
    restore: () => {
      setGlobalDispatcher(dispatcher);
      if (agentDirSnapshot) restoreAgentDirEnv(agentDirSnapshot);
      restoreProxyEnv(proxySnapshot);
    },
  };
  activeEnvContext = context;
  return releaseEnvProxyContext(context);
}

function releaseEnvProxyContext(context: ActiveEnvContext): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    context.count -= 1;
    if (context.count > 0) return;
    if (activeEnvContext === context) activeEnvContext = null;
    context.restore();
    context.releaseDone();
  };
}

function envContextKey(agentDir: string | undefined, proxyEnv: ProxyEnv): string {
  const proxyEntries = PROXY_ENV_KEYS.map((key) => [key, proxyEnv[key] ?? null] as const);
  return JSON.stringify({ agentDir: agentDir ?? null, proxyEntries });
}

function restoreEnvSnapshot(snapshot: ProxyEnvSnapshot): void {
  for (const [key, value] of snapshot.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
