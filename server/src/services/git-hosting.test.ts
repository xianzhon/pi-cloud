import { describe, expect, it } from 'vitest';
import { parseGiteaRemoteUrl, parseGithubRemoteUrl, parsePrTarget } from './git-hosting';

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
});
