import type { PiuiDatabase } from '../db/database';

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

export class AuditLog {
  constructor(private db: PiuiDatabase) {}

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
  return Math.min(Math.max(limit, 1), 500);
}
