import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { generateSync } from 'otplib';
import { afterEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { AuditLog } from '../auth/audit';
import { IpRateLimiter } from '../auth/rate-limit';
import { SessionStore } from '../auth/sessions';
import { TotpService } from '../auth/totp';
import { authRoutes } from './auth';

async function buildApp(options?: { skip2faVerify?: boolean }) {
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-auth-routes-'));
  const db = openPiCloudDatabase(path.join(tempDir, 'pi-cloud.sqlite'));
  const sessions = new SessionStore(db, 'pi_cloud_session');
  const audit = new AuditLog(db);
  const totp = new TotpService(db, 'Pi Cloud', 'me');

  await app.register(cookie);
  await app.register(authRoutes, {
    prefix: '/api/auth',
    config: {
      username: 'me',
      password: 'secret',
      sessionTtlHours: 8,
      sessionMaxHours: 24 * 30,
      dbPath: path.join(tempDir, 'pi-cloud.sqlite'),
      trustProxy: false,
      skip2faVerify: options?.skip2faVerify ?? false,
      cookieSecure: false,
      cookieName: 'pi_cloud_session',
    },
    sessions,
    audit,
    totp,
    rateLimiter: new IpRateLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 }),
    db,
  });

  return { app, tempDir, db, totp };
}

