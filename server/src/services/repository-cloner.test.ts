import { EventEmitter } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryCloner, parseGitProgressLine, maskSecret, type CloneProgressEvent } from './repository-cloner.js';

beforeEach(() => { vi.stubEnv('PI_CLOUD_DISABLE_PATH_CHECK', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); });

function cloner() {
  return new RepositoryCloner({
    spawnGit: (() => { throw new Error('spawnGit not used in preview tests'); }) as any,
    pathExists: async () => false,
    removePath: async () => {},
    githubSettings: () => ({ serverUrl: 'https://github.com', token: '' }),
    giteaSettings: () => ({ serverUrl: '', token: '' }),
    githubProxyEnv: async () => ({ HTTPS_PROXY: 'http://proxy.example' }),
    gitCloneParentPath: () => '/Users/test/git/github',
  });
}

describe('RepositoryCloner preview', () => {
  it('suggests ~/git/github/<owner>/<repo> for GitHub HTTPS URLs', () => {
    expect(cloner().preview({ remoteUrl: 'https://github.com/acme/tool.git' })).toEqual({
      remoteUrl: 'https://github.com/acme/tool.git',
      isGithub: true,
      owner: 'acme',
      repo: 'tool',
      suggestedPath: '/Users/test/git/github/acme/tool',
    });
  });

  it('uses the configured clone parent for GitHub suggestions', () => {
    const service = new RepositoryCloner({
      spawnGit: (() => { throw new Error('spawnGit not used in preview tests'); }) as any,
      pathExists: async () => false,
      removePath: async () => {},
      githubSettings: () => ({ serverUrl: 'https://github.com', token: '' }),
      giteaSettings: () => ({ serverUrl: '', token: '' }),
      githubProxyEnv: async () => ({}),
      gitCloneParentPath: () => '/Users/test/code',
    });

    expect(service.preview({ remoteUrl: 'https://github.com/acme/tool.git' }).suggestedPath).toBe('/Users/test/code/acme/tool');
  });

  it('does not suggest a destination for non-GitHub URLs', () => {
    expect(cloner().preview({ remoteUrl: 'https://git.example.com/acme/tool.git' })).toEqual({
      remoteUrl: 'https://git.example.com/acme/tool.git',
      isGithub: false,
    });
  });

  it('rejects empty clone URLs', () => {
    expect(() => cloner().preview({ remoteUrl: '   ' })).toThrow('Git URL is required');
  });
});

describe('repository clone progress helpers', () => {
  it('parses receiving objects percentage', () => {
    expect(parseGitProgressLine('Receiving objects: 42% (42/100), 12.34 MiB | 1.00 MiB/s')).toEqual({
      type: 'progress',
      status: 'Receiving objects…',
      percent: 42,
    });
  });

  it('parses resolving deltas percentage', () => {
    expect(parseGitProgressLine('Resolving deltas: 89% (89/100)')).toEqual({
      type: 'progress',
      status: 'Resolving deltas…',
      percent: 89,
    });
  });

  it('returns a generic progress event for unparseable clone output', () => {
    expect(parseGitProgressLine('Cloning into \'tool\'...')).toEqual({
      type: 'progress',
      status: 'Cloning…',
    });
  });

  it('masks configured tokens in errors and progress lines', () => {
    expect(maskSecret('fatal: https://x-access-token:secret123@github.com/acme/tool.git failed', ['secret123']))
      .toBe('fatal: https://x-access-token:***@github.com/acme/tool.git failed');
  });
});

class FakeGitProcess extends EventEmitter {
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  killed = false;
  args: string[] = [];
  spawnOptions: { env: NodeJS.ProcessEnv } = { env: {} };
  kill() { this.killed = true; this.emit('exit', null, 'SIGTERM'); return true; }
}

