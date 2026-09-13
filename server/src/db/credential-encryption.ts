import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PiCloudDatabase } from './database.js';

const PREFIX = 'enc:v1:';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const CREDENTIAL_CIPHER = Symbol('credentialCipher');

type DatabaseWithCredentialCipher = PiCloudDatabase & { [CREDENTIAL_CIPHER]?: CredentialCipher };

export class CredentialCipher {
  constructor(private readonly key: Buffer) {}

  encrypt(value: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${nonce.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) return value;
    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted credential');
    try {
      const [nonce, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
      if (nonce.length !== NONCE_BYTES || tag.length !== 16) throw new Error('invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt stored credential; verify the Pi Cloud credential encryption key');
    }
  }

  decryptOrDefault(value: string | null | undefined, defaultValue = ''): string {
    return value ? this.decrypt(value) : defaultValue;
  }
}

export function initializeCredentialEncryption(db: PiCloudDatabase, dbPath: string): void {
  const cipher = new CredentialCipher(loadKey(dbPath));
  Object.defineProperty(db, CREDENTIAL_CIPHER, { value: cipher });
  migratePlaintextCredentials(db, cipher);
}

export function credentialCipher(db: PiCloudDatabase): CredentialCipher {
  const cipher = (db as DatabaseWithCredentialCipher)[CREDENTIAL_CIPHER];
  if (!cipher) throw new Error('Credential encryption is not initialized for this database');
  return cipher;
}

export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(PREFIX);
}

function loadKey(dbPath: string): Buffer {
  const configured = process.env.PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (configured) return decodeKey(configured, 'PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY');
  if (dbPath === ':memory:') return randomBytes(KEY_BYTES);

  const keyPath = `${dbPath}.credentials.key`;
  try {
    const key = decodeKey(fs.readFileSync(keyPath, 'utf8').trim(), keyPath);
    if (process.platform !== 'win32') fs.chmodSync(keyPath, 0o600);
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const key = randomBytes(KEY_BYTES);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(keyPath, `${key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (process.platform !== 'win32') fs.chmodSync(keyPath, 0o600);
    return decodeKey(fs.readFileSync(keyPath, 'utf8').trim(), keyPath);
  }
}

function decodeKey(value: string, source: string): Buffer {
  const key = Buffer.from(value, 'base64');
  // Reject malformed or non-canonical base64 while allowing optional trailing padding.
  if (key.length !== KEY_BYTES || key.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new Error(`${source} must be a base64-encoded 32-byte key`);
  }
  return key;
}

function migrateCredential(cipher: CredentialCipher, value: string): { value: string; changed: boolean } {
  if (isEncryptedCredential(value)) {
    cipher.decrypt(value);
    return { value, changed: false };
  }
  return { value: cipher.encrypt(value), changed: true };
}

function migratePlaintextCredentials(db: PiCloudDatabase, cipher: CredentialCipher): void {
  let changed = false;
  db.pragma('secure_delete = ON');
  db.transaction(() => {
    const settings = db.prepare(`
      SELECT key, value FROM application_settings
      WHERE key IN ('totp.secret', 'github.token', 'gitea.token')
    `).all() as Array<{ key: string; value: string }>;
    const updateSetting = db.prepare('UPDATE application_settings SET value = ?, updated_at = ? WHERE key = ?');
    for (const row of settings) {
      const migrated = migrateCredential(cipher, row.value);
      if (!migrated.changed) continue;
      updateSetting.run(migrated.value, new Date().toISOString(), row.key);
      changed = true;
    }

    const wecom = db.prepare(`
      SELECT corp_secret, callback_token, encoding_aes_key FROM wecom_gateway_credentials WHERE id = 1
    `).get() as { corp_secret: string; callback_token: string; encoding_aes_key: string } | undefined;
    if (wecom) {
      const migrated = [wecom.corp_secret, wecom.callback_token, wecom.encoding_aes_key]
        .map((value) => migrateCredential(cipher, value));
      if (migrated.some((value) => value.changed)) {
        db.prepare(`UPDATE wecom_gateway_credentials SET corp_secret = ?, callback_token = ?, encoding_aes_key = ?, updated_at = ? WHERE id = 1`)
          .run(...migrated.map((value) => value.value), new Date().toISOString());
        changed = true;
      }
    }

    const weixin = db.prepare('SELECT token FROM weixin_gateway_credentials WHERE id = 1').get() as { token: string } | undefined;
    if (weixin) {
      const migrated = migrateCredential(cipher, weixin.token);
      if (migrated.changed) {
        db.prepare('UPDATE weixin_gateway_credentials SET token = ?, updated_at = ? WHERE id = 1')
          .run(migrated.value, new Date().toISOString());
        changed = true;
      }
    }

    const contexts = db.prepare('SELECT account_id, peer_id, context_token FROM weixin_gateway_context_tokens').all() as Array<{ account_id: string; peer_id: string; context_token: string }>;
    const updateContext = db.prepare('UPDATE weixin_gateway_context_tokens SET context_token = ?, updated_at = ? WHERE account_id = ? AND peer_id = ?');
    for (const row of contexts) {
      const migrated = migrateCredential(cipher, row.context_token);
      if (!migrated.changed) continue;
      updateContext.run(migrated.value, new Date().toISOString(), row.account_id, row.peer_id);
      changed = true;
    }

    const channels = db.prepare("SELECT id, config_json FROM notification_channels WHERE type = 'wecom'").all() as Array<{ id: string; config_json: string }>;
    const updateChannel = db.prepare('UPDATE notification_channels SET config_json = ?, updated_at = ? WHERE id = ?');
    for (const row of channels) {
      let config: { botKey?: string };
      try { config = JSON.parse(row.config_json) as { botKey?: string }; } catch { continue; }
      if (!config.botKey) continue;
      const migrated = migrateCredential(cipher, config.botKey);
      if (!migrated.changed) continue;
      updateChannel.run(JSON.stringify({ ...config, botKey: migrated.value }), new Date().toISOString(), row.id);
      changed = true;
    }
  })();

  if (changed && db.name !== ':memory:') {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
}
