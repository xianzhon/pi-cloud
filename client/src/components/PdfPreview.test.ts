import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PdfPreview from './PdfPreview.vue';

const pdfjsMock = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render,
  }));
  const document = { numPages: 2, getPage };
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({ promise: Promise.resolve(document), destroy }));
  return { GlobalWorkerOptions: { workerSrc: '' }, getDocument, getPage, render, destroy };
});

vi.mock('pdfjs-dist', () => pdfjsMock);
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.mjs' }));

enableAutoUnmount(afterEach);

describe('PdfPreview', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pdfjsMock.getDocument.mockClear();
    pdfjsMock.getPage.mockClear();
    pdfjsMock.render.mockClear();
    pdfjsMock.destroy.mockClear();
  });

  it('loads a PDF and supports page navigation and zoom', async () => {
    const wrapper = mount(PdfPreview, { props: { src: '/api/files/raw?path=document.pdf' } });
    await flushPromises();

    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.mjs');
    expect(pdfjsMock.getDocument).toHaveBeenCalledWith({ url: '/api/files/raw?path=document.pdf' });
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(1);
    expect(wrapper.find('.pdf-page-status').text()).toBe('Page 1 of 2');

    await wrapper.find('[aria-label="Next page"]').trigger('click');
    await flushPromises();
    expect(pdfjsMock.getPage).toHaveBeenLastCalledWith(2);
    expect(wrapper.find('.pdf-page-status').text()).toBe('Page 2 of 2');

    await wrapper.find('[aria-label="Zoom in"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.pdf-zoom-level').text()).toBe('125%');
  });
});
