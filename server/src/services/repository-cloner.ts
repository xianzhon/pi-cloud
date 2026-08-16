import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { expandHomePath } from '../utils/paths.js';

export type CloneJobStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface ClonePreviewInput { remoteUrl: string; }
export interface ClonePreviewResult { remoteUrl: string; isGithub: boolean; owner?: string; repo?: string; suggestedPath?: string; }
export interface StartCloneInput { remoteUrl: string; destinationPath: string; clientId?: string; shallow?: boolean; }
export interface CloneProgressEvent { type: 'progress' | 'completed' | 'failed' | 'canceled'; status: string; percent?: number; projectPath?: string; error?: string; }
export interface CloneJobSnapshot { id: string; status: CloneJobStatus; destinationPath: string; latest: CloneProgressEvent; }
export interface CloneStartResult { jobId?: string; existingPath?: string; status: 'started' | 'destination_exists'; }

export interface RepositoryClonerOptions {
  spawnGit: (args: string[], options: { env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;
  pathExists?: (path: string) => Promise<boolean>;
  removePath?: (path: string) => Promise<void>;
  githubSettings: () => { serverUrl: string; token: string };
  giteaSettings: () => { serverUrl: string; token: string };
  githubProxyEnv: (clientId?: string) => Promise<Record<string, string | undefined>>;
  gitCloneParentPath: () => string;
}

interface ParsedGithubUrl { owner: string; repo: string; }

const GIT_PROGRESS_PATTERNS: Array<{ pattern: RegExp; status: string }> = [
  { pattern: /^Receiving objects:\s+(\d+)%/, status: 'Receiving objects…' },
  { pattern: /^Resolving deltas:\s+(\d+)%/, status: 'Resolving deltas…' },
  { pattern: /^Compressing objects:\s+(\d+)%/, status: 'Compressing objects…' },
];

export class RepositoryCloner {
  private readonly jobs = new Map<string, CloneJob>();

  constructor(private readonly options: RepositoryClonerOptions) {}

  async start(input: StartCloneInput): Promise<CloneStartResult> {
    const remoteUrl = input.remoteUrl.trim();
    const destinationPath = input.destinationPath.trim();
    if (!remoteUrl) throw new Error('Git URL is required');
    if (!destinationPath) throw new Error('Destination path is required');

    const pathExists = this.options.pathExists || defaultPathExists;
    if (await pathExists(destinationPath)) return { status: 'destination_exists', existingPath: destinationPath };

    const job = new CloneJob(`clone_${randomUUID()}`, remoteUrl, destinationPath, input.shallow === true);
    this.jobs.set(job.id, job);
    await this.spawnClone(job, remoteUrl, false, input.clientId);
    return { status: 'started', jobId: job.id };
  }

  getJob(id: string): CloneJobSnapshot | null {
    const job = this.jobs.get(id);
    return job ? { id: job.id, status: job.status, destinationPath: job.destinationPath, latest: job.latest } : null;
  }

  subscribe(id: string, listener: (event: CloneProgressEvent) => void): () => void {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Clone job not found');
    job.on('event', listener);
    listener(job.latest);
    return () => job.off('event', listener);
  }

  async cancel(id: string): Promise<CloneJobSnapshot> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Clone job not found');
    if (job.status !== 'running') return this.getJob(id)!;
    job.status = 'canceled';
    job.process?.kill('SIGTERM');
    await (this.options.removePath || defaultRemovePath)(job.destinationPath);
    job.publish({ type: 'canceled', status: 'Clone canceled' });
    return this.getJob(id)!;
  }

  preview(input: ClonePreviewInput): ClonePreviewResult {
    const remoteUrl = input.remoteUrl.trim();
    if (!remoteUrl) throw new Error('Git URL is required');

    const github = parseGithubHttpsUrl(remoteUrl, this.options.githubSettings().serverUrl || 'https://github.com');
    if (!github) return { remoteUrl, isGithub: false };

    return {
      remoteUrl,
      isGithub: true,
      owner: github.owner,
      repo: github.repo,
      suggestedPath: join(expandHomePath(this.options.gitCloneParentPath()), github.owner, github.repo),
    };
  }

  private async spawnClone(job: CloneJob, remoteUrl: string, usingToken: boolean, clientId?: string): Promise<void> {
    this.spawnCloneWithEnv(job, remoteUrl, usingToken, await this.gitEnv(remoteUrl, clientId));
  }

  private spawnCloneWithEnv(job: CloneJob, remoteUrl: string, usingToken: boolean, env: NodeJS.ProcessEnv): void {
    const secrets = [this.options.githubSettings().token, this.options.giteaSettings().token].filter(Boolean);
    const args = ['clone', '--progress', ...(job.shallow ? ['--depth', '1'] : []), '--', remoteUrl, job.destinationPath];
    const child = this.options.spawnGit(args, { env });
    job.process = child;
    let stderr = '';

    child.stderr.on('data', (chunk: Buffer) => {
      const text = maskSecret(chunk.toString('utf8'), secrets);
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const event = parseGitProgressLine(line);
        if (event && job.status === 'running') job.publish(event);
      }
    });

    child.on('exit', (code: number | null) => {
      if (job.status === 'canceled') return;
      if (code === 0) {
        job.status = 'completed';
        job.publish({ type: 'completed', status: 'Clone completed', projectPath: job.destinationPath, percent: 100 });
        return;
      }

      const retryUrl = this.authenticatedRetryUrl(job.remoteUrl, stderr, usingToken);
      if (retryUrl) {
        this.spawnCloneWithEnv(job, retryUrl, true, env);
        return;
      }

      job.status = 'failed';
      job.publish({ type: 'failed', status: 'Clone failed', error: stderr.trim() || `git clone exited with code ${code}` });
    });
  }

