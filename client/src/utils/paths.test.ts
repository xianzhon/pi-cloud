import { describe, expect, it } from 'vitest';
import { formatHomePath } from './paths';

describe('formatHomePath', () => {
  it('replaces Linux and macOS home directories with a tilde', () => {
    expect(formatHomePath('/home/example/git/project')).toBe('~/git/project');
    expect(formatHomePath('/Users/example/git/project')).toBe('~/git/project');
  });

  it('preserves paths outside a conventional home directory', () => {
    expect(formatHomePath('/workspace/project')).toBe('/workspace/project');
    expect(formatHomePath('~/git/project')).toBe('~/git/project');
  });

  it('returns an empty string when no path is provided', () => {
    expect(formatHomePath()).toBe('');
  });
});
