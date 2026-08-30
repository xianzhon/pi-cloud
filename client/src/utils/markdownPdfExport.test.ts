import { describe, expect, it } from 'vitest';
import { buildMarkdownPrintDocument, getMarkdownPdfFilename } from './markdownPdfExport';

describe('markdownPdfExport', () => {
  it('derives a safe PDF filename from the Markdown path', () => {
    expect(getMarkdownPdfFilename('/project/docs/guide.md')).toBe('guide.pdf');
    expect(getMarkdownPdfFilename('draft?.mdx')).toBe('draft_.pdf');
  });

  it('builds a printable document containing the rendered Markdown', () => {
    const document = buildMarkdownPrintDocument({
      filePath: '/project/guide.md',
      html: '<h1>Guide</h1><p>Ready</p>',
    });

    expect(document).toContain('<title>guide.pdf</title>');
    expect(document).toContain('@page { size: A4;');
    expect(document).toContain('"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"');
    expect(document).toContain('<body><h1>Guide</h1><p>Ready</p></body>');
  });
});
