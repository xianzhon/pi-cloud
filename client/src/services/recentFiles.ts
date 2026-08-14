const STORAGE_KEY = 'pi-webui-recent-files';
const MAX_RECENT_FILES = 20;

export function getRecentFiles(): string[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addRecentFile(filePath: string): void {
  const files = getRecentFiles();
  const filtered = files.filter(f => f !== filePath);
  const updated = [filePath, ...filtered].slice(0, MAX_RECENT_FILES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function clearRecentFiles(): void {
  localStorage.removeItem(STORAGE_KEY);
}
