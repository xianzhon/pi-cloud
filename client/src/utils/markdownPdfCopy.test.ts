import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  html2canvas: vi.fn(), save: vi.fn(async () => new Uint8Array([1, 2, 3])), embedPng: vi.fn(async () => ({ image: true })),
  drawImage: vi.fn(), addPage: vi.fn(),
}));
vi.mock('html2canvas', () => ({ default: mocks.html2canvas }));
vi.mock('pdf-lib', () => ({ PDFDocument: { create: vi.fn(async () => ({
  save: mocks.save, embedPng: mocks.embedPng,
  addPage: (...args: unknown[]) => { mocks.addPage(...args); return { drawImage: mocks.drawImage }; },
})) } }));

import { createMarkdownPdfCopy, exportMarkdownPdf, waitForMarkdownPdfImages } from './markdownPdfExport';

function mockLoadedImages() {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1);
}

function mockCanvases() {
  const original = document.createElement.bind(document);
  return vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = original(tag);
    if (tag === 'canvas') {
      Object.defineProperty(element, 'getContext', { value: () => ({ drawImage: vi.fn() }) });
      Object.defineProperty(element, 'toDataURL', { value: () => 'data:image/png;base64,AA==' });
    }
    return element;
  }) as typeof document.createElement);
}

describe('Markdown PDF rendering', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.querySelectorAll('iframe').forEach((item) => item.remove()); });

  it('waits for image load and error events and marks broken images', async () => {
    const doc = document.implementation.createHTMLDocument();
    const loaded = doc.createElement('img');
    const failed = doc.createElement('img');
    Object.defineProperties(loaded, { complete: { value: false }, naturalWidth: { value: 10 } });
    Object.defineProperties(failed, { complete: { value: false }, naturalWidth: { value: 0 } });
    doc.body.append(loaded, failed);
    const waiting = waitForMarkdownPdfImages(doc, 1000);
    loaded.dispatchEvent(new Event('load'));
    failed.dispatchEvent(new Event('error'));
    await waiting;
    expect(loaded.hasAttribute('data-html2canvas-ignore')).toBe(false);
    expect(failed.getAttribute('data-html2canvas-ignore')).toBe('true');
  });

  it('creates and uploads a paged PDF while inlining duplicate local images', async () => {
    mockLoadedImages();
    mockCanvases();
    mocks.html2canvas.mockResolvedValue(Object.assign(document.createElement('canvas'), { width: 658, height: 900 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const path = await createMarkdownPdfCopy({ filePath: '/project/readme.md', html: '<img src="a.png"><img src="a.png"><img src="data:image/png;base64,AA==">' });
    expect(path).toBe('/project/readme.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.embedPng).toHaveBeenCalled();
    expect(mocks.drawImage).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/files/create-binary', expect.objectContaining({ method: 'POST' }));
  });

  it('ignores image download failures and reports upload failures', async () => {
    mockLoadedImages();
    mockCanvases();
    mocks.html2canvas.mockResolvedValue(Object.assign(document.createElement('canvas'), { width: 658, height: 500 }));
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('image failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'write failed' }), { status: 500 })));
    await expect(createMarkdownPdfCopy({ filePath: 'a.md', html: '<img src="a.png">' })).rejects.toThrow('write failed');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('prints normalized Markdown and restores the parent title when printing throws', async () => {
    mockLoadedImages();
    vi.useFakeTimers();
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = original(tag);
      if (tag === 'iframe') Object.defineProperty(element, 'contentWindow', { configurable: true, value: { addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn(() => { throw new Error('print failed'); }) } });
      return element;
    }) as typeof document.createElement);
    document.title = 'Original';
    await expect(exportMarkdownPdf({ filePath: '/p/doc.md', html: '<img src="data:image/png;base64,AA==">' })).rejects.toThrow('print failed');
    await vi.runAllTimersAsync();
    expect(document.title).toBe('Original');
  });
});
