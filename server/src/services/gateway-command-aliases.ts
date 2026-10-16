const DEFAULT_COMMAND_PREFIX = '小助理';

export const GATEWAY_COMMON_ALIAS_HELP = [
  'Common aliases:',
  '- 小助理新建对话 | 新对话',
  '- 小助理当前对话 | 状态',
  '- 小助理帮助｜命令列表',
  'Prefix natural-language instructions with 小助理 (or PI_CLOUD_GATEWAY_COMMAND_PREFIX).',
  'AI interprets one management action per message; ambiguous requests require a complete, prefixed instruction again.',
];

export function stripGatewayCommandPrefix(text: string): string | undefined {
  const prefix = (process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX || DEFAULT_COMMAND_PREFIX).trim() || DEFAULT_COMMAND_PREFIX;
  if (!text.startsWith(prefix)) return undefined;

  return text.slice(prefix.length).replace(/^[\s:：,，]+/, '').trim();
}
