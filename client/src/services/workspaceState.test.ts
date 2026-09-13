import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspaceState, saveWorkspaceState, WORKSPACE_STATE_STORAGE_KEY } from './workspaceState';

const validState = {
  showEditor: true,
  showTaskInbox: false,
  editorMaximized: true,
  terminalVisible: true,
  terminalMode: 'floating' as const,
  terminalPreviousMode: 'docked' as const,
  activeEditorFile: '/workspace/image.png',
};

describe('workspaceState', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists and restores workspace display state', () => {
    saveWorkspaceState(validState);

    expect(loadWorkspaceState()).toEqual(validState);
  });

  it('removes malformed or invalid persisted state', () => {
    sessionStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify({ ...validState, terminalMode: 'sideways' }));

    expect(loadWorkspaceState()).toBeNull();
    expect(sessionStorage.getItem(WORKSPACE_STATE_STORAGE_KEY)).toBeNull();

    sessionStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, '{bad');
    expect(loadWorkspaceState()).toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });

    expect(loadWorkspaceState()).toBeNull();
  });
});
