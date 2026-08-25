import { execFile } from 'node:child_process';
import { fetchWithProxy } from '../utils/fetch-proxy.js';
import { githubProxyEnvFromUrl, type GithubSettings } from './github-settings-store';

export interface CreateGithubIssueInput { owner: string; repo: string; title: string; body: string; }
export interface CreateGithubPullInput { owner: string; repo: string; title: string; body: string; head: string; base: string; }
export interface GithubLinkResult { number: number; url: string; }
export interface GithubPullRequestStatus { merged: boolean; }

export class GithubRequestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'GithubRequestError';
  }
}

const maxBuffer = 10 * 1024 * 1024;

export class GithubClient {
  constructor(private readonly settings: GithubSettings) {}

  async testConnection(): Promise<{ login?: string }> {
    return this.request('/user', { method: 'GET' });
  }

  async createIssue(input: CreateGithubIssueInput): Promise<GithubLinkResult> {
    const data = await this.request(repoApiPath(input.owner, input.repo, 'issues'), {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    return { number: Number(data.number), url: String(data.html_url || data.url || '') };
  }

  async createPullRequest(input: CreateGithubPullInput): Promise<GithubLinkResult> {
    const data = await this.request(repoApiPath(input.owner, input.repo, 'pulls'), {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
    });
    return { number: Number(data.number), url: String(data.html_url || data.url || '') };
  }

  async getPullRequestStatus(owner: string, repo: string, number: number): Promise<GithubPullRequestStatus> {
    const data = await this.request(repoApiPath(owner, repo, `pulls/${number}`), { method: 'GET' });
    return { merged: data.merged === true };
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    if (!this.settings.serverUrl || !this.settings.token) throw new Error('GitHub is not configured');
    const url = `${apiBaseUrl(this.settings.serverUrl)}${path}`;
    const proxyEnv = this.settings.proxyUrl ? githubProxyEnvFromUrl(this.settings.proxyUrl) : process.env;
    try {
      return await this.fetchRequest(url, init, proxyEnv);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return this.curlRequest(url, init, proxyEnv);
    }
  }

  private async fetchRequest(url: string, init: RequestInit, proxyEnv: Record<string, string | undefined>): Promise<any> {
    const response = await fetchWithProxy(url, {
      ...init,
      headers: this.headers(init),
    }, proxyEnv);
    return parseResponse(await response.text(), response.ok, response.status);
  }

  private async curlRequest(url: string, init: RequestInit, proxyEnv: Record<string, string | undefined>): Promise<any> {
    const args = [
      '-sS',
      '--connect-timeout', '10',
      '-X', init.method || 'GET',
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'X-GitHub-Api-Version: 2022-11-28',
      '-H', `Authorization: Bearer ${this.settings.token}`,
      '-w', '\n%{http_code}',
    ];
    if (init.body) args.push('-H', 'Content-Type: application/json', '--data-binary', String(init.body));
    args.push(url);
    const { stdout } = await execFileCapture('curl', args, { env: { ...process.env, ...proxyEnv }, maxBuffer });
    const marker = stdout.lastIndexOf('\n');
    const text = marker >= 0 ? stdout.slice(0, marker) : stdout;
    const status = marker >= 0 ? Number(stdout.slice(marker + 1)) : 0;
    return parseResponse(text, status >= 200 && status < 300, status);
  }

  private headers(init: RequestInit): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${this.settings.token}`,
      ...init.headers,
    };
  }
}

function repoApiPath(owner: string, repo: string, suffix: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${suffix}`;
}

function execFileCapture(file: string, args: string[], options: Parameters<typeof execFile>[2]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function parseResponse(text: string, ok: boolean, status: number): any {
  const data = parseJsonObject(text);
  if (!ok) {
    const message = typeof data.message === 'string' ? data.message : `GitHub request failed (${status})`;
    throw new GithubRequestError(message, status);
  }
  return data;
}

function parseJsonObject(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function apiBaseUrl(serverUrl: string): string {
  const parsed = new URL(serverUrl);
  if (parsed.hostname === 'github.com') return 'https://api.github.com';
  return `${serverUrl.replace(/\/+$/, '')}/api/v3`;
}
