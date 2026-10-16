const DEFAULT_COMMAND_PREFIX = '小助理';

export const GATEWAY_CONTROL_HELP = [
  '/stop or /abort - 请求停止当前对话并取消排队消息，保留历史；不停止独立任务',
  '/status - show execution state, elapsed time, pending messages and configuration',
  '/task list - 列出当前项目所有任务及状态',
  '/task status <编号或标题> - 查看任务及执行状态',
  '/task result <编号或标题> - 返回最新助手文本（长内容截断）',
  '/task stop <编号或标题> - 请求停止网关启动的任务，不标记为完成',
  '以上控制命令不排队；编号来自本聊天最近一次任务列表。停止是协作式请求，不保证外部工具立即终止。',
  '',
];

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
  '- 小助理，执行任务 <完整或部分任务标题>（独立会话，不开启自动队列）',
  '- 小助理，开启第 2 个任务（使用本聊天最近一次列出的任务编号）',
  '- 小助理，查看任务 <标题或编号> 的状态',
  '- 小助理，查看任务 <标题或编号> 的结果',
  '- 小助理，停止任务 <标题或编号>',
  '自然语言指令仍会排队；执行中请直接使用 /status、/stop 或 /task 命令。',
  '',
  '每条指令只执行一个操作；不明确时不会执行，请重新发送带前缀的完整指令。',
  '配置目标须已存在且能唯一匹配；切换目录、Profile 或技能集会重置对话。',
  '任务操作仅限当前项目；先列出任务，再按编号开启，也可使用完整或部分标题（须唯一匹配）。',
  '编号对应本聊天最近一次任务列表；服务重启后请重新列出任务。',
];

export function stripGatewayCommandPrefix(text: string): string | undefined {
  const prefix = (process.env.PI_CLOUD_GATEWAY_COMMAND_PREFIX || DEFAULT_COMMAND_PREFIX).trim() || DEFAULT_COMMAND_PREFIX;
  if (!text.startsWith(prefix)) return undefined;

  return text.slice(prefix.length).replace(/^[\s:：,，]+/, '').trim();
}
