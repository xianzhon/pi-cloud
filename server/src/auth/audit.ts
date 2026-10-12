import type { PiCloudDatabase } from '../db/database';

export interface AuditEventInput {
  type: string;
  status: 'success' | 'failure' | 'info';
  username?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  type: string;
  status: AuditEventInput['status'];
  username?: string;
  ip?: string;
  userAgent?: string;
  metadata: Record<string, unknown>;
}

interface AuditEventRow {
  id: number;
  created_at: string;
  type: string;
  status: AuditEventInput['status'];
  username?: string;
  ip?: string;
  user_agent?: string;
  metadata?: string;
}

const DEFAULT_MAX_AUDIT_EVENTS = 10_000;
const PRUNE_EVERY_INSERTS = 100;

export class AuditLog {
  private insertsSincePrune = 0;

  // Unauthenticated requests are audited, so retention must be bounded.
  constructor(private db: PiCloudDatabase, private readonly maxEvents = DEFAULT_MAX_AUDIT_EVENTS) {
    this.prune();
  }

  record(event: AuditEventInput): void {
    this.db.prepare(`
      INSERT INTO audit_events (created_at, type, status, username, ip, user_agent, metadata)
      VALUES (@createdAt, @type, @status, @username, @ip, @userAgent, @metadata)
    `).run({
      createdAt: new Date().toISOString(),
      type: event.type,
      status: event.status,
      username: event.username,
      ip: event.ip,
      userAgent: event.userAgent,
      metadata: JSON.stringify(event.metadata || {}),
    });
    if (++this.insertsSincePrune >= PRUNE_EVERY_INSERTS) this.prune();
  }

  prune(): void {
    this.insertsSincePrune = 0;
    this.db.prepare(`
      DELETE FROM audit_events
      WHERE id <= (SELECT id FROM audit_events ORDER BY id DESC LIMIT 1 OFFSET ?)
    `).run(this.maxEvents);
  }

  clear(): void {
    this.db.prepare('DELETE FROM audit_events').run();
  }

  list(limit = 100): AuditEvent[] {
    const rows = this.db.prepare(`
      SELECT id, created_at, type, status, username, ip, user_agent, metadata
      FROM audit_events
      ORDER BY id DESC
      LIMIT ?
    `).all(clampAuditLimit(limit)) as AuditEventRow[];

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      type: row.type,
      status: row.status,
      username: row.username,
      ip: row.ip,
      userAgent: row.user_agent,
      metadata: JSON.parse(row.metadata || '{}'),
    }));
  }
}

function clampAuditLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}
