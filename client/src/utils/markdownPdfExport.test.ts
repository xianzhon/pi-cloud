import { describe, expect, it, vi } from 'vitest';
import {
  buildMarkdownPrintDocument,
  getCanvasPageSlices,
  getMarkdownPdfFilename,
  getMarkdownPdfPath,
  getMarkdownPdfRenderChunks,
  getMarkdownPdfRenderWidth,
  normalizeMarkdownPdfHtml,
  waitForMarkdownPdfImages,
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

  it('normalizes encoded, queried, and absolute workspace image paths', () => {
    const normalized = normalizeMarkdownPdfHtml(
      '<img src="docs/my%20logo.png?cache=1#preview"><img src="/project/assets/ready.png"><img src="/api/files/raw?path=%2Fproject%2Fbadge.png?raw=1"><img src="/api/files/raw?path=%2Fproject%2Fhash%23name.png#view"><picture><source srcset="large.png 2x"></picture>',
      '/project/README.md',
    );
    const document = new DOMParser().parseFromString(normalized, 'text/html');
    const images = Array.from(document.querySelectorAll('img'));

    expect(images[0].getAttribute('src')).toBe('/api/files/raw?path=%2Fproject%2Fdocs%2Fmy%20logo.png#preview');
    expect(images[1].getAttribute('src')).toBe('/api/files/raw?path=%2Fproject%2Fassets%2Fready.png');
    expect(images[2].getAttribute('src')).toBe('/api/files/raw?path=%2Fproject%2Fbadge.png');
    expect(images[3].getAttribute('src')).toBe('/api/files/raw?path=%2Fproject%2Fhash%23name.png#view');
    expect(document.querySelector('source')?.getAttribute('srcset')).toBeNull();
  });

  it('excludes remote and unsupported image sources while retaining data images', () => {
    const normalized = normalizeMarkdownPdfHtml(
      '<img src="https://example.com/badge.svg"><img src="ftp://example.com/image.png"><img src="blob:https://example.com/id"><img src="data:image/png;base64,AA==">',
      '/project/README.md',
    );
    const images = Array.from(new DOMParser().parseFromString(normalized, 'text/html').querySelectorAll('img'));

    for (const image of images.slice(0, 3)) {
      expect(image.getAttribute('src')).toBeNull();
      expect(image.getAttribute('data-html2canvas-ignore')).toBe('true');
    }
    expect(images[3].getAttribute('src')).toBe('data:image/png;base64,AA==');
  });

  it('normalizes SVG images and removes external inline background images', () => {
    const normalized = normalizeMarkdownPdfHtml(
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image href="assets/chart%20one.png?cache=1"></image><image xlink:href="https://example.com/legacy.svg"></image><use href="https://example.com/icons.svg#mark"></use></svg><div style="background-image:url(https://example.com/background.png)"></div>',
      '/project/docs/guide.md',
    );
    const document = new DOMParser().parseFromString(normalized, 'text/html');

    const svgImages = Array.from(document.querySelectorAll('image'));
    expect(svgImages[0].getAttribute('href')).toBe('/api/files/raw?path=%2Fproject%2Fdocs%2Fassets%2Fchart%20one.png');
    expect(svgImages[1].getAttribute('xlink:href')).toBeNull();
    expect(document.querySelector('use')?.getAttribute('href')).toBeNull();
    expect((document.querySelector('div') as HTMLElement).style.backgroundImage).toBe('');
  });

  it('bounds the render width to safe canvas dimensions', () => {
    expect(getMarkdownPdfRenderWidth(320, 500)).toBe(658);
    expect(getMarkdownPdfRenderWidth(10_000, 12_000)).toBe(1600);
  });

  it('splits long documents into bounded chunks without reducing raster scale', () => {
    const chunks = getMarkdownPdfRenderChunks(658, 14_000, 2);

    expect(chunks).toHaveLength(3);
    expect(chunks.every(chunk => chunk.sourceHeight <= 6_000)).toBe(true);
    expect(chunks.flatMap(chunk => chunk.pages)).toEqual(getCanvasPageSlices(658, 14_000));
  });

  it('stops waiting for stalled images and excludes them from rendering', async () => {
    vi.useFakeTimers();
    try {
      const printDocument = document.implementation.createHTMLDocument();
      const image = printDocument.createElement('img');
      Object.defineProperties(image, {
        complete: { configurable: true, value: false },
        naturalWidth: { configurable: true, value: 0 },
      });
      printDocument.body.appendChild(image);

      const waiting = waitForMarkdownPdfImages(printDocument, 50);
      await vi.advanceTimersByTimeAsync(50);
      await waiting;

      expect(image.getAttribute('data-html2canvas-ignore')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
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
