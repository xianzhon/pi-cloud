import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { GiteaClient, GiteaLinkResult } from './gitea-client';
import type { GithubClient } from './github-client';
import { expandHomePath } from '../utils/paths';

const execFileAsync = promisify(execFile);
const maxBuffer = 256 * 1024;
const maxPreviewFiles = 1_000;

export type GitProvider = 'github' | 'gitea';
export interface RepoRef { owner: string; repo: string; provider?: GitProvider; }
export interface PrPreview {
  cwd: string;
  provider: GitProvider;
  owner: string;
  repo: string;
  remoteName: string;
  targetBranch: string;
  currentBranch: string;
  sourceBranch: string;
  generatedBranch: boolean;
  hasChanges: boolean;
  files: Array<{ status: string; path: string }>;
  commitMessage: string;
  title: string;
  body: string;
  stateToken: string;
}

export interface IssuePreview {
  provider: GitProvider;
  owner: string;
  repo: string;
  title: string;
  body: string;
}

export function parsePrTarget(text: string): string {
  const target = text.trim().replace(/^\/pr(?:\s+|$)/i, '').trim().split(/\s+/)[0];
  return target || 'main';
}

export function parseGiteaRemoteUrl(remoteUrl: string, serverUrl: string): RepoRef | null {
  return parseHostedRemoteUrl(remoteUrl, serverUrl);
}

export function parseGithubRemoteUrl(remoteUrl: string, serverUrl = 'https://github.com'): RepoRef | null {
  return parseHostedRemoteUrl(remoteUrl, serverUrl);
}

function parseHostedRemoteUrl(remoteUrl: string, serverUrl: string): RepoRef | null {
  const serverHostname = new URL(serverUrl).hostname;
  const scp = remoteUrl.match(/^git@([^/:]+)(?::(\d+))?:([^/]+)\/(.+?)(?:\.git)?$/);
  if (scp) return scp[1] === serverHostname ? { owner: scp[3], repo: stripGit(scp[4]) } : null;

  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== serverHostname) return null;
  const [owner, repo] = parsed.pathname.replace(/^\//, '').split('/');
  if (!owner || !repo) return null;
  return { owner, repo: stripGit(repo) };
}

function stripGit(repo: string): string {
  return repo.replace(/\.git$/, '');
}

export class GitHostingService {
  async previewIssue(input: { cwd: string; serverUrl: string; githubServerUrl?: string; title: string; prompt: string; notes: string }): Promise<IssuePreview> {
    const root = await this.root(input.cwd);
    const remote = await this.resolveRemote(root, input.serverUrl, input.githubServerUrl);
    const ref = this.parseRemote(remote.url, input.serverUrl, input.githubServerUrl);
    if (!ref) throw new Error('Unable to infer owner/repo from git remote');
    return {
      ...ref,
      title: input.title,
      body: [input.prompt, input.notes ? `Notes:\n${input.notes}` : '', `Project: ${root}`].filter(Boolean).join('\n\n'),
    };
  }

  async previewPr(input: { cwd: string; serverUrl: string; githubServerUrl?: string; targetBranch: string }): Promise<PrPreview> {
    const root = await this.root(input.cwd || '.');
    const currentBranch = await this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const status = await this.git(root, ['status', '--porcelain']);
    const files = parseStatusFiles(status);
    if (files.length > maxPreviewFiles) {
      throw new Error('There are too many changed files to preview safely. Inspect them with Git in the terminal or another Git client.');
    }
    const remote = await this.resolveRemote(root, input.serverUrl, input.githubServerUrl);
    const ref = this.parseRemote(remote.url, input.serverUrl, input.githubServerUrl);
    if (!ref) throw new Error('Unable to infer owner/repo from git remote');
    const generatedBranch = currentBranch === input.targetBranch && files.length > 0;
    if (currentBranch === input.targetBranch && files.length === 0) throw new Error('Current branch matches target branch and there is nothing to PR');
    if (currentBranch !== input.targetBranch && files.length === 0) {
      const commits = await this.git(root, ['log', '--oneline', `${input.targetBranch}..${currentBranch}`]).catch(() => '');
      if (!commits.trim()) throw new Error('Nothing to PR: source branch has no changes ahead of target');
    }
    const sourceBranch = generatedBranch ? `pi/${slug(await this.git(root, ['log', '-1', '--pretty=%s']).catch(() => 'changes') || 'changes')}-${Date.now()}` : currentBranch;
    const commitMessage = files.length ? proposeCommitMessage(files) : await this.git(root, ['log', '-1', '--pretty=%s']);
    const title = sourceBranch;
    const body = await this.body(root, input.targetBranch, currentBranch, files);
    const head = await this.git(root, ['rev-parse', 'HEAD']);
    return {
      cwd: root,
      ...ref,
      remoteName: remote.name,
      targetBranch: input.targetBranch,
      currentBranch,
      sourceBranch,
      generatedBranch,
      hasChanges: files.length > 0,
      files,
      commitMessage,
      title,
      body,
      stateToken: createStateToken({ root, head, currentBranch, status, targetBranch: input.targetBranch, remoteUrl: remote.url }),
    };
  }

