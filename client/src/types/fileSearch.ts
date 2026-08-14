export interface FileToken {
  start: number;  // Start position in input text
  end: number;    // End position in input text
  query: string;  // Everything after @
}

export interface FileQuery {
  pathPart: string;       // Directory filter
  filterPart: string;     // File extension filter
  rawQuery: string;       // Original query
}

export interface FileSearchResult {
  path: string;           // Relative path from project root
  name: string;           // File name
  directory: string;      // Directory path
  type: string;           // File extension
  score: number;          // Fuzzy match score
  isRecent: boolean;      // Whether this is a recent file
}

export interface FileSearchState {
  isOpen: boolean;
  activeIndex: number;
  results: FileSearchResult[];
  isLoading: boolean;
  query: string;
}
