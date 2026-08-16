import { describe, expect, it, vi } from 'vitest';
import { GitHostingService, parseGiteaRemoteUrl, parseGithubRemoteUrl, parsePrTarget } from './git-hosting';

function serviceWithRemotes(remotes: Record<string, string>): GitHostingService {
  const service = new GitHostingService();
  vi.spyOn(service as unknown as { git: (cwd: string, args: string[]) => Promise<string> }, 'git').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'rev-parse') return '/repo';
    if (args.length === 1) return Object.keys(remotes).join('\n');
    return remotes[args[2]];
  });
  return service;
}

describe('git hosting helpers', () => {
  it.each([
    ['https://git.example.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['http://git.example.com/owner/repo', { owner: 'owner', repo: 'repo' }],
    ['ssh://git@git.example.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['git@git.example.com:owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['git@git.example.com:3000:owner/repo.git', { owner: 'owner', repo: 'repo' }],
  ])('parses %s', (url, expected) => {
    expect(parseGiteaRemoteUrl(url, 'https://git.example.com:3000')).toEqual(expected);
  });

  it('matches an SSH remote when the Gitea API uses a different port', () => {
    expect(parseGiteaRemoteUrl('git@git.example.com:owner/repo.git', 'https://git.example.com:6')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('does not match a remote with a different hostname', () => {
    expect(parseGiteaRemoteUrl('git@other.example.com:owner/repo.git', 'https://git.example.com:3000')).toBeNull();
  });

  it.each([
    ['https://github.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['git@github.com:owner/repo.git', { owner: 'owner', repo: 'repo' }],
  ])('parses GitHub remote %s', (url, expected) => {
    expect(parseGithubRemoteUrl(url)).toEqual(expected);
  });

  it('parses /pr target default', () => {
    expect(parsePrTarget('/pr')).toBe('main');
    expect(parsePrTarget('/pr release')).toBe('release');
  });

  it('uses the integration matching origin before other remotes', async () => {
    const service = serviceWithRemotes({
      github: 'https://github.com/owner/repo.git',
      origin: 'https://git.example.com/owner/repo.git',
    });
    const preview = await service.previewIssue({ cwd: '/repo', serverUrl: 'https://git.example.com', title: 'Title', prompt: '', notes: '' });
    expect(preview.provider).toBe('gitea');
  });

  it('falls back to another matching remote when origin is unavailable', async () => {
    const service = serviceWithRemotes({
      backup: 'https://github.com/owner/repo.git',
      origin: 'https://example.com/owner/repo.git',
    });
    const preview = await service.previewIssue({ cwd: '/repo', serverUrl: 'https://git.example.com', title: 'Title', prompt: '', notes: '' });
    expect(preview.provider).toBe('github');
  });
});
