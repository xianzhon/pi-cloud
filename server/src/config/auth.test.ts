import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth';

describe('loadAuthConfig', () => {
  it('uses secure defaults for optional auth settings', () => {
    const config = loadAuthConfig({
      PI_CLOUD_AUTH_USERNAME: 'me',
      PI_CLOUD_AUTH_PASSWORD: 'secret',
      HOME: '/home/tester',
    } as NodeJS.ProcessEnv);

    expect(config.username).toBe('me');
    expect(config.password).toBe('secret');
    expect(config.passwordHash).toBeUndefined();
    expect(config.sessionTtlHours).toBe(8);
    expect(config.sessionMaxHours).toBe(720);
    expect(config.dbPath).toBe('/home/tester/.config/pi-cloud/pi-cloud.sqlite');
    expect(config.trustProxy).toBe(false);
    expect(config.skip2faVerify).toBe(false);
    expect(config.cookieSecure).toBe(false);
  });

  it('prefers password hash when both password and hash are set', () => {
    const config = loadAuthConfig({
      PI_CLOUD_AUTH_USERNAME: 'me',
      PI_CLOUD_AUTH_PASSWORD: 'plain',
      PI_CLOUD_AUTH_PASSWORD_HASH: '$scrypt$ln=15,r=8,p=3$abc$def',
    } as NodeJS.ProcessEnv);

    expect(config.passwordHash).toBe('$scrypt$ln=15,r=8,p=3$abc$def');
    expect(config.password).toBe('plain');
  });

  it('parses booleans and numeric values', () => {
    const config = loadAuthConfig({
      PI_CLOUD_AUTH_USERNAME: 'me',
      PI_CLOUD_AUTH_PASSWORD: 'secret',
      PI_CLOUD_SESSION_TTL_HOURS: '12',
      PI_CLOUD_SESSION_MAX_HOURS: '1000',
      PI_CLOUD_DB_PATH: '/tmp/pi-cloud.sqlite',
      PI_CLOUD_TRUST_PROXY: 'true',
      SKIP_2FA_VERIFY: 'true',
      PI_CLOUD_COOKIE_SECURE: 'true',
    } as NodeJS.ProcessEnv);

    expect(config.sessionTtlHours).toBe(12);
    expect(config.sessionMaxHours).toBe(1000);
    expect(config.dbPath).toBe('/tmp/pi-cloud.sqlite');
    expect(config.trustProxy).toBe(true);
    expect(config.skip2faVerify).toBe(true);
    expect(config.cookieSecure).toBe(true);
  });

  it('throws if username is missing', () => {
    expect(() => loadAuthConfig({ PI_CLOUD_AUTH_PASSWORD: 'secret' } as NodeJS.ProcessEnv)).toThrow('PI_CLOUD_AUTH_USERNAME is required');
  });

  it('throws if both password and password hash are missing', () => {
    expect(() => loadAuthConfig({ PI_CLOUD_AUTH_USERNAME: 'me' } as NodeJS.ProcessEnv)).toThrow(
      'PI_CLOUD_AUTH_PASSWORD_HASH or PI_CLOUD_AUTH_PASSWORD is required'
    );
  });

  it('throws for invalid session TTL', () => {
    expect(() => loadAuthConfig({
      PI_CLOUD_AUTH_USERNAME: 'me',
      PI_CLOUD_AUTH_PASSWORD: 'secret',
      PI_CLOUD_SESSION_TTL_HOURS: '0',
    } as NodeJS.ProcessEnv)).toThrow('PI_CLOUD_SESSION_TTL_HOURS must be a positive number');
  });
});
