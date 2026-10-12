import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';
import type { PiCloudDatabase } from '../db/database';
import { credentialCipher, type CredentialCipher } from '../db/credential-encryption.js';

export class TotpService {
  private readonly credentials: CredentialCipher;

  constructor(private db: PiCloudDatabase, private issuer: string, private username: string) {
    this.credentials = credentialCipher(db);
  }

  getStatus(): { enabled: boolean } {
    return { enabled: this.getValue('totp.enabled') === 'true' };
  }

  async createSetup(): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: this.issuer, label: this.username, secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  enable(secret: string, code: string): boolean {
    const valid = verifySync({ token: code, secret }).valid;
    if (!valid) return false;

    this.setValue('totp.secret', this.credentials.encrypt(secret));
    this.setValue('totp.enabled', 'true');
    this.deleteValue('totp.lastTimeStep');
    return true;
  }

  verify(code: string): boolean {
    if (!this.getStatus().enabled) return true;
    const storedSecret = this.getValue('totp.secret');
    if (!storedSecret) return false;
    const result = verifySync({ token: code, secret: this.credentials.decrypt(storedSecret) });
    if (!result.valid) return false;
    // Each time step may be used once, so an observed code cannot be replayed within its window.
    const timeStep = ('timeStep' in result ? result.timeStep : Math.floor(Date.now() / 30_000)) + (result.delta ?? 0);
    if (timeStep <= Number(this.getValue('totp.lastTimeStep') || '-1')) return false;
    this.setValue('totp.lastTimeStep', String(timeStep));
    return true;
  }

  disable(): void {
    this.setValue('totp.enabled', 'false');
    this.deleteValue('totp.secret');
    this.deleteValue('totp.lastTimeStep');
  }

  private getValue(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM application_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setValue(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO application_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  private deleteValue(key: string): void {
    this.db.prepare('DELETE FROM application_settings WHERE key = ?').run(key);
  }
}
