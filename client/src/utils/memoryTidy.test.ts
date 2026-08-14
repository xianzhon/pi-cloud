import { describe, expect, it } from 'vitest';
import { findMemoryTidySuggestions } from './memoryTidy';
import type { MemoryRecord } from '../types/memory';

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? 'memory-id',
    profileId: 'profile',
    projectId: 'project',
    scope: 'project',
    category: 'fact',
    content: 'content',
    tags: [],
    pinned: false,
    status: 'active',
    source: 'automatic',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findMemoryTidySuggestions', () => {
  it('archives exact duplicates while keeping the newest memory', () => {
    const suggestions = findMemoryTidySuggestions([
      memory({ id: 'old', content: 'Memory delete is implemented.', updatedAt: '2026-01-01T00:00:00.000Z' }),
      memory({ id: 'new', content: ' memory delete is implemented. ', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ reason: 'exact_duplicate' });
    expect(suggestions[0].archive.id).toBe('old');
    expect(suggestions[0].keep.id).toBe('new');
  });

  it('finds near duplicates with minor wording differences', () => {
    const suggestions = findMemoryTidySuggestions([
      memory({ id: 'left', content: 'The memory extraction parser discards exact new duplicates when the duplicate is already in searched existing memories.' }),
      memory({ id: 'right', content: 'Memory extraction parsing discards exact new duplicates when the duplicate is already in searched existing memories.', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ reason: 'near_duplicate' });
  });

  it('suggests stale contradiction cleanup for old no-way memories', () => {
    const suggestions = findMemoryTidySuggestions([
      memory({ id: 'stale', content: 'There is currently no way to delete a memory.' }),
      memory({ id: 'current', content: 'Memory delete is implemented.', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ reason: 'stale_contradiction' });
    expect(suggestions[0].archive.id).toBe('stale');
    expect(suggestions[0].keep.id).toBe('current');
  });

  it('handles slash wording in stale contradiction subjects', () => {
    const suggestions = findMemoryTidySuggestions([
      memory({ id: 'stale', content: 'There is currently no way to unarchive a memory.' }),
      memory({ id: 'current', content: 'Memory restore/unarchive is implemented.', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].archive.id).toBe('stale');
  });

  it('does not compare memories from different categories or statuses', () => {
    const suggestions = findMemoryTidySuggestions([
      memory({ id: 'rule', category: 'rule', content: 'Use the existing selector style.' }),
      memory({ id: 'fact', category: 'fact', content: 'Use the existing selector style.' }),
      memory({ id: 'archived', content: 'Use the existing selector style.', status: 'archived' }),
    ]);

    expect(suggestions).toHaveLength(0);
  });
});
