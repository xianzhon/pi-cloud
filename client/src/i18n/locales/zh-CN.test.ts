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

  it('uses the product glossary and rejects known machine translations', () => {
    const allowedTechnicalMemoryKey = 'components.chatPanel.inMemory';
    const entriesToCheck = Object.entries(chinese)
      .filter(([key]) => key !== allowedTechnicalMemoryKey);
    const forbidden = /型号|令牌|所有州|内存|公关|分行|基地支部|波兰|抛光|犯罪|残疾人|型材|法典|新会议|现场会议|公开会议|合并请求请求|新航站楼|存储库|工作空间|代理配置|代理资料|审核日志/;

    expect(entriesToCheck.filter(([, value]) => forbidden.test(value))).toEqual([]);
  });
});
