import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GiteaSettings } from './gitea-settings-store';

export interface CreateGiteaIssueInput { owner: string; repo: string; title: string; body: string; }
export interface CreateGiteaPullInput { owner: string; repo: string; title: string; body: string; head: string; base: string; }
export interface GiteaLinkResult { number: number; url: string; }
export interface GiteaPullRequestStatus { merged: boolean; }

const execFileAsync = promisify(execFile);

export class GiteaClient {
  constructor(private readonly settings: GiteaSettings) {}

  async testConnection(): Promise<{ login?: string }> {
    return this.request('/api/v1/user', { method: 'GET' });
  }

  async createIssue(input: CreateGiteaIssueInput): Promise<GiteaLinkResult> {
    const data = await this.request(repoApiPath(input.owner, input.repo, 'issues'), {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    return { number: Number(data.number), url: this.webUrl(repoWebPath(input.owner, input.repo, `issues/${data.number}`)) };
  }

  async createPullRequest(input: CreateGiteaPullInput): Promise<GiteaLinkResult> {
    const data = await this.request(repoApiPath(input.owner, input.repo, 'pulls'), {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
    });
    return { number: Number(data.number), url: this.webUrl(repoWebPath(input.owner, input.repo, `pulls/${data.number}`)) };
  }

  async getPullRequestStatus(owner: string, repo: string, number: number): Promise<GiteaPullRequestStatus> {
    const data = await this.request(repoApiPath(owner, repo, `pulls/${number}`), { method: 'GET' });
    return { merged: data.merged === true };
  }

  private webUrl(path: string): string {
    // Gitea may return an internal/canonical URL without the externally exposed port.
    return `${this.settings.serverUrl}${path}`;
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    if (!this.settings.serverUrl || !this.settings.token) throw new Error('Gitea is not configured');
    const url = `${this.settings.serverUrl}${path}`;
    try {
      return await this.fetchRequest(url, init);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return this.curlRequest(url, init);
    }
  }

  private async fetchRequest(url: string, init: RequestInit): Promise<any> {
    const response = await fetch(url, {
      ...init,
      headers: this.headers(init),
    });
    return parseResponse(await response.text(), response.ok, response.status);
  }

  private async curlRequest(url: string, init: RequestInit): Promise<any> {
    const args = [
      '-sS',
      '--noproxy', '*',
      '--connect-timeout', '10',
      '-X', init.method || 'GET',
      '-H', 'Accept: application/json',
      '-H', `Authorization: token ${this.settings.token}`,
      '-w', '\n%{http_code}',
    ];
    if (init.body) {
      args.push('-H', 'Content-Type: application/json', '--data-binary', String(init.body));
    }
    args.push(url);
    const { stdout } = await execFileAsync('curl', args, { env: withoutProxyEnv(process.env), maxBuffer: 10 * 1024 * 1024 });
    const marker = stdout.lastIndexOf('\n');
    const text = marker >= 0 ? stdout.slice(0, marker) : stdout;
    const status = marker >= 0 ? Number(stdout.slice(marker + 1)) : 0;
    return parseResponse(text, status >= 200 && status < 300, status);
  }

  private headers(init: RequestInit): HeadersInit {
    return {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `token ${this.settings.token}`,
      ...(init.headers || {}),
    };
  }
}

function repoApiPath(owner: string, repo: string, suffix: string): string {
  return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${suffix}`;
}

function repoWebPath(owner: string, repo: string, suffix: string): string {
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${suffix}`;
}

function parseResponse(text: string, ok: boolean, status: number): any {
  const data = text ? JSON.parse(text) : {};
  if (!ok) throw new Error(typeof data.message === 'string' ? data.message : `Gitea request failed (${status})`);
  return data;
}

function withoutProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of ['ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy']) {
    delete next[key];
  }
  return next;
}
