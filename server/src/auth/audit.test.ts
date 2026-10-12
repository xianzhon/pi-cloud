import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { AuditLog } from './audit';

describe('AuditLog', () => {
  let tempDir: string;
  let db: PiCloudDatabase;
  let audit: AuditLog;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-audit-'));
    db = openPiCloudDatabase(path.join(tempDir, 'pi-cloud.sqlite'));
    audit = new AuditLog(db);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('records and lists newest audit events first', () => {
    audit.record({ type: 'login_failure', status: 'failure', username: 'me', ip: '1.2.3.4', metadata: { reason: 'bad_credentials' } });
    audit.record({ type: 'login_success', status: 'success', username: 'me', ip: '1.2.3.4' });

    const events = audit.list(10);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'login_success', status: 'success', username: 'me' });
    expect(events[1].metadata).toEqual({ reason: 'bad_credentials' });
  });

  it('keeps only the newest events once retention is exceeded', () => {
    const bounded = new AuditLog(db, 5);
    for (let index = 0; index < 150; index++) bounded.record({ type: `event_${index}`, status: 'info' });

    const events = bounded.list(500);
    expect(events.length).toBeLessThanOrEqual(5 + 99);
    expect(events[0].type).toBe('event_149');
    bounded.prune();
    expect(bounded.list(500).map((event) => event.type)).toEqual(['event_149', 'event_148', 'event_147', 'event_146', 'event_145']);
  });

  it('falls back to the default limit for invalid values', () => {
    audit.record({ type: 'login_success', status: 'success' });
    expect(audit.list(Number.NaN)).toHaveLength(1);
  });

  it('clears all audit events', () => {
    audit.record({ type: 'login_success', status: 'success' });

    audit.clear();

    expect(audit.list()).toEqual([]);
  });
});
