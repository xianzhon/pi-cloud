import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { generateSync, verifySync } from 'otplib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { TotpService } from './totp';

describe('TotpService', () => {
  let tempDir: string;
  let db: PiCloudDatabase;
  let totp: TotpService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-totp-'));
    db = openPiCloudDatabase(path.join(tempDir, 'pi-cloud.sqlite'));
    totp = new TotpService(db, 'Pi Cloud', 'me');
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('starts disabled', () => {
    expect(totp.getStatus()).toEqual({ enabled: false });
  });

  it('creates setup data without enabling until verified', async () => {
    const setup = await totp.createSetup();
    expect(setup.secret).toBeTruthy();
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.qrCodeDataUrl).toContain('data:image/png;base64,');
    expect(totp.getStatus()).toEqual({ enabled: false });
  });

  it('enables, verifies, and disables totp', async () => {
    const setup = await totp.createSetup();
    const code = generateSync({ secret: setup.secret });

    expect(totp.enable(setup.secret, code)).toBe(true);
    expect(totp.getStatus()).toEqual({ enabled: true });
    expect(totp.verify(code)).toBe(true);
    expect(verifySync({ token: code, secret: setup.secret }).valid).toBe(true);

    totp.disable();
    expect(totp.getStatus()).toEqual({ enabled: false });
  });
});
