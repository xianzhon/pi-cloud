import { EnvHttpProxyAgent, getGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyProxyEnv,
  parseProxyEnvFile,
  restoreProxyEnv,
  runWithAgentDirAndProxyEnv,
  runWithProxyEnv,
  runWithProxyEnvLock,
} from './profile-proxy.js';

describe('profile-proxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('parses only whitelisted proxy keys', () => {
    const parsed = parseProxyEnvFile(`
ALL_PROXY=http://localhost:7890
http_proxy=http://localhost:7890
HTTPS_PROXY=http://localhost:7890
NO_PROXY=localhost,127.0.0.1
FOO=bar
INVALID LINE
`);

    expect(parsed).toEqual({
      ALL_PROXY: 'http://localhost:7890',
      http_proxy: 'http://localhost:7890',
      HTTPS_PROXY: 'http://localhost:7890',
      NO_PROXY: 'localhost,127.0.0.1',
    });
  });

  it('last valid duplicate key wins', () => {
    const parsed = parseProxyEnvFile(`
ALL_PROXY=http://a
ALL_PROXY=http://b
`);

    expect(parsed).toEqual({ ALL_PROXY: 'http://b' });
  });

  it('applies and restores only managed proxy keys', () => {
    const previousHttpsProxy = process.env.https_proxy;
    process.env.ALL_PROXY = 'http://before';
    process.env.KEEP_ME = 'yes';

    const snapshot = applyProxyEnv({
      ALL_PROXY: 'http://after',
      https_proxy: 'http://secure',
    });

    expect(process.env.ALL_PROXY).toBe('http://after');
    expect(process.env.https_proxy).toBe('http://secure');
    expect(process.env.KEEP_ME).toBe('yes');

    restoreProxyEnv(snapshot);

    expect(process.env.ALL_PROXY).toBe('http://before');
    expect(process.env.https_proxy).toBe(previousHttpsProxy);
    expect(process.env.KEEP_ME).toBe('yes');
  });

  it('serializes concurrent callers through the global proxy lock', async () => {
    const order: string[] = [];

    await Promise.all([
      runWithProxyEnvLock(async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('a:end');
      }),
      runWithProxyEnvLock(async () => {
        order.push('b:start');
        order.push('b:end');
      }),
    ]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('allows concurrent callers that use the same profile environment', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    await Promise.all([
      runWithAgentDirAndProxyEnv('/profile/codex', { ALL_PROXY: 'http://same' }, async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await firstCanFinish;
        order.push('a:end');
      }),
      runWithAgentDirAndProxyEnv('/profile/codex', { ALL_PROXY: 'http://same' }, async () => {
        order.push('b:start');
        releaseFirst();
        order.push('b:end');
      }),
    ]);

    expect(order).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
  });

  it('serializes callers that use different profile environments', async () => {
    const order: string[] = [];

    await Promise.all([
      runWithAgentDirAndProxyEnv('/profile/a', { ALL_PROXY: 'http://a' }, async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('a:end');
      }),
      runWithAgentDirAndProxyEnv('/profile/b', { ALL_PROXY: 'http://b' }, async () => {
        order.push('b:start');
        order.push('b:end');
      }),
    ]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('restores env after wrapped work throws', async () => {
    process.env.ALL_PROXY = 'http://before';

    await expect(runWithProxyEnv({ ALL_PROXY: 'http://after' }, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(process.env.ALL_PROXY).toBe('http://before');
  });

  it('sets and restores PI_CODING_AGENT_DIR with profile proxy env', async () => {
    process.env.PI_CODING_AGENT_DIR = '/before';
    process.env.ALL_PROXY = 'http://before';

    let duringAgentDir: string | undefined;
    let duringProxy: string | undefined;
    await runWithAgentDirAndProxyEnv('/profile/codex', { ALL_PROXY: 'http://after' }, async () => {
      duringAgentDir = process.env.PI_CODING_AGENT_DIR;
      duringProxy = process.env.ALL_PROXY;
    });

    expect(duringAgentDir).toBe('/profile/codex');
    expect(duringProxy).toBe('http://after');
    expect(process.env.PI_CODING_AGENT_DIR).toBe('/before');
    expect(process.env.ALL_PROXY).toBe('http://before');
  });

  it('switches the global dispatcher to an env-aware proxy dispatcher during wrapped work', async () => {
    const beforeDispatcher = getGlobalDispatcher();

    let duringDispatcher: unknown;
    await runWithProxyEnv({ ALL_PROXY: 'http://127.0.0.1:1' }, async () => {
      duringDispatcher = getGlobalDispatcher();
    });

    expect(duringDispatcher).toBeInstanceOf(EnvHttpProxyAgent);
    expect(getGlobalDispatcher()).toBe(beforeDispatcher);
  });

  it('does not emit low-level proxy debug logs during wrapped work', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await runWithProxyEnv({ ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: 'localhost' }, async () => {});

    expect(infoSpy).not.toHaveBeenCalled();
  });
});
