import { describe, expect, it } from 'vitest';
import en from './en';
import zhCN from './zh-CN';

function flattenLocale(locale: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(locale).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null
      ? Object.entries(flattenLocale(value as Record<string, unknown>, path))
      : [[path, String(value)]];
  }));
}

describe('Simplified Chinese locale', () => {
  const english = flattenLocale(en);
  const chinese = flattenLocale(zhCN);

  it('has exactly the same keys as the English locale', () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
  });

  it('uses the approved settings menu names consistently', () => {
    const sections = zhCN.settings.sections;
    expect(sections).toMatchObject({
      general: '通用', security: '账户安全', chat: '聊天', prompts: '常用指令',
      keyboard: '快捷键', skills: '技能组合', sharedSkills: '共享技能',
      git: '代码托管', gateway: '微信连接', reviewSources: '外部会话',
      modelWindowKickoff: '定时请求',
    });
    for (const [menu, heading] of [
      ['security', 'securityHeading'], ['chat', 'chatHeading'],
      ['prompts', 'promptsHeading'], ['keyboard', 'keyboardHeading'],
      ['skills', 'skillsHeading'], ['git', 'gitHeading'],
    ] as const) {
      expect(sections[menu]).toBe(sections[heading]);
    }
    expect(zhCN.components.settingsDialog.gitIntegration).toBe(sections.git);
    expect(zhCN.components.settingsDialog.reviewSources).toBe(sections.reviewSources);
    for (const name of Object.values(sections)) {
      expect([...name].length).toBeGreaterThanOrEqual(2);
      expect([...name].length).toBeLessThanOrEqual(4);
    }
  });

  it('keeps common settings concise without dropping important caveats', () => {
    const settings = zhCN.settings;
    const descriptions = [
      settings.theme.description, settings.language.description,
      settings.hintInfo.description, settings.codeHeaders.description,
      settings.editorRefresh.description, settings.deleteConfirm.description,
      settings.chat.goToTopDescription, settings.chat.viewOptionsDescription,
      settings.chat.memoryDescription, settings.chat.streamingDescription,
      settings.chat.soundDescription, settings.keyboard.newSessionDescription,
      settings.keyboard.fullscreenDescription,
    ];
    for (const description of descriptions) {
      expect([...description].length).toBeLessThanOrEqual(20);
    }
    expect(settings.chat.memoryDescription).toContain('待保存');
    expect(settings.chat.steer).toContain('下一个工具调用边界');
    expect(settings.chat.followUp).toContain('当前回复结束后');
    expect(settings.chat.ttsDescription).toContain('默认关闭');
    expect(settings.launchCache.description).toContain('不会删除会话');
    expect(settings.keyboard.description).toContain('Ctrl+Alt+P');
  });

  it('uses the product glossary and rejects known machine translations', () => {
    const allowedTechnicalMemoryKey = 'components.chatPanel.inMemory';
    const entriesToCheck = Object.entries(chinese)
      .filter(([key]) => key !== allowedTechnicalMemoryKey);
    const forbidden = /型号|令牌|所有州|内存|公关|分行|基地支部|波兰|抛光|犯罪|残疾人|型材|法典|新会议|现场会议|公开会议|合并请求请求|新航站楼|存储库|工作空间|代理配置|代理资料|审核日志/;

    expect(entriesToCheck.filter(([, value]) => forbidden.test(value))).toEqual([]);
  });
});
