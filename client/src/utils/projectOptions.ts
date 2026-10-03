import { formatHomePath } from './paths';

export function orderProjectPaths(paths: string[], favorites: string[] = []): string[] {
  return Array.from(new Set([...favorites, ...paths].filter((path) => typeof path === 'string' && path.trim().length > 0)));
}

export function matchesProjectPath(path: string, query: string): boolean {
  const search = query.trim().toLowerCase();
  return path.toLowerCase().includes(search) || formatHomePath(path).toLowerCase().includes(search);
}