describe('authRoutes', () => {
  let app: FastifyInstance | undefined;
  let tempDir: string | undefined;
  let db: PiCloudDatabase | undefined;
  let totp: TotpService | undefined;

  afterEach(async () => {
    await app?.close();
    db?.close();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    app = undefined;
    db = undefined;
    tempDir = undefined;
    totp = undefined;
  });

  it('logs in with username and password when 2FA is disabled', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'me', password: 'secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: true, requires2fa: false, user: { username: 'me', totpEnabled: false } });
    expect(response.json().sessionExpiresAt).toEqual(expect.any(String));
    expect(response.headers['set-cookie']).toContain('pi_cloud_session=');
  });

  it('does not mark session cookies secure by default so local HTTP production login persists', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'me', password: 'secret' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['set-cookie']).toContain('pi_cloud_session=');
      expect(response.headers['set-cookie']).not.toContain('Secure');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('returns a staged 2FA challenge when 2FA is enabled', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const setup = await totp!.createSetup();
    totp!.enable(setup.secret, generateSync({ secret: setup.secret }));

    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false, requires2fa: true });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('accepts totp code during login', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const setup = await totp!.createSetup();
    totp!.enable(setup.secret, generateSync({ secret: setup.secret }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'me', password: 'secret', totpCode: generateSync({ secret: setup.secret }) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authenticated).toBe(true);
    expect(response.headers['set-cookie']).toContain('pi_cloud_session=');
  });

  it('bypasses totp when SKIP_2FA_VERIFY is active', async () => {
    ({ app, tempDir, db, totp } = await buildApp({ skip2faVerify: true }));
    const setup = await totp!.createSetup();
    totp!.enable(setup.secret, generateSync({ secret: setup.secret }));

    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });

    expect(response.statusCode).toBe(200);
    expect(response.json().authenticated).toBe(true);
    const events = db!.prepare('SELECT type FROM audit_events ORDER BY id DESC').all() as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toContain('totp_bypassed');
  });

  it('returns authenticated me and logs out', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieHeader } });
    expect(me.json().authenticated).toBe(true);
    expect(me.json().sessionExpiresAt).toEqual(expect.any(String));

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookieHeader } });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieHeader } });
    expect(afterLogout.json().authenticated).toBe(false);
  });

  it('requires authentication for 2FA management, preferences, and audit logs', async () => {
    ({ app, tempDir, db, totp } = await buildApp());

    const setup = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup' });
    const disable = await app.inject({ method: 'POST', url: '/api/auth/2fa/disable' });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences' });
    const updatePreferences = await app.inject({ method: 'PATCH', url: '/api/auth/preferences', payload: { showHintInfo: false } });
    const audit = await app.inject({ method: 'GET', url: '/api/auth/audit' });

    expect(setup.statusCode).toBe(401);
    expect(disable.statusCode).toBe(401);
    expect(preferences.statusCode).toBe(401);
    expect(updatePreferences.statusCode).toBe(401);
    expect(audit.statusCode).toBe(401);
  });

  it('returns default preferences for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });

    expect(preferences.statusCode).toBe(200);
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
  });

  it('persists hint info preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { showHintInfo: false },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.showHintInfo') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: false, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: false, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('false');
  });

  it('persists the session delete confirmation preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { confirmSessionDelete: false },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.confirmSessionDelete') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json().confirmSessionDelete).toBe(false);
    expect(preferences.json().confirmSessionDelete).toBe(false);
    expect(row.value).toBe('false');
  });

  it('persists code block language header preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { showCodeBlockLanguageHeaders: false },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.showCodeBlockLanguageHeaders') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: false, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: false, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('false');
  });

  it('persists streaming message behavior preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { streamingMessageBehavior: 'followUp' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.streamingMessageBehavior') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'followUp', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'followUp', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('followUp');
  });

  it('persists new session shortcut preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { newSessionShortcut: 'ctrlAltN' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.newSessionShortcut') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlAltN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlAltN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('ctrlAltN');
  });

  it('persists fullscreen shortcut preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { fullscreenShortcut: 'ctrlShiftF' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.fullscreenShortcut') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'ctrlShiftF', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'ctrlShiftF', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('ctrlShiftF');
  });

  it('persists floating chat button preferences for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { showGoToTopButton: false, showChatViewOptionsButton: false, autoExtractMemory: false },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const goToTopRow = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.showGoToTopButton') as { value: string };
    const viewOptionsRow = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.showChatViewOptionsButton') as { value: string };
    const autoExtractRow = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('memory.autoExtract') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: false, showChatViewOptionsButton: false, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: false, showChatViewOptionsButton: false, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(goToTopRow.value).toBe('false');
    expect(viewOptionsRow.value).toBe('false');
    expect(autoExtractRow.value).toBe('false');
  });

  it('persists theme preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { theme: 'light' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.theme') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'light', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'light', language: 'en', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('light');
  });

  it('persists language preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { language: 'zh-CN' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.language') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'zh-CN', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'zh-CN', soundNotification: 'beep', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('zh-CN');
  });

  it('persists sound notification preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { soundNotification: 'chime' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.soundNotification') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'chime', gitCloneParentPath: '~/git/github' });
    expect(preferences.json()).toEqual({ showHintInfo: true, showCodeBlockLanguageHeaders: true, streamingMessageBehavior: 'steer', editorAutoRefresh: false, confirmSessionDelete: true, newSessionShortcut: 'ctrlMetaN', fullscreenShortcut: 'f11', showGoToTopButton: true, showChatViewOptionsButton: true, autoExtractMemory: false, theme: 'system', language: 'en', soundNotification: 'chime', gitCloneParentPath: '~/git/github' });
    expect(row.value).toBe('chime');
  });

  it('persists git clone parent path preference for authenticated users', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { gitCloneParentPath: '  ~/src  ' },
    });
    const preferences = await app.inject({ method: 'GET', url: '/api/auth/preferences', headers: { cookie: cookieHeader } });
    const row = db!.prepare('SELECT value FROM security_settings WHERE key = ?').get('ui.gitCloneParentPath') as { value: string };

    expect(update.statusCode).toBe(200);
    expect(update.json().gitCloneParentPath).toBe('~/src');
    expect(preferences.json().gitCloneParentPath).toBe('~/src');
    expect(row.value).toBe('~/src');
  });

  it('lists, creates, updates, and deletes skill presets for the authenticated user', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const initial = await app.inject({
      method: 'GET',
      url: '/api/auth/skill-presets',
      headers: { cookie: cookieHeader },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/auth/skill-presets',
      headers: { cookie: cookieHeader },
      payload: { name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] },
    });

    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ presets: [] });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toMatchObject({
      preset: {
        name: 'debug',
        mode: 'enabled',
        skills: ['systematic-debugging'],
      },
    });

    const createdPresetId = create.json().preset.id;
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/auth/skill-presets/${createdPresetId}`,
      headers: { cookie: cookieHeader },
      payload: { name: 'ui', mode: 'disabled', skills: ['frontend-design'] },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/auth/skill-presets',
      headers: { cookie: cookieHeader },
    });
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/auth/skill-presets/${createdPresetId}`,
      headers: { cookie: cookieHeader },
    });
    const afterDelete = await app.inject({
      method: 'GET',
      url: '/api/auth/skill-presets',
      headers: { cookie: cookieHeader },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      preset: {
        id: createdPresetId,
        name: 'ui',
        mode: 'disabled',
        skills: ['frontend-design'],
      },
    });
    expect(list.json()).toMatchObject({
      presets: [
        {
          id: createdPresetId,
          name: 'ui',
          mode: 'disabled',
          skills: ['frontend-design'],
        },
      ],
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toEqual({ success: true });
    expect(afterDelete.json()).toEqual({ presets: [] });
  });

  it('rejects invalid preference payloads', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0];

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: { cookie: cookieHeader },
      payload: { streamingMessageBehavior: 'later' },
    });

    expect(update.statusCode).toBe(400);
    expect(update.json()).toEqual({ error: 'streamingMessageBehavior must be steer or followUp' });
  });

  it('rate limits repeated failed login attempts by IP', async () => {
    ({ app, tempDir, db, totp } = await buildApp());
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'wrong' } });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'secret' } });
    expect(blocked.statusCode).toBe(429);
  });
});
