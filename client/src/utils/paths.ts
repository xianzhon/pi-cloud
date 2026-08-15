export function formatHomePath(path?: string): string {
  if (!path) return '';
  return path
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}
