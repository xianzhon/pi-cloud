import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { SessionStore } from './sessions';

describe('SessionStore', () => {
  let tempDir: string;
  let db: PiCloudDatabase;
  let store: SessionStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-sessions-'));
    db = openPiCloudDatabase(path.join(tempDir, 'pi-cloud.sqlite'));
    store = new SessionStore(db, 'pi_cloud_session');
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates a token and validates it by hash', () => {
    const created = store.createSession({
      username: 'me',
      ttlHours: 8,
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });

    expect(created.cookieName).toBe('pi_cloud_session');
    expect(created.token).toHaveLength(64);

    const validated = store.validateToken(created.token);
    expect(validated).toMatchObject({ username: 'me', ip: '127.0.0.1' });

    const rows = db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(rows[0].token_hash).not.toBe(created.token);
  });

  it('rejects expired sessions', () => {
    const created = store.createSession({ username: 'me', ttlHours: -1, ip: '127.0.0.1', userAgent: 'test' });
    expect(store.validateToken(created.token)).toBeNull();
  });

  it('clamps initial expiry to the absolute lifetime', () => {
    const created = store.createSession({ username: 'me', ttlHours: 2, maxLifetimeHours: 1 });
    const row = db.prepare('SELECT expires_at, absolute_expires_at FROM sessions').get() as { expires_at: string; absolute_expires_at: string };

    expect(created.expiresAt.toISOString()).toBe(row.absolute_expires_at);
    expect(row.expires_at).toBe(row.absolute_expires_at);
  });

  it('renews active sessions without exceeding the absolute lifetime', () => {
    const created = store.createSession({ username: 'me', ttlHours: 1, maxLifetimeHours: 2 });
    const renewalTime = new Date(Date.now() + 36 * 60 * 1000);

    const renewed = store.validateToken(created.token, { ttlHours: 1, now: renewalTime });

    expect(renewed?.renewed).toBe(true);
    expect(Date.parse(renewed!.expires_at)).toBeLessThanOrEqual(Date.parse(renewed!.absolute_expires_at));

    const absoluteExpiry = new Date(Date.parse(renewed!.absolute_expires_at) + 1);
    expect(store.validateToken(created.token, { ttlHours: 1, now: absoluteExpiry })).toBeNull();
  });

  it('revokes sessions expired by idle or absolute lifetime during cleanup', () => {
    store.createSession({ username: 'idle', ttlHours: -1, maxLifetimeHours: 1 });
    store.createSession({ username: 'absolute', ttlHours: 2, maxLifetimeHours: -1 });

    expect(store.revokeExpired()).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toMatchObject({ count: 0 });
  });

  it('revokes sessions', () => {
    const created = store.createSession({ username: 'me', ttlHours: 8, ip: '127.0.0.1', userAgent: 'test' });
    store.revokeToken(created.token);
    expect(store.validateToken(created.token)).toBeNull();
  });
});
