import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../config/auth.js';
import type { PiCloudDatabase } from '../db/database.js';
import { credentialCipher } from '../db/credential-encryption.js';

export interface ApiTokenMetadata {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

const METADATA = 'id, name, prefix, created_at AS createdAt, expires_at AS expiresAt, last_used_at AS lastUsedAt';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const ALLOWED_ROUTES = new Set([
  'GET /api/integration/profiles',
  'GET /api/integration/profiles/:profileId/models',
  'POST /api/integration/sessions',
  'GET /api/integration/sessions/:id',
  'POST /api/integration/sessions/:id/messages',
]);

export class ApiTokenStore {
  private readonly fingerprint: string;

  constructor(private db: PiCloudDatabase, private config: AuthConfig) {
    // An encrypted random HMAC key avoids turning token rows into password verifiers.
    const cipher = credentialCipher(db);
    const row = db.prepare("SELECT value FROM application_settings WHERE key = 'auth.apiTokenKey'").get() as { value: string } | undefined;
    const key = row ? cipher.decrypt(row.value) : randomBytes(32).toString('hex');
    if (!row) {
      db.prepare('INSERT INTO application_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run('auth.apiTokenKey', cipher.encrypt(key), new Date().toISOString());
    }
    this.fingerprint = createHmac('sha256', key)
      .update(JSON.stringify([config.username, config.passwordHash || config.password, config.skip2faVerify])).digest('hex');
    db.prepare('DELETE FROM auth_api_tokens WHERE fingerprint != ?').run(this.fingerprint);
  }

  list(): ApiTokenMetadata[] {
    return this.db.prepare(`SELECT ${METADATA} FROM auth_api_tokens WHERE username = ? ORDER BY created_at DESC`)
      .all(this.config.username) as ApiTokenMetadata[];
  }

  create(name: string, expiresAt: string): ApiTokenMetadata & { token: string } {
    const token = `pic_pat_${randomBytes(32).toString('hex')}`;
    const metadata: ApiTokenMetadata = {
      id: randomUUID(), name, prefix: token.slice(0, 16), createdAt: new Date().toISOString(),
      expiresAt, lastUsedAt: null,
    };
    this.db.prepare(`INSERT INTO auth_api_tokens
      (id, token_hash, name, prefix, username, fingerprint, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(metadata.id, hash(token), name, metadata.prefix, this.config.username, this.fingerprint, metadata.createdAt, expiresAt);
    return { ...metadata, token };
  }

  revoke(id: string): boolean {
    return this.db.prepare('DELETE FROM auth_api_tokens WHERE id = ? AND username = ?').run(id, this.config.username).changes > 0;
  }

  validate(authorization: string): ApiTokenMetadata | null {
    const match = /^Bearer (pic_pat_[a-f0-9]{64})$/i.exec(authorization);
    if (!match) return null;
    const record = this.db.prepare(`SELECT ${METADATA} FROM auth_api_tokens
      WHERE token_hash = ? AND username = ? AND fingerprint = ?`)
      .get(hash(match[1]), this.config.username, this.fingerprint) as ApiTokenMetadata | undefined;
    return record && Date.parse(record.expiresAt) > Date.now() ? record : null;
  }

  // Authorization headers always take precedence over browser cookies, even on auth routes.
  authorizeRequest(req: FastifyRequest, reply: FastifyReply): boolean {
    const record = this.validate(req.headers.authorization || '');
    if (!record) {
      reply.header('WWW-Authenticate', 'Bearer').status(401).send({ error: 'Invalid or expired API token' });
      return false;
    }
    if (!ALLOWED_ROUTES.has(`${req.method} ${req.routeOptions.url}`)) {
      reply.status(403).send({ error: 'API token does not permit this operation' });
      return false;
    }
    this.db.prepare('UPDATE auth_api_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), record.id);
    return true;
  }
}
