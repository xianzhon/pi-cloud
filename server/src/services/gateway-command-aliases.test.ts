import { afterEach, describe, expect, it } from 'vitest';
import { normalizeGatewayCommandText } from './gateway-command-aliases';

const ORIGINAL_PREFIX = process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX;

afterEach(() => {
  if (ORIGINAL_PREFIX === undefined) {
    delete process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX;
  } else {
    process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX = ORIGINAL_PREFIX;
  }
});

describe('normalizeGatewayCommandText', () => {
  it.each([
    '小助理 new session',
    '小助理 create a new session',
    '小助理 新建对话',
    '小助理新对话',
    '小助理 帮我新开一个对话',
    '小助理 请新建一个对话',
    '小助理 重新创建对话',
  ])('maps %s to /new', (text) => {
    expect(normalizeGatewayCommandText(text)).toBe('/new');
  });

  it.each([
    '小助理 当前状态',
    '小助理 当前目录',
    '小助理 当前对话',
    '小助理当前对话',
    '小助理 status',
    '小助理 session',
    '小助理 show status',
    '小助理 show session',
  ])('maps %s to /status', (text) => {
    expect(normalizeGatewayCommandText(text)).toBe('/status');
  });

  it.each([
    '小助理 帮助',
    '小助理帮助',
    '小助理 help',
    '小助理 命令列表',
  ])('maps %s to /help', (text) => {
    expect(normalizeGatewayCommandText(text)).toBe('/help');
  });

  it('uses a configurable gateway command prefix', () => {
    process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX = 'Pi';

    expect(normalizeGatewayCommandText('Pi: show session')).toBe('/status');
    expect(normalizeGatewayCommandText('Pishow session')).toBe('/status');
    expect(normalizeGatewayCommandText('小助理 show session')).toBe('小助理 show session');
  });

  it('preserves slash commands and ordinary prompts', () => {
    expect(normalizeGatewayCommandText('/status')).toBe('/status');
    expect(normalizeGatewayCommandText('hello pi')).toBe('hello pi');
    expect(normalizeGatewayCommandText('explain HTTP status 500')).toBe('explain HTTP status 500');
    expect(normalizeGatewayCommandText('session')).toBe('session');
    expect(normalizeGatewayCommandText('小助理 explain HTTP status 500')).toBe('小助理 explain HTTP status 500');
  });
});
