import type { FileQuery, FileSearchResult } from '../types/fileSearch';

export function fuzzyMatch(query: string, text: string): number {
  if (!query) return 1;
  
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;
  
  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      score += consecutiveMatches * 2 + 1;
      consecutiveMatches++;
      queryIndex++;
    } else {
      consecutiveMatches = 0;
    }
  }
  
  // Return raw score (higher is better) if all query chars matched
  return queryIndex === queryLower.length ? score : 0;
}

export function parseFileQuery(query: string): FileQuery {
  // Handle glob patterns like *.md, *.ts, etc.
  if (query.startsWith('*.')) {
    return {
      pathPart: '',
      filterPart: query.slice(1), // Remove the * and keep the extension
      rawQuery: query
    };
  }
  
  const lastDotIndex = query.lastIndexOf('.');
  const lastSlashIndex = query.lastIndexOf('/');
  
  if (lastDotIndex > lastSlashIndex) {
    return {
      pathPart: query.slice(0, lastDotIndex),
      filterPart: query.slice(lastDotIndex),
      rawQuery: query
    };
  }
  
  return {
    pathPart: query,
    filterPart: '',
    rawQuery: query
  };
}

export function filterAndRankFiles(
  files: FileSearchResult[],
  query: FileQuery
): FileSearchResult[] {
  const pathPart = query.pathPart.toLowerCase();
  const filterPart = query.filterPart.toLowerCase();
  let filtered = [...files];

  if (pathPart) {
    filtered = filtered.filter((file) => file.path.toLowerCase().includes(pathPart));
  }

  if (filterPart) {
    filtered = filtered.filter((file) => file.name.toLowerCase().endsWith(filterPart));
  }

  const shouldFuzzyMatch = Boolean(query.rawQuery && !query.rawQuery.startsWith('*'));
  const ranked = filtered.map((file) => ({
    ...file,
    score: shouldFuzzyMatch ? fuzzyMatch(query.rawQuery, file.path) : 1,
  }));

  return ranked
    .filter((file) => !shouldFuzzyMatch || file.score > 0)
    .sort(compareFileSearchResults);
}

function compareFileSearchResults(left: FileSearchResult, right: FileSearchResult): number {
  if (left.score !== right.score) return right.score - left.score;
  return left.path.split('/').length - right.path.split('/').length;
}