  private async gitEnv(remoteUrl: string, clientId?: string): Promise<NodeJS.ProcessEnv> {
    const env = { ...process.env };
    if (isMatchingHttpsHost(remoteUrl, this.options.githubSettings().serverUrl || 'https://github.com')) {
      Object.assign(env, await this.options.githubProxyEnv(clientId));
    }
    return env;
  }

  private authenticatedRetryUrl(remoteUrl: string, stderr: string, usingToken: boolean): string | null {
    if (usingToken || !isAuthFailure(stderr)) return null;
    const github = this.options.githubSettings();
    if (github.token && isMatchingHttpsHost(remoteUrl, github.serverUrl || 'https://github.com')) {
      return withToken(remoteUrl, 'x-access-token', github.token);
    }
    const gitea = this.options.giteaSettings();
    if (gitea.token && gitea.serverUrl && isMatchingHttpsHost(remoteUrl, gitea.serverUrl)) {
      return withToken(remoteUrl, 'oauth2', gitea.token);
    }
    return null;
  }
}

class CloneJob extends EventEmitter {
  status: CloneJobStatus = 'running';
  process: ChildProcessWithoutNullStreams | null = null;
  latest: CloneProgressEvent = { type: 'progress', status: 'Starting clone…' };

  constructor(readonly id: string, readonly remoteUrl: string, readonly destinationPath: string, readonly shallow: boolean) {
    super();
  }

  publish(event: CloneProgressEvent): void {
    this.latest = event;
    this.emit('event', event);
  }
}

function parseGithubHttpsUrl(remoteUrl: string, serverUrl: string): ParsedGithubUrl | null {
  let parsed: URL;
  let server: URL;
  try {
    parsed = new URL(remoteUrl);
    server = new URL(serverUrl || 'https://github.com');
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname.toLowerCase() !== server.hostname.toLowerCase()) return null;
  const [owner, rawRepo, ...rest] = parsed.pathname.replace(/^\/+/, '').split('/');
  if (!owner || !rawRepo || rest.length > 0) return null;
  const repo = rawRepo.replace(/\.git$/, '');
  return repo ? { owner, repo } : null;
}

export function parseGitProgressLine(line: string): CloneProgressEvent | null {
  const text = line.trim();
  if (!text) return null;

  for (const { pattern, status } of GIT_PROGRESS_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { type: 'progress', status, percent: Number(match[1]) };
  }

  return { type: 'progress', status: 'Cloning…' };
}

export function maskSecret(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('***'), value);
}

function isAuthFailure(stderr: string): boolean {
  return /Authentication failed|could not read Username|Repository not found|HTTP Basic: Access denied/i.test(stderr);
}

function isMatchingHttpsHost(remoteUrl: string, serverUrl: string): boolean {
  try {
    const remote = new URL(remoteUrl);
    const server = new URL(serverUrl);
    return remote.protocol === 'https:' && remote.hostname.toLowerCase() === server.hostname.toLowerCase();
  } catch {
    return false;
  }
}

function withToken(remoteUrl: string, username: string, token: string): string {
  const parsed = new URL(remoteUrl);
  parsed.username = username;
  parsed.password = token;
  return parsed.toString();
}

async function defaultPathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function defaultRemovePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
