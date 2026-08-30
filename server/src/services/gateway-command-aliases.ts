const DEFAULT_COMMAND_PREFIX = '小助理';

const NEW_SESSION_PATTERNS = [
  /\b(?:create\s+(?:a\s+)?)?new\s+session\b/,
  /新.*对话/,
];

const STATUS_EXACT_ALIASES = [
  'status',
  'session',
  'session status',
  'show status',
  'show session',
];

const STATUS_PHRASE_ALIASES = [
  '当前状态',
  '当前目录',
  '当前对话',
  '当前配置',
  '查看状态',
  '看状态',
  '当前工作目录',
];

const HELP_ALIASES = [
  'help',
  '帮助',
  '命令列表',
];

export const GATEWAY_COMMON_ALIAS_HELP = [
  'Common aliases:',
  '- 小助理新建对话 | 新对话',
  '- 小助理当前对话 | 状态',
  '- 小助理帮助｜命令列表',
];

export function normalizeGatewayCommandText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('/')) return trimmed;

  const prefixedText = stripGatewayCommandPrefix(trimmed);
  if (prefixedText === undefined) return trimmed;
  if (!prefixedText || prefixedText.startsWith('/')) return prefixedText;

  const lowerText = prefixedText.toLowerCase();
  if (HELP_ALIASES.includes(lowerText)) return '/help';
  if (NEW_SESSION_PATTERNS.some((pattern) => pattern.test(lowerText))) return '/new';
  if (STATUS_EXACT_ALIASES.includes(lowerText) || STATUS_PHRASE_ALIASES.some((alias) => lowerText.includes(alias))) return '/status';

  return trimmed;
}

function stripGatewayCommandPrefix(text: string): string | undefined {
  const prefix = (process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX || DEFAULT_COMMAND_PREFIX).trim() || DEFAULT_COMMAND_PREFIX;
  if (!text.startsWith(prefix)) return undefined;

  const remaining = text.slice(prefix.length);
  return remaining.replace(/^[\s:：,，]+/, '').trim();
}
