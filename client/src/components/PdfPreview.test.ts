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

const context = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  lineCap: '',
  lineJoin: '',
  strokeStyle: '',
  lineWidth: 0,
} as unknown as CanvasRenderingContext2D;

describe('PdfPreview', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    pdfjsMock.getDocument.mockClear();
    pdfjsMock.getPage.mockClear();
    pdfjsMock.render.mockClear();
    pdfjsMock.destroy.mockClear();
  });

  it('loads a PDF and supports page navigation and zoom', async () => {
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.mjs');
    expect(pdfjsMock.getDocument).toHaveBeenCalledWith({ url: '/api/files/raw?path=document.pdf' });
    expect(fetch).toHaveBeenCalledWith('/api/files/read?path=%2Fproject%2F.document.pdf.annotations.json');
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

  it('combines PDF controls in one toolbar with icon tooltips', async () => {
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(wrapper.findAll('.pdf-toolbar')).toHaveLength(1);
    expect(wrapper.find('.pdf-annotation-toolbar').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Draw on PDF"]').attributes('data-tooltip')).toBe('Draw on PDF');
    expect(wrapper.get('[aria-label="Undo annotation"]').attributes('data-tooltip')).toBe('Undo annotation');
    expect(wrapper.get('[aria-label="Next page"]').attributes('data-tooltip')).toBe('Next page');
  });

  it('loads annotations from the legacy visible sidecar name', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('%2Fproject%2F.document.pdf.annotations.json')) {
        return { ok: false, status: 404 } as Response;
      }
      if (String(url).includes('%2Fproject%2Fdocument.pdf.annotations.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: JSON.stringify({
              version: 1,
              pages: { '1': [{ color: '#ef4444', width: 3, points: [{ x: 0.1, y: 0.1 }] }] },
            }),
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/files/read?path=%2Fproject%2Fdocument.pdf.annotations.json');
    expect(wrapper.find('[aria-label="Clear annotations on this page"]').attributes('disabled')).toBeUndefined();
  });

  it('draws and saves annotations in a hidden sidecar file', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) return { ok: false, status: 404 } as Response;
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();
    await wrapper.find('[aria-label="Draw on PDF"]').trigger('click');

    const canvas = wrapper.find('.pdf-annotation-canvas');
    await canvas.trigger('pointerdown', { pointerId: 1, clientX: 60, clientY: 80 });
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 120, clientY: 160 });
    await canvas.trigger('pointerup', { pointerId: 1, clientX: 120, clientY: 160 });
    await flushPromises();

    const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
    expect(writeCall).toBeDefined();
    const body = JSON.parse(String(writeCall?.[1]?.body));
    expect(body.path).toBe('/project/.document.pdf.annotations.json');
    expect(JSON.parse(body.content).pages['1'][0].points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]);
  });
});
