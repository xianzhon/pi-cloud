import type { PiuiDatabase } from '../db/database';
import type { SessionWorktreeInfo } from '../types';

export type SaveWorktreeInfo = Omit<SessionWorktreeInfo, 'createdAt' | 'updatedAt' | 'finishedAt'> & {
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
};

interface WorktreeRow {
  session_id: string;
  base_repo_path: string;
  worktree_path: string;
  branch_name: string;
  branch_mode: 'new' | 'existing';
  base_branch: string | null;
  worktree_managed: number;
  worktree_status: 'active' | 'finished';
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToInfo(row: WorktreeRow): SessionWorktreeInfo {
  return {
    sessionId: row.session_id,
    baseRepoPath: row.base_repo_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    branchMode: row.branch_mode,
    baseBranch: row.base_branch || undefined,
    worktreeManaged: true,
    worktreeStatus: row.worktree_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || undefined,
  };
}

export class WorktreeMetadataStore {
  constructor(private readonly db: PiuiDatabase) {}

  save(info: SaveWorktreeInfo): SessionWorktreeInfo {
    const existing = this.get(info.sessionId);
    const createdAt = info.createdAt || existing?.createdAt || nowIso();
    const updatedAt = info.updatedAt || nowIso();

    this.db.prepare(`
      INSERT INTO session_worktrees (
        session_id, base_repo_path, worktree_path, branch_name, branch_mode, base_branch,
        worktree_managed, worktree_status, created_at, updated_at, finished_at
      ) VALUES (
        @sessionId, @baseRepoPath, @worktreePath, @branchName, @branchMode, @baseBranch,
        1, @worktreeStatus, @createdAt, @updatedAt, @finishedAt
      )
      ON CONFLICT(session_id) DO UPDATE SET
        base_repo_path = excluded.base_repo_path,
        worktree_path = excluded.worktree_path,
        branch_name = excluded.branch_name,
        branch_mode = excluded.branch_mode,
        base_branch = excluded.base_branch,
        worktree_managed = excluded.worktree_managed,
        worktree_status = excluded.worktree_status,
        updated_at = excluded.updated_at,
        finished_at = excluded.finished_at
    `).run({
      ...info,
      baseBranch: info.baseBranch || null,
      createdAt,
      updatedAt,
      finishedAt: info.finishedAt || null,
    });

    return this.get(info.sessionId)!;
  }

  get(sessionId: string): SessionWorktreeInfo | null {
    const row = this.db.prepare('SELECT * FROM session_worktrees WHERE session_id = ?').get(sessionId) as WorktreeRow | undefined;
    return row ? rowToInfo(row) : null;
  }

  getMany(sessionIds: string[]): Map<string, SessionWorktreeInfo> {
    const uniqueIds = Array.from(new Set(sessionIds.filter(Boolean)));
    if (uniqueIds.length === 0) return new Map();
    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM session_worktrees WHERE session_id IN (${placeholders})`).all(...uniqueIds) as WorktreeRow[];
    return new Map(rows.map((row) => [row.session_id, rowToInfo(row)]));
  }

  listByBaseRepoPath(baseRepoPath: string): SessionWorktreeInfo[] {
    const rows = this.db.prepare('SELECT * FROM session_worktrees WHERE base_repo_path = ?').all(baseRepoPath) as WorktreeRow[];
    return rows.map(rowToInfo);
  }

  markFinished(sessionId: string): void {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE session_worktrees
      SET worktree_status = 'finished', updated_at = ?, finished_at = ?
      WHERE session_id = ?
    `).run(timestamp, timestamp, sessionId);
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM session_worktrees WHERE session_id = ?').run(sessionId);
  }
}

let worktreeMetadataStore: WorktreeMetadataStore | undefined;

export function initializeWorktreeMetadataStore(db: PiuiDatabase): WorktreeMetadataStore {
  worktreeMetadataStore = new WorktreeMetadataStore(db);
  return worktreeMetadataStore;
}

export function getWorktreeMetadataStore(): WorktreeMetadataStore {
  if (!worktreeMetadataStore) {
    throw new Error('Worktree metadata store has not been initialized');
  }
  return worktreeMetadataStore;
}
