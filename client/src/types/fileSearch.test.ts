import { describe, it, expect } from 'vitest';
import type { FileToken, FileQuery, FileSearchResult, FileSearchState } from './fileSearch';

describe('FileSearch Types', () => {
  it('FileToken has correct structure', () => {
    const token: FileToken = {
      start: 0,
      end: 5,
      query: 'test'
    };
    expect(token.start).toBe(0);
    expect(token.end).toBe(5);
    expect(token.query).toBe('test');
  });

  it('FileQuery has correct structure', () => {
    const query: FileQuery = {
      pathPart: 'src/',
      filterPart: '.ts',
      rawQuery: 'src/.ts'
    };
    expect(query.pathPart).toBe('src/');
    expect(query.filterPart).toBe('.ts');
    expect(query.rawQuery).toBe('src/.ts');
  });

  it('FileSearchResult has correct structure', () => {
    const result: FileSearchResult = {
      path: 'src/components/ChatPanel.vue',
      name: 'ChatPanel.vue',
      directory: 'src/components',
      type: '.vue',
      score: 0.95,
      isRecent: false
    };
    expect(result.path).toBe('src/components/ChatPanel.vue');
    expect(result.name).toBe('ChatPanel.vue');
    expect(result.score).toBe(0.95);
  });

  it('FileSearchState has correct structure', () => {
    const state: FileSearchState = {
      isOpen: true,
      activeIndex: 0,
      results: [],
      isLoading: false,
      query: ''
    };
    expect(state.isOpen).toBe(true);
    expect(state.activeIndex).toBe(0);
  });
});
