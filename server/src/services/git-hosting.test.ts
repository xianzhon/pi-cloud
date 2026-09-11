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

  it('rejects malformed and incomplete remote URLs', () => {
    expect(parseGiteaRemoteUrl('not a url', 'https://git.example.com')).toBeNull();
    expect(parseGiteaRemoteUrl('https://git.example.com/owner', 'https://git.example.com')).toBeNull();
    expect(parseGithubRemoteUrl('https://other.example.com/owner/repo')).toBeNull();
  });

  it('builds issue bodies with and without notes', async () => {
    const service = serviceWithRemotes({ origin: 'https://git.example.com/owner/repo.git' });
    const withNotes = await service.previewIssue({ cwd: '~', serverUrl: 'https://git.example.com', title: 'T', prompt: 'P', notes: 'N' });
    const withoutNotes = await service.previewIssue({ cwd: '.', serverUrl: 'https://git.example.com', title: 'T', prompt: 'P', notes: '' });
    expect(withNotes.body).toContain('Notes:\nN');
    expect(withoutNotes.body).not.toContain('Notes:');
  });

  it('previews changed files on a generated branch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    const service = new GitHostingService();
    vi.spyOn(service as unknown as { git: (cwd: string, args: string[]) => Promise<string> }, 'git').mockImplementation(async (_cwd, args) => {
      const key = args.join(' ');
      if (key === 'rev-parse --show-toplevel') return '/repo';
      if (key === 'symbolic-ref --quiet --short HEAD') return 'main';
      if (key === 'status --porcelain') return 'M  src/a.ts\n?? src/b.ts';
      if (key === 'remote') return 'origin';
      if (key === 'remote get-url origin') return 'git@github.com:owner/repo.git';
      if (key === 'log -1 --pretty=%s') return 'Add useful feature!';
      if (key === 'log --oneline main..main') return '';
      if (key === 'rev-parse HEAD') return 'abc';
      throw new Error(key);
    });
    const result = await service.previewPr({ cwd: '/repo', serverUrl: 'https://git.example.com', targetBranch: 'main' });
    expect(result).toMatchObject({ provider: 'github', generatedBranch: true, hasChanges: true, sourceBranch: 'pi/add-useful-feature-123', commitMessage: 'Update 2 files' });
    expect(result.body).toContain('- M src/a.ts');
  });

  it('previews an ahead source branch without working-tree changes', async () => {
    const service = new GitHostingService();
    vi.spyOn(service as unknown as { git: (cwd: string, args: string[]) => Promise<string> }, 'git').mockImplementation(async (_cwd, args) => {
      const key = args.join(' ');
      const values: Record<string, string> = {
        'rev-parse --show-toplevel': '/repo', 'symbolic-ref --quiet --short HEAD': 'feature', 'status --porcelain': '',
        remote: 'upstream', 'remote get-url upstream': 'https://git.example.com/o/r.git',
        'log --oneline main..feature': 'abc change', 'log -1 --pretty=%s': 'Change title', 'rev-parse HEAD': 'abc',
      };
      return values[key] ?? '';
    });
    const result = await service.previewPr({ cwd: '', serverUrl: 'https://git.example.com', targetBranch: 'main' });
    expect(result).toMatchObject({ generatedBranch: false, hasChanges: false, sourceBranch: 'feature', commitMessage: 'Change title' });
  });

  it('rejects empty and excessive PR previews and unmatched remotes', async () => {
    const service = new GitHostingService();
    const git = vi.spyOn(service as unknown as { git: (cwd: string, args: string[]) => Promise<string> }, 'git');
    git.mockImplementation(async (_cwd: string, args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse --show-toplevel') return '/repo';
      if (key === 'symbolic-ref --quiet --short HEAD') return 'main';
      if (key === 'status --porcelain') return '';
      if (key === 'remote') return 'origin';
      if (key === 'remote get-url origin') return 'https://git.example.com/o/r.git';
      return '';
    });
    await expect(service.previewPr({ cwd: '.', serverUrl: 'https://git.example.com', targetBranch: 'main' })).rejects.toThrow('nothing to PR');

    git.mockImplementation(async (_cwd: string, args: string[]) => args[0] === 'status' ? Array.from({ length: 1001 }, (_, i) => `M  f${i}`).join('\n') : args[0] === 'symbolic-ref' ? 'main' : '/repo');
    await expect(service.previewPr({ cwd: '.', serverUrl: 'https://git.example.com', targetBranch: 'main' })).rejects.toThrow('too many changed files');

    const unmatched = serviceWithRemotes({ origin: 'https://other.example.com/o/r.git' });
    await expect(unmatched.previewIssue({ cwd: '.', serverUrl: 'https://git.example.com', title: '', prompt: '', notes: '' })).rejects.toThrow('No git remote');
  });

  it('creates a PR with generated branch, commit, push, and defaults', async () => {
    const service = new GitHostingService();
    const preview = {
      cwd: '/repo', provider: 'gitea' as const, owner: 'o', repo: 'r', remoteName: 'origin', targetBranch: 'main', currentBranch: 'main',
      sourceBranch: 'pi/change', generatedBranch: true, hasChanges: true, files: [{ status: 'M', path: 'a' }],
      commitMessage: 'Update a', title: 'Default title', body: 'Default body', stateToken: 'same',
    };
    vi.spyOn(service, 'previewPr').mockResolvedValue(preview);
    const git = vi.spyOn(service as unknown as { git: (cwd: string, args: string[]) => Promise<string> }, 'git').mockResolvedValue('');
    const client = { createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'u' }) };
    await expect(service.createPr({ preview, title: '', body: '', commitMessage: '', serverUrl: 'https://git.example.com', client: client as any })).resolves.toEqual({ number: 1, url: 'u' });
    expect(git).toHaveBeenCalledWith('/repo', ['checkout', '-b', 'pi/change']);
    expect(git).toHaveBeenCalledWith('/repo', ['commit', '-m', 'Update a']);
    expect(client.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ title: 'Default title', body: 'Default body' }));
  });

  it('rejects creation when repository state changed', async () => {
    const service = new GitHostingService();
    const preview = { cwd: '/repo', targetBranch: 'main', stateToken: 'old' } as any;
    vi.spyOn(service, 'previewPr').mockResolvedValue({ ...preview, stateToken: 'new' });
    await expect(service.createPr({ preview, title: '', body: '', commitMessage: '', serverUrl: 'x', client: {} as any })).rejects.toThrow('Repository changed');
  });
});
