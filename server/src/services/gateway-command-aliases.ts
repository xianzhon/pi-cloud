const DEFAULT_COMMAND_PREFIX = '小助理';

export const GATEWAY_COMMON_ALIAS_HELP = [
  '支持的自然语言指令 / Natural-language instructions:',
  '默认以「小助理」开头；若设置了 PI_CLOUD_GATEWAY_COMMAND_PREFIX，请替换示例中的前缀。',
  '',
  '会话管理 / Session management:',
  '- 小助理，重新开一个对话',
  '- 小助理，查看当前对话状态',
  '- 小助理，有哪些命令？',
  '',
  '配置切换 / Configuration changes:',
  '- 小助理，把工作目录切到 <已配置的目录>',
  '- 小助理，切换到 <Profile 名称或 ID> 配置',
  '- 小助理，使用 <技能集名称> 技能集（或启用全部技能）',
  '',
  '任务管理 / Task management:',
  '- 小助理，添加任务：<任务描述>（仅保存待办，不自动执行）',
  '- 小助理，列出未开始的任务',
  '- 小助理，执行任务 <准确标题或 ID>（独立会话，不开启自动队列）',
  '',
  '每条指令只执行一个操作；不明确时不会执行，请重新发送带前缀的完整指令。',
  '配置目标须已存在且能唯一匹配；切换目录、Profile 或技能集会重置对话。',
  '任务操作仅限当前项目；启动须指定准确标题或 ID，重名时请使用 ID，不支持“第二个”等引用。',
];

export function stripGatewayCommandPrefix(text: string): string | undefined {
  const prefix = (process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX || DEFAULT_COMMAND_PREFIX).trim() || DEFAULT_COMMAND_PREFIX;
  if (!text.startsWith(prefix)) return undefined;

  return text.slice(prefix.length).replace(/^[\s:：,，]+/, '').trim();
}