  async createPr(input: { preview: PrPreview; title: string; body: string; commitMessage: string; serverUrl: string; githubServerUrl?: string; client: GiteaClient | GithubClient }): Promise<GiteaLinkResult> {
    const preview = input.preview;
    const current = await this.previewPr({ cwd: preview.cwd, serverUrl: input.serverUrl, githubServerUrl: input.githubServerUrl, targetBranch: preview.targetBranch });
    if (current.stateToken !== preview.stateToken) throw new Error('Repository changed since preview. Please rerun /pr.');
    if (preview.generatedBranch) await this.git(preview.cwd, ['checkout', '-b', preview.sourceBranch]);
    if (preview.hasChanges) {
      await this.git(preview.cwd, ['add', '-A']);
      await this.git(preview.cwd, ['commit', '-m', input.commitMessage || preview.commitMessage]);
    }
    await this.git(preview.cwd, ['push', '-u', preview.remoteName, preview.sourceBranch]);
    return input.client.createPullRequest({
      owner: preview.owner,
      repo: preview.repo,
      title: input.title || preview.title,
      body: input.body || preview.body,
      head: preview.sourceBranch,
      base: preview.targetBranch,
    });
  }

  private async root(cwd: string): Promise<string> {
    return this.git(expandHomePath(cwd || '.'), ['rev-parse', '--show-toplevel']);
  }

  private async resolveRemote(root: string, serverUrl: string, githubServerUrl = 'https://github.com'): Promise<{ name: string; url: string }> {
    const remotes = (await this.git(root, ['remote'])).split('\n').filter(Boolean);
    let giteaRemote: { name: string; url: string } | null = null;
    for (const name of remotes) {
      const url = await this.git(root, ['remote', 'get-url', name]);
      if (parseGithubRemoteUrl(url, githubServerUrl)) return { name, url };
      if (!giteaRemote && parseGiteaRemoteUrl(url, serverUrl)) giteaRemote = { name, url };
    }
    if (giteaRemote) return giteaRemote;
    throw new Error('No git remote matches configured GitHub or Gitea servers');
  }

  private parseRemote(url: string, serverUrl: string, githubServerUrl = 'https://github.com'): (RepoRef & { provider: GitProvider }) | null {
    const github = parseGithubRemoteUrl(url, githubServerUrl);
    if (github) return { ...github, provider: 'github' };
    const gitea = parseGiteaRemoteUrl(url, serverUrl);
    if (gitea) return { ...gitea, provider: 'gitea' };
    return null;
  }

  private async body(root: string, target: string, source: string, files: Array<{ status: string; path: string }>): Promise<string> {
    const commits = await this.git(root, ['log', '--oneline', `${target}..${source}`]).catch(() => '');
    const changedFiles = files.map((file) => `- ${file.status} ${file.path}`).join('\n') || '(none)';
    return [
      `Source branch: ${source}`,
      `Target branch: ${target}`,
      '',
      'Commits:',
      commits || '(none)',
      '',
      'Changed files:',
      changedFiles,
    ].join('\n');
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer });
      return stdout.trim();
    } catch (error) {
      if ((error as { code?: string })?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        || (error instanceof Error && error.message.includes('maxBuffer length exceeded'))) {
        throw new Error('The Git output is too large to process safely. Inspect it with Git in the terminal or another Git client.');
      }
      throw error;
    }
  }
}

function createStateToken(input: { root: string; head: string; currentBranch: string; status: string; targetBranch: string; remoteUrl: string }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function parseStatusFiles(status: string): Array<{ status: string; path: string }> {
  return status.split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));
}

function proposeCommitMessage(files: Array<{ status: string; path: string }>): string {
  return files.length === 1 ? `Update ${files[0].path}` : `Update ${files.length} files`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'changes';
}
