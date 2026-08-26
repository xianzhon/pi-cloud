import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import WebSocketClient from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempDir: string;
let dbPath: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-ws-auth-'));
  dbPath = path.join(tempDir, 'piui.sqlite');
  process.env.PI_WEBUI_AUTH_USERNAME = 'me';
  process.env.PI_WEBUI_AUTH_PASSWORD = 'secret';
  process.env.PI_WEBUI_AUTH_PASSWORD_HASH = '';
  process.env.PI_WEBUI_DB_PATH = dbPath;
});

afterEach(async () => {
  vi.resetModules();
  delete process.env.PI_WEBUI_AUTH_USERNAME;
  delete process.env.PI_WEBUI_AUTH_PASSWORD;
  delete process.env.PI_WEBUI_AUTH_PASSWORD_HASH;
  delete process.env.PI_WEBUI_DB_PATH;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('websocket authentication', () => {
  it('rejects authenticated chat websocket connections from untrusted browser origins', async () => {
    const { buildApp } = await import('../index');
    const app = await buildApp();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const message = await new Promise<string>((resolve) => {
      const ws = new WebSocketClient(`ws://127.0.0.1:${port}/ws/chat?clientId=test-client`, {
        headers: { cookie: cookieHeader, origin: 'https://evil.example' },
      });
      ws.on('message', (data) => resolve(String(data)));
      ws.on('close', () => resolve('closed-without-message'));
    });

    expect(message).toContain('Origin not allowed');
    await app.close();
  }, 10_000);

  it('rejects unauthenticated chat websocket connections and records a websocket audit event', async () => {
    const { buildApp } = await import('../index');
    const app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const message = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chat?clientId=test-client`);
      ws.addEventListener('message', (event) => resolve(String(event.data)));
      ws.addEventListener('close', () => resolve('closed-without-message'));
    });

    expect(message).toContain('Authentication required');
    await app.close();

    const db = new Database(dbPath);
    const events = db.prepare('SELECT type FROM audit_events ORDER BY id DESC').all() as Array<{ type: string }>;
    db.close();
    expect(events.map((event) => event.type)).toContain('websocket_auth_failure');
  }, 10_000);
});
