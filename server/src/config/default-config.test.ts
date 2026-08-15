import { describe, expect, it } from 'vitest';
import { renderDefaultConfig } from './default-config.js';

describe('renderDefaultConfig', () => {
  it('preserves the sample configuration while replacing login credentials', () => {
    const sample = [
      'HOST=127.0.0.1',
      'PI_WEBUI_AUTH_USERNAME=yourname',
      'PI_WEBUI_AUTH_PASSWORD=change-me',
      '# PI_WEBUI_AUTH_PASSWORD_HASH=hash-placeholder',
      'PI_WEBUI_COOKIE_SECURE=false',
      '',
    ].join('\n');

    expect(renderDefaultConfig(sample, 'admin', 'random-password')).toBe([
      'HOST=127.0.0.1',
      'PI_WEBUI_AUTH_USERNAME=admin',
      'PI_WEBUI_AUTH_PASSWORD=random-password',
      '# PI_WEBUI_AUTH_PASSWORD_HASH=hash-placeholder',
      'PI_WEBUI_COOKIE_SECURE=false',
      '',
    ].join('\n'));
  });
});
