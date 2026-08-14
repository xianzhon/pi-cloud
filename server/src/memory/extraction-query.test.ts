import { describe, expect, it } from 'vitest';
import { buildExtractionQueries } from './extraction-query.js';
import type { ExtractionSource } from './extraction-format.js';

describe('extraction conflict queries', () => {
  it('prioritizes bounded paths, symbols, commands, quoted phrases, and topic text', () => {
    const source: ExtractionSource = {
      text: '',
      evidence: [
        {
          id: 'e1', role: 'user',
          text: 'Remember "stable project identity" for server/src/memory/store.ts and MemoryStore.relocateProject.',
          path: 'server/src/memory/store.ts',
          symbol: 'MemoryStore.relocateProject',
        },
        {
          id: 'e2', role: 'assistant', text: 'Verified pnpm test before completion.', command: 'pnpm test',
        },
      ],
    };

    const queries = buildExtractionQueries(source);

    expect(queries.length).toBeLessThanOrEqual(6);
    expect(queries.join('\n')).toContain('server');
    expect(queries.join('\n')).toContain('MemoryStore');
    expect(queries.join('\n')).toContain('pnpm');
    expect(queries.join('\n')).toContain('stable');
    expect(new Set(queries).size).toBe(queries.length);
  });
});
