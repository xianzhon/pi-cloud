import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database';
import { AuditLog } from './audit';

describe('AuditLog', () => {
  let tempDir: string;
  let db: PiuiDatabase;
  let audit: AuditLog;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-audit-'));
    db = openPiuiDatabase(path.join(tempDir, 'piui.sqlite'));
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

  it('clears all audit events', () => {
    audit.record({ type: 'login_success', status: 'success' });

    audit.clear();

    expect(audit.list()).toEqual([]);
  });
});
