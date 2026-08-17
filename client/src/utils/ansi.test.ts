import { describe, expect, it } from 'vitest';
import { ansiToHtml, normalizeTerminalOutput } from './ansi';

describe('normalizeTerminalOutput', () => {
  it('keeps only the latest carriage-return progress update', () => {
    expect(normalizeTerminalOutput('Starting\n## 20%\r#### 40%\r###### 60%\r\nDone'))
      .toBe('Starting\n###### 60%\nDone');
  });
});

describe('ansiToHtml', () => {
  it('returns plain text unchanged when no ANSI codes are present', () => {
    expect(ansiToHtml('hello <world>')).toBe('hello <world>');
  });

  it('wraps foreground color sequences in styled spans', () => {
    expect(ansiToHtml('\x1b[31merror\x1b[0m')).toBe('<span style="color: #e74856">error</span>');
  });

  it('combines text styles and resets them', () => {
    expect(ansiToHtml('\x1b[1;4mstrong\x1b[0m plain')).toBe('<span style="font-weight: bold; text-decoration: underline">strong</span> plain');
  });

  it('supports bright foreground and background colors', () => {
    expect(ansiToHtml('\x1b[92;101mok\x1b[0m')).toBe('<span style="color: #5af78e; background-color: #ff6b6b">ok</span>');
  });
});
