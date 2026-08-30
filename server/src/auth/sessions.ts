import { createHash, randomBytes } from 'crypto';
import type { PiCloudDatabase } from '../db/database';

const HOURS_TO_MS = 60 * 60 * 1000;
const RENEWAL_THRESHOLD_FRACTION = 0.5;

export interface SessionRecord {
  id: string;
  username: string;
  created_at: string;
  expires_at: string;
  absolute_expires_at: string;
  last_seen_at: string;
  renewed?: boolean;
  ip?: string;
  user_agent?: string;
}

export interface CreateSessionInput {
  username: string;
  ttlHours: number;
  maxLifetimeHours?: number;
  ip?: string;
  userAgent?: string;
}

export class SessionStore {
  constructor(private db: PiCloudDatabase, private cookieName: string) {}

  createSession(input: CreateSessionInput): { cookieName: string; token: string; expiresAt: Date } {
    const token = randomBytes(32).toString('hex');
    const id = randomBytes(16).toString('hex');
    const now = new Date();
    const ttlExpiresAt = addHours(now, input.ttlHours);
    const absoluteExpiresAt = input.maxLifetimeHours ? addHours(now, input.maxLifetimeHours) : ttlExpiresAt;
    const expiresAt = minDate(ttlExpiresAt, absoluteExpiresAt);

    this.db.prepare(`
      INSERT INTO sessions (id, token_hash, username, created_at, expires_at, absolute_expires_at, last_seen_at, ip, user_agent)
      VALUES (@id, @tokenHash, @username, @createdAt, @expiresAt, @absoluteExpiresAt, @lastSeenAt, @ip, @userAgent)
    `).run({
      id,
      tokenHash: hashToken(token),
      username: input.username,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      lastSeenAt: now.toISOString(),
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { cookieName: this.cookieName, token, expiresAt };
  }

  validateToken(token: string | undefined, renewal?: { ttlHours: number; now?: Date }): SessionRecord | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token)) as SessionRecord | undefined;
    if (!row) return null;

    const nowDate = renewal?.now || new Date();
    const nowTime = nowDate.getTime();
    const now = nowDate.toISOString();
    if (Date.parse(row.expires_at) <= nowTime || Date.parse(row.absolute_expires_at) <= nowTime) {
      this.revokeToken(token);
      return null;
    }

    const currentExpiresAt = Date.parse(row.expires_at);
    const absoluteExpiresAt = Date.parse(row.absolute_expires_at);
    const renewalMs = (renewal?.ttlHours || 0) * HOURS_TO_MS;
    const renewalExpiresAt = nowTime + renewalMs;
    const nextExpiresAt = renewal
      ? Math.min(renewalExpiresAt, absoluteExpiresAt)
      : currentExpiresAt;
    const renewalThresholdAt = renewalExpiresAt - renewalMs * RENEWAL_THRESHOLD_FRACTION;
    const renewed = Boolean(renewal && currentExpiresAt <= renewalThresholdAt && nextExpiresAt > currentExpiresAt);
    const expiresAt = renewed ? new Date(nextExpiresAt).toISOString() : row.expires_at;

    if (renewed) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, expiresAt, row.id);
    } else {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id);
    }

    return { ...row, expires_at: expiresAt, last_seen_at: now, renewed };
  }

  revokeToken(token: string | undefined): void {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  revokeExpired(now: Date = new Date()): number {
    const nowIso = now.toISOString();
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR absolute_expires_at <= ?').run(nowIso, nowIso);
    return Number(result.changes || 0);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOURS_TO_MS);
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}
