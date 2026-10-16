import { describe, expect, it } from 'vitest';
import { openPiCloudDatabase } from '../db/database';
import { FeishuGatewayService } from './feishu-gateway';
import { WecomGatewayService } from './wecom-gateway';
import { WeixinGatewayService } from './weixin-gateway';
import type { PiSessionService } from './session-manager';

describe('gateway /help', () => {
  it.each([
    ['Feishu', FeishuGatewayService], ['WeCom', WecomGatewayService], ['WeChat', WeixinGatewayService],
  ] as const)('%s separates slash commands from all nine natural-language instructions', (_name, Gateway) => {
    const db = openPiCloudDatabase(':memory:');
    try {
      const gateway = new Gateway(db, undefined, {} as PiSessionService);
      const help = (gateway as unknown as { formatHelp(): string }).formatHelp();
      expect(help).toContain('/status');
      expect(help).toContain('/cwd');
      expect(help).toContain('支持的自然语言指令');
      for (const group of ['会话管理', '配置切换', '任务管理']) expect(help).toContain(group);
      for (const example of [
        '小助理，重新开一个对话', '小助理，查看当前对话状态', '小助理，有哪些命令',
        '小助理，把工作目录切到', '小助理，切换到', '小助理，使用',
        '小助理，添加任务', '小助理，列出未开始的任务', '小助理，执行任务',
      ]) expect(help).toContain(`\n- ${example}`);
      for (const rule of ['一个操作', '当前项目', '不自动执行', '标题或 ID', '重置对话', 'PI_CLOUD_GATEWAY_COMMAND_PREFIX']) expect(help).toContain(rule);
      expect(help).not.toContain(',,-');
      expect(help).not.toContain('/create_task');
    } finally {
      db.close();
    }
  });
});
