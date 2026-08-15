import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from '../../bin/runtime-config.mjs';

describe('loadRuntimeConfig', () => {
  it('allows config loaded by the server to override defaults', async () => {
    const env = {};

    await loadRuntimeConfig({}, async () => {
      env.PORT ??= '3100';
      env.HOST ??= '0.0.0.0';
      return {};
    }, env);

    expect(env).toMatchObject({ PORT: '3100', HOST: '0.0.0.0' });
  });

  it('gives CLI options precedence over loaded config', async () => {
    const env = {};

    await loadRuntimeConfig({ port: '3200', hostname: 'localhost' }, async () => {
      env.PORT ??= '3100';
      env.HOST ??= '0.0.0.0';
      return {};
    }, env);

    expect(env).toMatchObject({ PORT: '3200', HOST: 'localhost' });
  });
});
