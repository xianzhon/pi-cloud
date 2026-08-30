import type { PiCloudDatabase } from '../db/database';

export type SessionActivityKind = 'commit_created' | 'commit_amended' | 'pr_created' | 'branch_deleted';
export type PullRequestStatus = 'ready' | 'merged';
export type PullRequestProvider = 'github' | 'gitea';

export interface SessionActivityRecord<TData = Record<string, unknown>> {
  id: number;
  sessionId: string;
  kind: SessionActivityKind;
  data: TData;
  createdAt: string;
}

export interface RecordCommitActivityInput {
  sessionId?: string | null;
  cwd: string;
  message: string;
  commit: string;
  files: Array<{ status: string; path: string }>;
  mode: 'commit' | 'amend';
}

export interface RecordPrActivityInput {
  sessionId?: string | null;
  provider?: PullRequestProvider;
  cwd: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  commit?: string | null;
  status?: PullRequestStatus;
  checkedAt?: string;
}

export interface RecordBranchDeletedActivityInput {
  sessionId?: string | null;
  cwd: string;
  branch: string;
  commit: string;
}

interface SessionActivityStoreOptions {
  now?: () => string;
}

interface SessionActivityRow {
  id: number;
  session_id: string;
  kind: SessionActivityKind;
  data_json: string;
  created_at: string;
}

export class SessionActivityStore {
  private readonly now: () => string;

  constructor(private readonly db: PiCloudDatabase, options: SessionActivityStoreOptions = {}) {
    this.now = options.now || (() => new Date().toISOString());
  }

  recordCommit(input: RecordCommitActivityInput): SessionActivityRecord | null {
    if (!input.sessionId) return null;
    return this.insert(input.sessionId, input.mode === 'amend' ? 'commit_amended' : 'commit_created', {
      cwd: input.cwd,
      message: input.message,
      commit: input.commit,
      files: input.files,
    });
  }

  recordPr(input: RecordPrActivityInput): SessionActivityRecord | null {
    if (!input.sessionId) return null;
    return this.insert(input.sessionId, 'pr_created', {
      provider: input.provider,
      cwd: input.cwd,
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      url: input.url,
      title: input.title,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      commit: input.commit || null,
      status: input.status || 'ready',
      checkedAt: input.checkedAt || this.now(),
    });
  }

  recordBranchDeleted(input: RecordBranchDeletedActivityInput): SessionActivityRecord | null {
    if (!input.sessionId) return null;
    return this.insert(input.sessionId, 'branch_deleted', {
      cwd: input.cwd,
      branch: input.branch,
      commit: input.commit,
    });
  }

  listForSession(sessionId: string): SessionActivityRecord[] {
    const rows = this.db.prepare(`
      SELECT id, session_id, kind, data_json, created_at
      FROM session_builtin_events
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(sessionId) as SessionActivityRow[];
    return rows.map(mapRow);
  }

  updatePrStatus(id: number, status: PullRequestStatus, checkedAt = this.now()): SessionActivityRecord | undefined {
    const row = this.db.prepare('SELECT session_id, data_json FROM session_builtin_events WHERE id = ? AND kind = \'pr_created\'').get(id) as { session_id: string; data_json: string } | undefined;
    if (!row) return undefined;
    const data = parseJson(row.data_json);
    data.status = status;
    data.checkedAt = checkedAt;
    this.db.prepare('UPDATE session_builtin_events SET data_json = ? WHERE id = ?').run(JSON.stringify(data), id);
    return this.listForSession(row.session_id).find((record) => record.id === id);
  }

  listLatestPrForSessions(sessionIds: string[]): Map<string, SessionActivityRecord> {
    const latest = new Map<string, SessionActivityRecord>();
    if (sessionIds.length === 0) return latest;
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT id, session_id, kind, data_json, created_at
      FROM session_builtin_events
      WHERE kind = 'pr_created' AND session_id IN (${placeholders})
      ORDER BY created_at DESC, id DESC
    `).all(...sessionIds) as SessionActivityRow[];
    for (const row of rows) {
      if (!latest.has(row.session_id)) latest.set(row.session_id, mapRow(row));
    }
    return latest;
  }

  private insert(sessionId: string, kind: SessionActivityKind, data: Record<string, unknown>): SessionActivityRecord {
    const createdAt = this.now();
    const result = this.db.prepare(`
      INSERT INTO session_builtin_events (session_id, kind, data_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, kind, JSON.stringify(data), createdAt);
    return this.listForSession(sessionId).find((record) => record.id === Number(result.lastInsertRowid))!;
  }
}

function mapRow(row: SessionActivityRow): SessionActivityRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    data: parseJson(row.data_json),
    createdAt: row.created_at,
  };
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
