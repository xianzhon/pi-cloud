import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RepositoryCloner, parseGitProgressLine, maskSecret, type CloneProgressEvent } from './repository-cloner.js';

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
    expect(processes[1].args).toContain('https://x-access-token:secret-token@github.com/acme/private.git');
    processes[1].emit('exit', 0, null);
    expect(service.getJob(result.jobId!)?.latest).toEqual({ type: 'completed', status: 'Clone completed', projectPath: '/Users/test/git/github/acme/private', percent: 100 });
  });
});
