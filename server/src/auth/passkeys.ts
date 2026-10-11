import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import type { PiCloudDatabase } from '../db/database.js';

export const PASSKEY_CHALLENGE_SECONDS = 300;
const MAX_KEYS = 20;

interface PasskeyRow {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface PasskeyFlow {
  kind: 'register' | 'login';
  challenge: string;
  expires: number;
  sessionId?: string;
  name?: string;
}

export class PasskeyService {
  private readonly flows = new Map<string, PasskeyFlow>();
  private readonly rpId: string;

  constructor(private db: PiCloudDatabase, private username: string, private origin: string) {
    this.rpId = new URL(origin).hostname;
  }

  private rows(): PasskeyRow[] {
    return this.db.prepare('SELECT * FROM auth_passkeys WHERE username = ? AND rp_id = ?')
      .all(this.username, this.rpId) as PasskeyRow[];
  }

  list() {
    return this.rows().map(row => ({ id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
  }

  delete(id: string): boolean {
    return Boolean(this.db.prepare('DELETE FROM auth_passkeys WHERE id = ? AND username = ? AND rp_id = ?')
      .run(id, this.username, this.rpId).changes);
  }

  private userId(): string {
    const row = this.db.prepare('SELECT user_id FROM auth_passkey_users WHERE username = ? AND rp_id = ?')
      .get(this.username, this.rpId) as { user_id: string } | undefined;
    if (row) return row.user_id;
    const id = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO auth_passkey_users (username, rp_id, user_id) VALUES (?, ?, ?)')
      .run(this.username, this.rpId, id);
    return id;
  }

  private issue(flow: Omit<PasskeyFlow, 'expires'>, previousToken?: string): string {
    for (const [token, pending] of this.flows) {
      if (pending.expires <= Date.now()) this.flows.delete(token);
    }
    if (previousToken) this.flows.delete(previousToken);
    if (this.flows.size >= 1000) throw new Error('Too many pending passkey requests');
    const token = randomBytes(32).toString('hex');
    this.flows.set(token, { ...flow, expires: Date.now() + PASSKEY_CHALLENGE_SECONDS * 1000 });
    return token;
  }

  private consume(token: string | undefined, kind: PasskeyFlow['kind'], sessionId?: string): PasskeyFlow {
    const flow = token ? this.flows.get(token) : undefined;
    // Consume before verification awaits so failed or concurrent requests cannot reuse a challenge.
    if (token) this.flows.delete(token);
    if (!flow || flow.kind !== kind || flow.expires <= Date.now()
      || (kind === 'register' && flow.sessionId !== sessionId)) {
      throw new Error('Expired or invalid passkey challenge');
    }
    return flow;
  }

  async registrationOptions(sessionId: string, name: string, previousToken?: string) {
    if (this.rows().length >= MAX_KEYS) throw new Error('Maximum 20 passkeys');
    const options = await generateRegistrationOptions({
      rpName: 'Pi Cloud', rpID: this.rpId, userName: this.username,
      userID: Buffer.from(this.userId(), 'base64url'), attestationType: 'none',
      excludeCredentials: this.rows().map(row => ({ id: row.id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const token = this.issue({ kind: 'register', challenge: options.challenge, sessionId, name }, previousToken);
    return { options, token };
  }

  async loginOptions(previousToken?: string) {
    const options = await generateAuthenticationOptions({ rpID: this.rpId, userVerification: 'required' });
    return { options, token: this.issue({ kind: 'login', challenge: options.challenge }, previousToken) };
  }

  private expected(challenge: string) {
    return { expectedChallenge: challenge, expectedOrigin: this.origin, expectedRPID: this.rpId, requireUserVerification: true };
  }

  async register(token: string | undefined, sessionId: string, response: RegistrationResponseJSON) {
    const flow = this.consume(token, 'register', sessionId);
    const result = await verifyRegistrationResponse({ response, ...this.expected(flow.challenge) });
    if (!result.verified || !result.registrationInfo) throw new Error('Invalid registration');
    const now = new Date().toISOString();
    if (!this.db.prepare('SELECT id FROM sessions WHERE id = ? AND username = ? AND expires_at > ? AND absolute_expires_at > ?')
      .get(sessionId, this.username, now, now)) throw new Error('Registration session expired');
    if (this.rows().length >= MAX_KEYS) throw new Error('Maximum 20 passkeys');
    const credential = result.registrationInfo.credential;
    this.db.prepare(`INSERT INTO auth_passkeys
      (id, username, rp_id, public_key, counter, transports, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      credential.id, this.username, this.rpId, Buffer.from(credential.publicKey), credential.counter,
      JSON.stringify(credential.transports || []), flow.name, new Date().toISOString(),
    );
  }

  async authenticate(token: string | undefined, response: AuthenticationResponseJSON) {
    const flow = this.consume(token, 'login');
    const row = this.rows().find(candidate => candidate.id === response?.id);
    if (!row || response.response?.userHandle !== this.userId()) throw new Error('Unknown credential');
    const result = await verifyAuthenticationResponse({
      response, ...this.expected(flow.challenge),
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter,
        transports: JSON.parse(row.transports) as AuthenticatorTransport[] },
    });
    if (!result.verified) throw new Error('Invalid authentication');
    // Reject deletion or counter changes during verification without disallowing zero-counter synced keys.
    const updated = this.db.prepare(`UPDATE auth_passkeys SET counter = ?, last_used_at = ?
      WHERE id = ? AND username = ? AND rp_id = ? AND counter = ?`).run(
      result.authenticationInfo.newCounter, new Date().toISOString(), row.id, this.username, this.rpId, row.counter,
    );
    if (!updated.changes) throw new Error('Credential changed');
  }

  dispose() {
    this.flows.clear();
  }
}
