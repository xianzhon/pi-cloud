export type WorkspacePanelMode = 'docked' | 'floating' | 'maximized';

export interface WorkspaceState {
  showEditor: boolean;
  showTaskInbox: boolean;
  editorMaximized: boolean;
  terminalVisible: boolean;
  terminalMode: WorkspacePanelMode;
  terminalPreviousMode: Exclude<WorkspacePanelMode, 'maximized'>;
  activeEditorFile?: string;
}

export const WORKSPACE_STATE_STORAGE_KEY = 'pi-cloud-workspace-state-v1';

function isPanelMode(value: unknown): value is WorkspacePanelMode {
  return value === 'docked' || value === 'floating' || value === 'maximized';
}

export function loadWorkspaceState(): WorkspaceState | null {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<WorkspaceState>;
    if (
      typeof value.showEditor !== 'boolean'
      || typeof value.showTaskInbox !== 'boolean'
      || typeof value.editorMaximized !== 'boolean'
      || typeof value.terminalVisible !== 'boolean'
      || !isPanelMode(value.terminalMode)
      || (value.terminalPreviousMode !== 'docked' && value.terminalPreviousMode !== 'floating')
      || (value.activeEditorFile !== undefined && typeof value.activeEditorFile !== 'string')
    ) {
      sessionStorage.removeItem(WORKSPACE_STATE_STORAGE_KEY);
      return null;
    }

    return value as WorkspaceState;
  } catch {
    return null;
  }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  try {
    sessionStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be disabled or unavailable in private browsing contexts.
  }
}
