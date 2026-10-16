import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripGatewayCommandPrefix } from './gateway-command-aliases';

afterEach(() => vi.unstubAllEnvs());

describe('stripGatewayCommandPrefix', () => {
  it.each([
    ['小助理新建对话', '新建对话'],
    ['小助理：帮我换个项目', '帮我换个项目'],
    ['小助理 , 状态', '状态'],
    ['小助理', ''],
    ['普通对话', undefined],
    ['/status', undefined],
  ])('extracts only prefixed instructions from %s', (text, expected) => {
    expect(stripGatewayCommandPrefix(text)).toBe(expected);
  });
  it('uses the configured prefix and falls back for blank configuration', () => {
    vi.stubEnv('PI_CLOUD_GATEWAY_COMMAND_PREFIX', 'Pi');
    expect(stripGatewayCommandPrefix('Pi: show session')).toBe('show session');
    expect(stripGatewayCommandPrefix('小助理新建对话')).toBeUndefined();
    vi.stubEnv('PI_CLOUD_GATEWAY_COMMAND_PREFIX', '   ');
    expect(stripGatewayCommandPrefix('小助理新建对话')).toBe('新建对话');
  });
});
