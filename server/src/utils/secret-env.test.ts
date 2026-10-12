import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  delete process.env.PI_CLOUD_AUTH_PASSWORD;
  delete process.env.PI_CLOUD_FEISHU_APP_SECRET;
});

describe('secret environment isolation', () => {
  it('removes secrets from the inherited environment while keeping them readable', async () => {
    const { isolateSecretEnv, secretEnv } = await import('./secret-env');
    process.env.PI_CLOUD_AUTH_PASSWORD = 'password';
    process.env.PI_CLOUD_FEISHU_APP_SECRET = 'feishu-secret';
    process.env.PI_CLOUD_AUTH_USERNAME_TEST = 'kept';

    isolateSecretEnv();

    expect(process.env.PI_CLOUD_AUTH_PASSWORD).toBeUndefined();
    expect(process.env.PI_CLOUD_FEISHU_APP_SECRET).toBeUndefined();
    expect(process.env.PI_CLOUD_AUTH_USERNAME_TEST).toBe('kept');
    expect(secretEnv('PI_CLOUD_FEISHU_APP_SECRET')).toBe('feishu-secret');
    delete process.env.PI_CLOUD_AUTH_USERNAME_TEST;
  });

  it('prefers a value set in the environment after isolation', async () => {
    const { isolateSecretEnv, secretEnv } = await import('./secret-env');
    process.env.PI_CLOUD_FEISHU_APP_SECRET = 'old';
    isolateSecretEnv();
    process.env.PI_CLOUD_FEISHU_APP_SECRET = 'new';
    expect(secretEnv('PI_CLOUD_FEISHU_APP_SECRET')).toBe('new');
  });
});
