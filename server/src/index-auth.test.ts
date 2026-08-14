import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempDir: string;
let tempDbPath: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-index-auth-'));
  tempDbPath = path.join(tempDir, 'piui.sqlite');
  process.env.PI_WEBUI_AUTH_USERNAME = 'me';
  process.env.PI_WEBUI_AUTH_PASSWORD = 'secret';
  process.env.PI_WEBUI_AUTH_PASSWORD_HASH = '';
  process.env.PI_WEBUI_DB_PATH = tempDbPath;
});

afterEach(async () => {
  vi.resetModules();
  delete process.env.PI_WEBUI_AUTH_USERNAME;
  delete process.env.PI_WEBUI_AUTH_PASSWORD;
  delete process.env.PI_WEBUI_AUTH_PASSWORD_HASH;
  delete process.env.PI_WEBUI_DB_PATH;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('buildApp auth protection', () => {
  it('allows health and blocks file API without a session', async () => {
    const { buildApp } = await import('./index');
    const app = await buildApp();

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['referrer-policy']).toBe('no-referrer');
    expect(health.headers['permissions-policy']).toContain('camera=()');

    const files = await app.inject({ method: 'GET', url: '/api/files/tree?path=.&depth=1' });
    expect(files.statusCode).toBe(401);

    const fileSearch = await app.inject({ method: 'GET', url: '/api/files/search?pattern=**/*.ts&path=.' });
    expect(fileSearch.statusCode).toBe(401);

    const memories = await app.inject({
      method: 'GET',
      url: '/api/memories/counts?clientId=client-1&projectPath=%2Fworkspace',
    });
    expect(memories.statusCode).toBe(401);

    const tasks = await app.inject({ method: 'GET', url: '/api/tasks?scope=all&status=waiting' });
    expect(tasks.statusCode).toBe(401);
    expect(tasks.json()).toEqual({ error: 'Authentication required' });


    await app.close();
  });

  it('allows protected API after login', async () => {
    const { buildApp } = await import('./index');
    const app = await buildApp();

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const sessions = await app.inject({ method: 'GET', url: '/api/sessions', headers: { cookie: cookieHeader } });
    expect(sessions.statusCode).toBe(200);

    const memories = await app.inject({
      method: 'GET',
      url: '/api/memories/counts?clientId=client-1&projectPath=%2Fworkspace',
      headers: { cookie: cookieHeader },
    });
    expect(memories.statusCode).toBe(200);

    await app.close();
  });

  it('rejects mutating HTTP requests from a different origin', async () => {
    const { buildApp } = await import('./index');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example', host: 'localhost:3000' },
      payload: { username: 'me', password: 'secret' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Origin not allowed' });

    await app.close();
  });

  it('serves the SPA shell for client-side session routes on refresh', async () => {
    const { buildApp } = await import('./index');
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/sessions/019e90de-b6cc-70d4-a7c8-c4114423fa6b' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="app"></div>');

    await app.close();
  });
});
