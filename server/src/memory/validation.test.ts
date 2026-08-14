import { describe, expect, it } from 'vitest';
import {
  assertMemoryContent,
  hashMemoryContent,
  normalizeMemoryContent,
  normalizeMemoryTags,
} from './validation.js';

describe('memory validation', () => {
  it('normalizes content and tags deterministically', () => {
    expect(normalizeMemoryContent('  Prefer   surgical\n changes. ')).toBe('Prefer surgical changes.');
    expect(normalizeMemoryTags([' Worktree ', 'worktree', 'Architecture'])).toEqual(['worktree', 'architecture']);
    expect(hashMemoryContent('Remember This')).toBe(hashMemoryContent(' remember   this '));
  });

  it('limits normalized tags by count and length', () => {
    const tags = Array.from({ length: 12 }, (_, index) => `${index}-${'x'.repeat(40)}`);
    const normalized = normalizeMemoryTags(tags);

    expect(normalized).toHaveLength(10);
    expect(normalized.every((tag) => tag.length <= 32)).toBe(true);
  });

  it.each([
    `OPENAI_API_KEY=${'sk-' + 'a'.repeat(32)}`,
    `github token ${'gh' + 'p_' + 'b'.repeat(32)}`,
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'password: correct-horse-battery-staple',
  ])('rejects secret-like content: %s', (content) => {
    expect(() => assertMemoryContent(content)).toThrow(/secret|credential/i);
  });

  it('accepts discussion about secrets without a secret value', () => {
    expect(() => assertMemoryContent('Never commit API keys or private keys.')).not.toThrow();
  });

  it('rejects empty and oversized memories', () => {
    expect(() => assertMemoryContent('   ')).toThrow(/required/i);
    expect(() => assertMemoryContent('x'.repeat(2_001))).toThrow(/too long/i);
  });
});
