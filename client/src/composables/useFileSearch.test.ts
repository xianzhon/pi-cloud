import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findFileToken, replaceFileToken, useFileSearch } from './useFileSearch';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useFileSearch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe('findFileToken', () => {
    it('returns null for empty text', () => {
      expect(findFileToken('', 0)).toBeNull();
    });

    it('returns null when no @ symbol', () => {
      expect(findFileToken('hello world', 5)).toBeNull();
    });

    it('detects @ at start of text', () => {
      const token = findFileToken('@test', 5);
      expect(token).toEqual({
        start: 0,
        end: 5,
        query: 'test'
      });
    });

    it('detects @ after whitespace', () => {
      const token = findFileToken('hello @test', 11);
      expect(token).toEqual({
        start: 6,
        end: 11,
        query: 'test'
      });
    });

    it('returns null for @ in URL', () => {
      expect(findFileToken('mailto:user@domain.com', 20)).toBeNull();
    });

    it('returns null for @ in http URL', () => {
      expect(findFileToken('http://user@domain.com', 22)).toBeNull();
    });

    it('handles cursor in middle of token', () => {
      const token = findFileToken('@test query', 4);
      expect(token).toEqual({
        start: 0,
        end: 4,
        query: 'tes'
      });
    });

    it('handles multiple @ symbols', () => {
      const token = findFileToken('first @second @third', 18);
      expect(token).toEqual({
        start: 14,
        end: 18,
        query: 'thi'
      });
    });

    it('handles @ with path', () => {
      const token = findFileToken('@src/components', 15);
      expect(token).toEqual({
        start: 0,
        end: 15,
        query: 'src/components'
      });
    });

    it('handles @ with filter', () => {
      const token = findFileToken('@.ts', 4);
      expect(token).toEqual({
        start: 0,
        end: 4,
        query: '.ts'
      });
    });
  });

  describe('replaceFileToken', () => {
    it('adds a trailing space after the selected file reference', () => {
      expect(replaceFileToken('@chat', { start: 0, end: 5, query: 'chat' }, 'src/components/ChatPanel.vue')).toEqual({
        text: '@src/components/ChatPanel.vue ',
        cursor: 30,
      });
    });

    it('uses existing whitespace after the token instead of adding another space', () => {
      expect(replaceFileToken('See @chat please', { start: 4, end: 9, query: 'chat' }, 'src/components/ChatPanel.vue')).toEqual({
        text: 'See @src/components/ChatPanel.vue please',
        cursor: 34,
      });
    });
  });

  describe('updateQuery', () => {
    it('keeps the menu open while the initial file search is loading', async () => {
      const deferred = createDeferred<{ ok: boolean; json: () => Promise<{ files: string[] }> }>();
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(deferred.promise));

      const fileSearch = useFileSearch('.');
      const pendingUpdate = fileSearch.updateQuery('@chat', 5);

      expect(fileSearch.isOpen.value).toBe(true);
      expect(fileSearch.state.value.isLoading).toBe(true);
      expect(fileSearch.state.value.query).toBe('chat');

      deferred.resolve({
        ok: true,
        json: async () => ({
          files: ['src/components/ChatPanel.vue'],
        }),
      });

      await pendingUpdate;

      expect(fileSearch.state.value.isLoading).toBe(false);
      expect(fileSearch.suggestions.value.map((file) => file.path)).toEqual(['src/components/ChatPanel.vue']);
    });

    it('ignores stale async results from older queries', async () => {
      const deferred = createDeferred<{ ok: boolean; json: () => Promise<{ files: string[] }> }>();
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(deferred.promise));

      const fileSearch = useFileSearch('.');
      const firstUpdate = fileSearch.updateQuery('@p', 2);
      const secondUpdate = fileSearch.updateQuery('@panel', 6);

      deferred.resolve({
        ok: true,
        json: async () => ({
          files: ['src/components/ChatPanel.vue', 'src/composables/useChat.ts'],
        }),
      });

      await Promise.all([firstUpdate, secondUpdate]);

      expect(fileSearch.state.value.query).toBe('panel');
      expect(fileSearch.suggestions.value.map((file) => file.path)).toEqual(['src/components/ChatPanel.vue']);
    });

    it('keeps the selection within the visible results', async () => {
      const files = Array.from({ length: 12 }, (_, index) => `src/chat-${index}.ts`);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ files }),
      }));

      const fileSearch = useFileSearch('.');
      await fileSearch.updateQuery('@chat', 5);

      fileSearch.move(-1);
      expect(fileSearch.state.value.activeIndex).toBe(0);

      fileSearch.move(10);
      expect(fileSearch.state.value.activeIndex).toBe(9);

      fileSearch.move(1);
      expect(fileSearch.state.value.activeIndex).toBe(9);

      fileSearch.move(-1);
      expect(fileSearch.state.value.activeIndex).toBe(8);
    });

    it('preserves the active selection when the query text has not changed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          files: ['src/components/ChatPanel.vue', 'src/composables/useChat.ts'],
        }),
      }));

      const fileSearch = useFileSearch('.');
      await fileSearch.updateQuery('@chat', 5);

      fileSearch.move(1);
      expect(fileSearch.state.value.activeIndex).toBe(1);

      await fileSearch.updateQuery('@chat', 5);

      expect(fileSearch.state.value.activeIndex).toBe(1);
    });
  });
});
