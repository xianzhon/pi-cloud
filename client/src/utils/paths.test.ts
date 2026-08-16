import { describe, expect, it } from 'vitest';
import { formatHomePath, normalizePathSeparators } from './paths';

describe('normalizePathSeparators', () => {
  it('canonicalizes Windows paths without changing POSIX paths', () => {
    expect(normalizePathSeparators('D:\\develop\\project\\src\\main.py')).toBe('D:/develop/project/src/main.py');
    expect(normalizePathSeparators('/workspace/src/main.ts')).toBe('/workspace/src/main.ts');
  });
});

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
