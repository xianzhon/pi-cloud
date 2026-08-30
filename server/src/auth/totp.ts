import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';
import type { PiCloudDatabase } from '../db/database';

export class TotpService {
  constructor(private db: PiCloudDatabase, private issuer: string, private username: string) {}

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

    this.setValue('totp.secret', secret);
    this.setValue('totp.enabled', 'true');
    return true;
  }

  verify(code: string): boolean {
    if (!this.getStatus().enabled) return true;
    const secret = this.getValue('totp.secret');
    if (!secret) return false;
    return verifySync({ token: code, secret }).valid;
  }

  disable(): void {
    this.setValue('totp.enabled', 'false');
    this.deleteValue('totp.secret');
  }

  private getValue(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM security_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setValue(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO security_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  private deleteValue(key: string): void {
    this.db.prepare('DELETE FROM security_settings WHERE key = ?').run(key);
  }
}
