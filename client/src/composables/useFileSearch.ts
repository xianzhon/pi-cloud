import { computed, ref, watch, type Ref } from 'vue';
import type { FileToken, FileSearchResult, FileSearchState } from '../types/fileSearch';
import { parseFileQuery, filterAndRankFiles } from '../services/fileSearchService';
import { getRecentFiles, addRecentFile } from '../services/recentFiles';

// Directories to exclude from file search
const MAX_SUGGESTIONS = 10;

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  'vendor',
]);

function shouldExcludePath(path: string): boolean {
  const parts = path.split('/');
  return parts.some(part => EXCLUDED_DIRS.has(part));
}

function isDirectPathQuery(query: string): boolean {
  return query.startsWith('/') || query.startsWith('~/');
}

export function findFileToken(text: string, cursor: number): FileToken | null {
  const beforeCursor = text.slice(0, cursor);
  const tokenStart = beforeCursor.search(/(^|\s)@[^\s]*$/);
  if (tokenStart === -1) return null;

  const atIndex = beforeCursor.indexOf('@', tokenStart);
  if (atIndex < 0) return null;

  const query = beforeCursor.slice(atIndex + 1);
  
  // Exclude URLs like mailto:user@domain.com
  if (beforeCursor.slice(Math.max(0, atIndex - 7), atIndex).includes('http:')) return null;
  if (beforeCursor.slice(Math.max(0, atIndex - 8), atIndex).includes('https:')) return null;

  return { start: atIndex, end: cursor, query };
}

export function replaceFileToken(text: string, token: FileToken, filePath: string) {
  const suffix = text.slice(token.end);
  const separator = /^\s/.test(suffix) ? '' : ' ';
  const nextText = `${text.slice(0, token.start)}@${filePath}${separator}${suffix}`;
  return { text: nextText, cursor: token.start + filePath.length + 2 };
}

type FileSearchPathSource = string | undefined | Ref<string | undefined> | (() => string | undefined);

function resolveProjectPath(projectPath?: FileSearchPathSource): string | undefined {
  if (typeof projectPath === 'function') {
    return projectPath();
  }

  if (projectPath && typeof projectPath === 'object' && 'value' in projectPath) {
    return projectPath.value;
  }

  return projectPath;
}

