import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getRecentFiles, addRecentFile, clearRecentFiles } from './recentFiles';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

describe('recentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getRecentFiles returns empty array when no data', () => {
    localStorageMock.getItem.mockReturnValue(null);
    expect(getRecentFiles()).toEqual([]);
  });

  it('getRecentFiles returns parsed array', () => {
    const files = ['src/file1.ts', 'src/file2.ts'];
    localStorageMock.getItem.mockReturnValue(JSON.stringify(files));
    expect(getRecentFiles()).toEqual(files);
  });

  it('addRecentFile adds file to beginning', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['existing.ts']));
    addRecentFile('new.ts');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'pi-webui-recent-files',
      JSON.stringify(['new.ts', 'existing.ts'])
    );
  });

  it('addRecentFile removes duplicates', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['file.ts', 'other.ts']));
    addRecentFile('file.ts');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'pi-webui-recent-files',
      JSON.stringify(['file.ts', 'other.ts'])
    );
  });

  it('addRecentFile limits to 20 files', () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
    localStorageMock.getItem.mockReturnValue(JSON.stringify(files));
    addRecentFile('new.ts');
    const setItemCall = localStorageMock.setItem.mock.calls[0];
    const savedFiles = JSON.parse(setItemCall[1]);
    expect(savedFiles).toHaveLength(20);
    expect(savedFiles[0]).toBe('new.ts');
  });

  it('clearRecentFiles removes item from localStorage', () => {
    clearRecentFiles();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('pi-webui-recent-files');
  });
});
