import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { ApiTokenStore } from './api-tokens.js';
import { loadAuthConfig } from '../config/auth.js';

const config = loadAuthConfig({ PI_CLOUD_AUTH_USERNAME: 'me', PI_CLOUD_AUTH_PASSWORD: 'secret', PI_CLOUD_DB_PATH: ':memory:' });
let db: PiCloudDatabase;
afterEach(() => db?.close());

function setup() {
  db = openPiCloudDatabase(':memory:');
  return new ApiTokenStore(db, config);
}

describe('API tokens', () => {
  it('stores only a hash and lists metadata without the secret', () => {
    const store = setup();
    const created = store.create('notes', new Date(Date.now() + 60_000).toISOString());
    expect(created.token).toMatch(/^pic_pat_[a-f0-9]{64}$/);
    expect(store.validate(`Bearer ${created.token}`)?.id).toBe(created.id);
    expect(store.list()[0]).not.toHaveProperty('token');
    const row = db.prepare('SELECT * FROM auth_api_tokens').get();
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(store.validate(created.token)).toBeNull();
  });

  it('rejects expired, revoked, malformed and changed-account credentials', () => {
    const store = setup();
    const expired = store.create('expired', new Date(Date.now() - 1000).toISOString());
    expect(store.validate(`Bearer ${expired.token}`)).toBeNull();
    const created = store.create('notes', new Date(Date.now() + 60_000).toISOString());
    expect(store.validate(`Basic ${created.token}`)).toBeNull();
    expect(store.validate(`Bearer ${created.token} garbage`)).toBeNull();
    expect(store.revoke(created.id)).toBe(true);
    expect(store.validate(`Bearer ${created.token}`)).toBeNull();
    const second = store.create('second', new Date(Date.now() + 60_000).toISOString());
    const restarted = new ApiTokenStore(db, config);
    expect(restarted.validate(`Bearer ${second.token}`)).not.toBeNull();
    const changed = new ApiTokenStore(db, { ...config, password: 'different' });
    expect(changed.validate(`Bearer ${second.token}`)).toBeNull();
  });

  it('permits only matched integration routes, including encoded URLs', async () => {
    const store = setup();
    const created = store.create('notes', new Date(Date.now() + 60_000).toISOString());
    const app = Fastify();
    app.addHook('onRequest', async (req, reply) => { store.authorizeRequest(req, reply); });
    app.get('/api/integration/profiles', async () => ({ profiles: [] }));
    app.post('/api/integration/sessions/:id/messages', async () => ({ answer: 'yes' }));
    app.get('/api/auth/tokens', async () => ({ secret: true }));
    app.get('/api/files/read', async () => ({ secret: true }));
    const headers = { authorization: `Bearer ${created.token}`, cookie: 'pi_cloud_session=irrelevant' };
    for (const url of ['/api/integration/profiles', '/%61pi/integration/profiles']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/api/integration/sessions/s1/messages', headers })).statusCode).toBe(200);
    for (const url of ['/api/auth/tokens', '/%61pi/auth/tokens', '/api/files/read', '/api/integration/unknown']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(403);
    }
    expect(store.list()[0].lastUsedAt).not.toBeNull();
    store.revoke(created.id);
    const revoked = await app.inject({ url: '/api/integration/profiles', headers });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.headers['www-authenticate']).toBe('Bearer');
    await app.close();
  });
});
