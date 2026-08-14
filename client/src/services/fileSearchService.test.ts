import { describe, it, expect } from 'vitest';
import { fuzzyMatch, parseFileQuery, filterAndRankFiles } from './fileSearchService';
import type { FileSearchResult } from '../types/fileSearch';

describe('fileSearchService', () => {
  describe('fuzzyMatch', () => {
    it('returns 1 for empty query', () => {
      expect(fuzzyMatch('', 'test.ts')).toBe(1);
    });

    it('returns 0 for no match', () => {
      expect(fuzzyMatch('xyz', 'test.ts')).toBe(0);
    });

    it('returns score for exact match', () => {
      const score = fuzzyMatch('test', 'test.ts');
      expect(score).toBeGreaterThan(0);
    });

    it('returns score for partial match', () => {
      const score = fuzzyMatch('te', 'test.ts');
      expect(score).toBeGreaterThan(0);
    });

    it('returns higher score for consecutive matches', () => {
      const score1 = fuzzyMatch('test', 'test.ts');
      const score2 = fuzzyMatch('test', 't-e-s-t.ts');
      expect(score1).toBeGreaterThan(score2);
    });

    it('is case insensitive', () => {
      const score = fuzzyMatch('TEST', 'test.ts');
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('parseFileQuery', () => {
    it('parses basic filename', () => {
      const result = parseFileQuery('test');
      expect(result).toEqual({
        pathPart: 'test',
        filterPart: '',
        rawQuery: 'test'
      });
    });

    it('parses path query', () => {
      const result = parseFileQuery('src/components');
      expect(result).toEqual({
        pathPart: 'src/components',
        filterPart: '',
        rawQuery: 'src/components'
      });
    });

    it('parses filter query', () => {
      const result = parseFileQuery('.ts');
      expect(result).toEqual({
        pathPart: '',
        filterPart: '.ts',
        rawQuery: '.ts'
      });
    });

    it('parses glob pattern *.md', () => {
      const result = parseFileQuery('*.md');
      expect(result).toEqual({
        pathPart: '',
        filterPart: '.md',
        rawQuery: '*.md'
      });
    });

    it('parses glob pattern *.ts', () => {
      const result = parseFileQuery('*.ts');
      expect(result).toEqual({
        pathPart: '',
        filterPart: '.ts',
        rawQuery: '*.ts'
      });
    });

    it('parses combined query', () => {
      const result = parseFileQuery('src/.ts');
      expect(result).toEqual({
        pathPart: 'src/',
        filterPart: '.ts',
        rawQuery: 'src/.ts'
      });
    });
  });

  describe('filterAndRankFiles', () => {
    const mockFiles: FileSearchResult[] = [
      { path: 'src/components/ChatPanel.vue', name: 'ChatPanel.vue', directory: 'src/components', type: '.vue', score: 0, isRecent: false },
      { path: 'src/composables/useChat.ts', name: 'useChat.ts', directory: 'src/composables', type: '.ts', score: 0, isRecent: false },
      { path: 'README.md', name: 'README.md', directory: '.', type: '.md', score: 0, isRecent: false },
    ];

    it('returns all files for empty query', () => {
      const result = filterAndRankFiles(mockFiles, { pathPart: '', filterPart: '', rawQuery: '' });
      expect(result).toHaveLength(3);
    });

    it('filters by path', () => {
      const result = filterAndRankFiles(mockFiles, { pathPart: 'src/', filterPart: '', rawQuery: 'src/' });
      expect(result).toHaveLength(2);
    });

    it('filters by extension', () => {
      const result = filterAndRankFiles(mockFiles, { pathPart: '', filterPart: '.ts', rawQuery: '.ts' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('useChat.ts');
    });

    it('filters by combined path and extension', () => {
      const result = filterAndRankFiles(mockFiles, { pathPart: 'src/', filterPart: '.ts', rawQuery: 'src/.ts' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('useChat.ts');
    });

    it('sorts by fuzzy match score', () => {
      const result = filterAndRankFiles(mockFiles, { pathPart: '', filterPart: '', rawQuery: 'chat' });
      expect(result[0].name).toBe('ChatPanel.vue');
    });
  });
});