function jobCloner(options: {
  existing?: boolean;
  processes?: FakeGitProcess[];
  removed?: string[];
  githubToken?: string;
  giteaToken?: string;
} = {}) {
  const processes = options.processes || [];
  const removed = options.removed || [];
  return {
    processes,
    removed,
    service: new RepositoryCloner({
      spawnGit: ((args: string[], spawnOptions: { env: NodeJS.ProcessEnv }) => {
        const child = new FakeGitProcess() as any;
        child.args = args;
        child.spawnOptions = spawnOptions;
        processes.push(child);
        return child;
      }) as any,
      pathExists: async () => Boolean(options.existing),
      removePath: async (path: string) => { removed.push(path); },
      githubSettings: () => ({ serverUrl: 'https://github.com', token: options.githubToken || '' }),
      giteaSettings: () => ({ serverUrl: 'https://git.example.com', token: options.giteaToken || '' }),
      githubProxyEnv: async () => ({ HTTPS_PROXY: 'http://proxy.example' }),
      gitCloneParentPath: () => '/Users/test/git/github',
    }),
  };
}

describe('RepositoryCloner jobs', () => {
  it('rejects outside and dangling-link destinations before spawning or removing anything', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-boundary-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-outside-'));
    vi.stubEnv('PI_CLOUD_ALLOWED_ROOTS', root);
    vi.stubEnv('PI_CLOUD_DISABLE_PATH_CHECK', 'false');
    const { service, processes, removed } = jobCloner();
    try {
      await fs.symlink(path.join(outside, 'missing'), path.join(root, 'link'));
      for (const destinationPath of [path.join(outside, 'repo'), path.join(root, 'link'), path.join(root, 'link', 'repo')]) {
        await expect(service.start({ remoteUrl: 'https://github.com/acme/tool.git', destinationPath })).rejects.toThrow('outside the configured allowed roots');
      }
      expect(processes).toHaveLength(0);
      expect(removed).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('canonicalizes an allowed destination for cloning and cancellation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-canonical-'));
    vi.stubEnv('PI_CLOUD_ALLOWED_ROOTS', root);
    vi.stubEnv('PI_CLOUD_DISABLE_PATH_CHECK', 'false');
    try {
      await fs.mkdir(path.join(root, 'target'));
      await fs.symlink(path.join(root, 'target'), path.join(root, 'alias'));
      const { service, processes, removed } = jobCloner();
      const canonical = path.join(await fs.realpath(root), 'target', 'repo');
      const result = await service.start({ remoteUrl: 'https://github.com/acme/tool.git', destinationPath: path.join(root, 'alias', 'repo') });
      expect(processes[0].args.at(-1)).toBe(canonical);
      await service.cancel(result.jobId!);
      expect(removed).toEqual([canonical]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns destination_exists before spawning git', async () => {
    const { service, processes } = jobCloner({ existing: true });

    await expect(service.start({ remoteUrl: 'https://github.com/acme/tool.git', destinationPath: '/Users/test/git/github/acme/tool' }))
      .resolves.toEqual({ status: 'destination_exists', existingPath: '/Users/test/git/github/acme/tool' });
    expect(processes).toHaveLength(0);
  });

  it('uses depth 1 for shallow clones', async () => {
    const { service, processes } = jobCloner();

    await service.start({
      remoteUrl: 'https://github.com/acme/tool.git',
      destinationPath: '/Users/test/git/github/acme/tool',
      shallow: true,
    });

    expect(processes[0].args).toEqual([
      'clone', '--progress', '--depth', '1', '--',
      'https://github.com/acme/tool.git', '/Users/test/git/github/acme/tool',
    ]);
  });

  it('publishes progress and completion for a successful clone', async () => {
    const { service, processes } = jobCloner();
    const result = await service.start({ remoteUrl: 'https://github.com/acme/tool.git', destinationPath: '/Users/test/git/github/acme/tool' });
    const events: CloneProgressEvent[] = [];
    const unsubscribe = service.subscribe(result.jobId!, (event) => events.push(event));

    processes[0].stderr.emit('data', Buffer.from('Receiving objects: 42% (42/100)\n'));
    processes[0].emit('exit', 0, null);
    unsubscribe();

    expect(events).toContainEqual({ type: 'progress', status: 'Receiving objects…', percent: 42 });
    expect(service.getJob(result.jobId!)?.latest).toEqual({ type: 'completed', status: 'Clone completed', projectPath: '/Users/test/git/github/acme/tool', percent: 100 });
  });
});

describe('RepositoryCloner auth, proxy, and cancel', () => {
  it('keeps the origin credential-free after an authenticated retry with real Git', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-credentials-'));
    vi.stubEnv('PI_CLOUD_ALLOWED_ROOTS', root);
    vi.stubEnv('PI_CLOUD_DISABLE_PATH_CHECK', 'false');
    const source = path.join(root, 'source.git');
    const destination = path.join(root, 'clone');
    const remoteUrl = 'https://github.com/acme/private.git';
    const token = 'dummy-secret-token';
    const first = new FakeGitProcess();
    let usingRetry = false;
    try {
      execFileSync('git', ['init', '--bare', source], { stdio: 'ignore' });
      const service = new RepositoryCloner({
        spawnGit: (args, options) => {
          if (!usingRetry) { usingRetry = true; return first as any; }
          expect(execFileSync('git', ['config', '--get-urlmatch', 'http.extraHeader', remoteUrl], { env: options.env, encoding: 'utf8' }).trim())
            .toBe(`Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`);
          // Redirect to a local fixture without network access; Git still stores the original URL.
          return spawn('git', ['-c', `url.${source}.insteadOf=${remoteUrl}`, ...args], options);
        },
        githubSettings: () => ({ serverUrl: 'https://github.com', token }),
        giteaSettings: () => ({ serverUrl: '', token: '' }),
        githubProxyEnv: async () => ({}),
        gitCloneParentPath: () => root,
      });
      const result = await service.start({ remoteUrl, destinationPath: destination });
      first.stderr.emit('data', Buffer.from('Authentication failed'));
      first.emit('exit', 128);
      await vi.waitFor(() => expect(service.getJob(result.jobId!)?.status).toBe('completed'));
      expect(execFileSync('git', ['-C', destination, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()).toBe(remoteUrl);
      const config = await fs.readFile(path.join(destination, '.git', 'config'), 'utf8');
      expect(config).not.toContain(token);
      expect(config).not.toContain(Buffer.from(`x-access-token:${token}`).toString('base64'));
      expect(config).not.toContain('extraHeader');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('applies proxy env for GitHub clone jobs', async () => {
    const { service, processes } = jobCloner();
    await service.start({ remoteUrl: 'https://github.com/acme/tool.git', destinationPath: '/Users/test/git/github/acme/tool' });

    expect(processes[0].spawnOptions.env.HTTPS_PROXY).toBe('http://proxy.example');
  });

  it('cancels an active clone and removes the partial destination', async () => {
    const { service, processes, removed } = jobCloner();
    const result = await service.start({ remoteUrl: 'https://github.com/acme/tool.git', destinationPath: '/Users/test/git/github/acme/tool' });

    await service.cancel(result.jobId!);

    expect(processes[0].killed).toBe(true);
    expect(removed).toEqual(['/Users/test/git/github/acme/tool']);
    expect(service.getJob(result.jobId!)?.latest).toEqual({ type: 'canceled', status: 'Clone canceled' });
  });

  it('retries HTTPS GitHub clone once with the configured token after auth failure', async () => {
    const { service, processes } = jobCloner({ githubToken: 'secret-token' });
    const result = await service.start({ remoteUrl: 'https://github.com/acme/private.git', destinationPath: '/Users/test/git/github/acme/private' });

    processes[0].stderr.emit('data', Buffer.from('fatal: Authentication failed for https://github.com/acme/private.git\n'));
    processes[0].emit('exit', 128, null);

    expect(processes).toHaveLength(2);
    expect(processes[1].args).toContain('https://github.com/acme/private.git');
    expect(processes[1].args.join(' ')).not.toContain('secret-token');
    const env = processes[1].spawnOptions.env;
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/acme/private.git.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`);
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_1).toBe('');
    processes[1].emit('exit', 0, null);
    expect(service.getJob(result.jobId!)?.latest).toEqual({ type: 'completed', status: 'Clone completed', projectPath: '/Users/test/git/github/acme/private', percent: 100 });
  });
});
