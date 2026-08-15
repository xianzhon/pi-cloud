import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth';

describe('loadAuthConfig', () => {
  it('uses secure defaults for optional auth settings', () => {
    const config = loadAuthConfig({
      PI_WEBUI_AUTH_USERNAME: 'me',
      PI_WEBUI_AUTH_PASSWORD: 'secret',
      HOME: '/home/tester',
    } as NodeJS.ProcessEnv);

    expect(config.username).toBe('me');
    expect(config.password).toBe('secret');
    expect(config.passwordHash).toBeUndefined();
    expect(config.sessionTtlHours).toBe(8);
    expect(config.sessionMaxHours).toBe(720);
    expect(config.dbPath).toBe('/home/tester/.config/pi-webui/pi-webui.sqlite');
    expect(config.trustProxy).toBe(false);
    expect(config.skip2faVerify).toBe(false);
    expect(config.cookieSecure).toBe(false);
  });

  it('prefers password hash when both password and hash are set', () => {
    const config = loadAuthConfig({
      PI_WEBUI_AUTH_USERNAME: 'me',
      PI_WEBUI_AUTH_PASSWORD: 'plain',
      PI_WEBUI_AUTH_PASSWORD_HASH: '$scrypt$ln=15,r=8,p=3$abc$def',
    } as NodeJS.ProcessEnv);

    expect(config.passwordHash).toBe('$scrypt$ln=15,r=8,p=3$abc$def');
    expect(config.password).toBe('plain');
  });

  it('parses booleans and numeric values', () => {
    const config = loadAuthConfig({
      PI_WEBUI_AUTH_USERNAME: 'me',
      PI_WEBUI_AUTH_PASSWORD: 'secret',
      PI_WEBUI_SESSION_TTL_HOURS: '12',
      PI_WEBUI_SESSION_MAX_HOURS: '1000',
      PI_WEBUI_DB_PATH: '/tmp/piui.sqlite',
      PI_WEBUI_TRUST_PROXY: 'true',
      SKIP_2FA_VERIFY: 'true',
      PI_WEBUI_COOKIE_SECURE: 'true',
    } as NodeJS.ProcessEnv);

    expect(config.sessionTtlHours).toBe(12);
    expect(config.sessionMaxHours).toBe(1000);
    expect(config.dbPath).toBe('/tmp/piui.sqlite');
    expect(config.trustProxy).toBe(true);
    expect(config.skip2faVerify).toBe(true);
    expect(config.cookieSecure).toBe(true);
  });

  it('throws if username is missing', () => {
    expect(() => loadAuthConfig({ PI_WEBUI_AUTH_PASSWORD: 'secret' } as NodeJS.ProcessEnv)).toThrow('PI_WEBUI_AUTH_USERNAME is required');
  });

  it('throws if both password and password hash are missing', () => {
    expect(() => loadAuthConfig({ PI_WEBUI_AUTH_USERNAME: 'me' } as NodeJS.ProcessEnv)).toThrow(
      'PI_WEBUI_AUTH_PASSWORD_HASH or PI_WEBUI_AUTH_PASSWORD is required'
    );
  });

  it('throws for invalid session TTL', () => {
    expect(() => loadAuthConfig({
      PI_WEBUI_AUTH_USERNAME: 'me',
      PI_WEBUI_AUTH_PASSWORD: 'secret',
      PI_WEBUI_SESSION_TTL_HOURS: '0',
    } as NodeJS.ProcessEnv)).toThrow('PI_WEBUI_SESSION_TTL_HOURS must be a positive number');
  });
});
