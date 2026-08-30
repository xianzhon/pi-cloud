import { describe, expect, it } from 'vitest';
import {
  buildMarkdownPrintDocument,
  getCanvasPageSlices,
  getMarkdownPdfFilename,
  getMarkdownPdfPath,
} from './markdownPdfExport';

describe('markdownPdfExport', () => {
  it('derives a safe PDF filename from the Markdown path', () => {
    expect(getMarkdownPdfFilename('/project/docs/guide.md')).toBe('guide.pdf');
    expect(getMarkdownPdfFilename('draft?.mdx')).toBe('draft_.pdf');
  });

  it('places the PDF copy beside the Markdown source', () => {
    expect(getMarkdownPdfPath('/project/docs/guide.md')).toBe('/project/docs/guide.pdf');
    expect(getMarkdownPdfPath('C:\\notes\\guide.mdx')).toBe('C:\\notes\\guide.pdf');
    expect(getMarkdownPdfPath('README.md')).toBe('README.pdf');
  });

  it('splits a rendered canvas into contiguous pages without overlap', () => {
    expect(getCanvasPageSlices(1000, 3200)).toEqual([
      { sourceY: 0, sourceHeight: 1500 },
      { sourceY: 1500, sourceHeight: 1500 },
      { sourceY: 3000, sourceHeight: 200 },
    ]);
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