export function useFileSearch(projectPath?: FileSearchPathSource) {
  const state = ref<FileSearchState>({
    isOpen: false,
    activeIndex: 0,
    results: [],
    isLoading: false,
    query: ''
  });

  const activeToken = ref<FileToken | null>(null);
  const allFiles = ref<FileSearchResult[]>([]);
  const isCacheValid = ref(false);
  let cacheTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingFetch: Promise<FileSearchResult[]> | null = null;
  let queryRequestId = 0;

  const isOpen = computed(() => state.value.isOpen);
  const suggestions = computed(() => state.value.results.slice(0, MAX_SUGGESTIONS));
  const currentProjectPath = computed(() => resolveProjectPath(projectPath));

  function resetCache() {
    allFiles.value = [];
    isCacheValid.value = false;
    pendingFetch = null;
    if (cacheTimeout) {
      clearTimeout(cacheTimeout);
      cacheTimeout = null;
    }
  }

  watch(currentProjectPath, () => {
    resetCache();
  });

  async function fetchFiles(): Promise<FileSearchResult[]> {
    if (isCacheValid.value && allFiles.value.length > 0) {
      return allFiles.value;
    }

    if (pendingFetch) {
      return pendingFetch;
    }

    state.value.isLoading = true;
    pendingFetch = (async () => {
      const projectRoot = currentProjectPath.value;
      const searchPath = projectRoot && projectRoot !== '~' ? projectRoot : '.';
      try {
        const response = await fetch(`/api/files/search?pattern=**/*&path=${encodeURIComponent(searchPath)}`);
        if (!response.ok) throw new Error('Failed to fetch files');
        const data = await response.json();

        allFiles.value = data.files
          .filter((path: string) => !shouldExcludePath(path))
          .map((path: string) => {
            const parts = path.split('/');
            const name = parts[parts.length - 1];
            const directory = parts.slice(0, -1).join('/') || '.';
            const dotIndex = name.lastIndexOf('.');
            const type = dotIndex > 0 ? name.slice(dotIndex) : '';

            return {
              path,
              name,
              directory,
              type,
              score: 0,
              isRecent: false
            };
          });

        isCacheValid.value = true;
        if (cacheTimeout) clearTimeout(cacheTimeout);
        cacheTimeout = setTimeout(() => {
          isCacheValid.value = false;
        }, 5 * 60 * 1000);

        return allFiles.value;
      } catch (error) {
        console.error('Failed to fetch files:', error);
        return [];
      } finally {
        pendingFetch = null;
        state.value.isLoading = false;
      }
    })();

    return pendingFetch;
  }

  async function fetchPathQuery(query: string): Promise<FileSearchResult[]> {
    const slashIndex = query.lastIndexOf('/');
    const searchPath = query.slice(0, slashIndex) || '/';

    state.value.isLoading = true;
    try {
      const response = await fetch(`/api/files/search?pattern=*&path=${encodeURIComponent(searchPath)}`);
      if (!response.ok) return [];
      const data = await response.json() as { files: string[] };
      const files = data.files.map((filePath) => {
        const path = `${searchPath === '/' ? '' : searchPath}/${filePath}`;
        const name = filePath.split('/').at(-1) || filePath;
        const dotIndex = name.lastIndexOf('.');
        return {
          path,
          name,
          directory: path.slice(0, -(name.length + 1)) || '/',
          type: dotIndex > 0 ? name.slice(dotIndex) : '',
          score: 0,
          isRecent: false,
        };
      });
      return files;
    } catch (error) {
      console.error('Failed to fetch files:', error);
      return [];
    } finally {
      state.value.isLoading = false;
    }
  }

  async function updateQuery(text: string, cursor: number) {
    const requestId = ++queryRequestId;
    const token = findFileToken(text, cursor);
    const previousToken = activeToken.value;
    const queryChanged = previousToken?.start !== token?.start
      || previousToken?.end !== token?.end
      || previousToken?.query !== token?.query;
    activeToken.value = token;

    if (!token) {
      state.value.isOpen = false;
      state.value.results = [];
      state.value.query = '';
      return;
    }

    state.value.isOpen = true;
    state.value.query = token.query;
    if (queryChanged) {
      state.value.activeIndex = 0;
    }

    const files = isDirectPathQuery(token.query)
      ? await fetchPathQuery(token.query)
      : await fetchFiles();

    if (
      requestId !== queryRequestId ||
      activeToken.value?.start !== token.start ||
      activeToken.value?.end !== token.end ||
      activeToken.value?.query !== token.query
    ) {
      return;
    }

    const recentFiles = getRecentFiles();
    const recentFileResults = files
      .filter(f => recentFiles.includes(f.path))
      .map(f => ({ ...f, isRecent: true, score: 1 }));

    if (!token.query) {
      state.value.results = recentFileResults;
    } else {
      const queryText = isDirectPathQuery(token.query)
        ? token.query.slice(token.query.lastIndexOf('/') + 1)
        : token.query;
      const query = parseFileQuery(queryText);
      const filtered = filterAndRankFiles(files, query);
      const filteredPaths = new Set(filtered.map(f => f.path));
      const matchingRecent = recentFileResults.filter(f => filteredPaths.has(f.path));
      const recentPaths = new Set(matchingRecent.map(f => f.path));
      const nonRecent = filtered.filter(f => !recentPaths.has(f.path));

      state.value.results = [...matchingRecent, ...nonRecent];
    }
  }

  function close() {
    queryRequestId++;
    state.value.isOpen = false;
    state.value.activeIndex = 0;
    activeToken.value = null;
  }

  function move(delta: number) {
    const lastIndex = Math.min(state.value.results.length, MAX_SUGGESTIONS) - 1;
    if (lastIndex < 0) return;
    state.value.activeIndex = Math.min(
      Math.max(state.value.activeIndex + delta, 0),
      lastIndex,
    );
  }

  function getActiveFile(): FileSearchResult | undefined {
    return state.value.results[state.value.activeIndex];
  }

  function selectFile(file: FileSearchResult) {
    addRecentFile(file.path);
    close();
  }

  return {
    state,
    activeToken,
    isOpen,
    suggestions,
    close,
    getActiveFile,
    move,
    selectFile,
    updateQuery
  };
}
