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
  rect: vi.fn(),
  ellipse: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  lineCap: '',
  lineJoin: '',
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 0,
  globalAlpha: 1,
  font: '',
  textBaseline: '',
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
    expect(wrapper.find('.pdf-page-status').text()).toBe('1/2');

    await wrapper.find('[aria-label="Next page"]').trigger('click');
    await flushPromises();
    expect(pdfjsMock.getPage).toHaveBeenLastCalledWith(2);
    expect(wrapper.find('.pdf-page-status').text()).toBe('2/2');

    await wrapper.find('[aria-label="Zoom in"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.pdf-zoom-level').text()).toBe('125%');
  });

  it('supports continuous scrolling through all PDF pages', async () => {
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const viewToggle = wrapper.get('[aria-label="Continuous scroll"]');
    expect(viewToggle.attributes('aria-pressed')).toBe('false');
    await viewToggle.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.pdf-page')).toHaveLength(2);
    expect(wrapper.get('.pdf-pages').classes()).toContain('continuous');
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(2);
    expect(wrapper.get('[aria-label="Single page view"]').attributes('aria-pressed')).toBe('true');
  });

  it('pans the PDF viewport by dragging when annotation tools are inactive', async () => {
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const viewport = wrapper.get<HTMLElement>('.pdf-viewport');
    viewport.element.scrollLeft = 120;
    viewport.element.scrollTop = 200;

    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    expect(viewport.classes()).toContain('panning');
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 50 });
    expect(viewport.element.scrollLeft).toBe(160);
    expect(viewport.element.scrollTop).toBe(250);

    await viewport.trigger('pointerup', { pointerId: 1 });
    expect(viewport.classes()).not.toContain('panning');
  });

  it('combines PDF controls in one toolbar with icon tooltips', async () => {
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(wrapper.findAll('.pdf-toolbar')).toHaveLength(1);
    expect(wrapper.find('.pdf-annotation-toolbar').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Draw on PDF"]').attributes('data-tooltip')).toBe('Draw on PDF');
    for (const label of ['Highlight PDF', 'Draw line', 'Draw arrow', 'Draw rectangle', 'Draw ellipse', 'Add text', 'Move annotation']) {
      expect(wrapper.get(`[aria-label="${label}"]`).attributes('data-tooltip')).toBe(label);
    }
    expect(wrapper.get('[aria-label="Undo annotation"]').attributes('data-tooltip')).toBe('Undo annotation');
    expect(wrapper.get('[aria-label="Next page"]').attributes('data-tooltip')).toBe('Next page');

    const penWidth = wrapper.get<HTMLInputElement>('[aria-label="Annotation width"]');
    expect(wrapper.get('.pdf-width-value').text()).toBe('1');
    await penWidth.setValue(7);
    expect(wrapper.get('.pdf-width-value').text()).toBe('7');
    expect(penWidth.attributes('style')).toContain('--pdf-pen-width-progress: 54.545');

    await wrapper.get('[aria-label="Erase PDF annotations"]').trigger('click');
    expect(wrapper.get('.pdf-annotation-canvas').classes()).toContain('erasing');
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

  it('draws and saves shape annotations', async () => {
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
    await wrapper.get('[aria-label="Draw rectangle"]').trigger('click');

    const canvas = wrapper.find('.pdf-annotation-canvas');
    await canvas.trigger('pointerdown', { pointerId: 1, clientX: 60, clientY: 80 });
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 180, clientY: 240 });
    await canvas.trigger('pointerup', { pointerId: 1, clientX: 180, clientY: 240 });
    await flushPromises();

    const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
    const body = JSON.parse(String(writeCall?.[1]?.body));
    expect(JSON.parse(body.content).pages['1'][0]).toMatchObject({
      type: 'rectangle',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
    });
    expect(context.rect).toHaveBeenCalled();

    await wrapper.get('[aria-label="Add text"]').trigger('click');
    await canvas.trigger('pointerdown', { pointerId: 2, clientX: 240, clientY: 320 });
    await canvas.trigger('pointerup', { pointerId: 2, clientX: 240, clientY: 320 });

    const textEditor = wrapper.get<HTMLTextAreaElement>('.pdf-text-editor');
    expect(textEditor.attributes('aria-label')).toBe('Enter annotation text');
    await textEditor.setValue('Review this');
    await textEditor.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.find('.pdf-text-editor').exists()).toBe(true);
    await textEditor.setValue('Review this\non two lines');
    expect(textEditor.attributes('style')).toContain('width: 14ch');
    expect(textEditor.attributes('style')).toContain('height: 2.75em');
    await textEditor.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(wrapper.find('.pdf-text-editor').exists()).toBe(false);

    const latestWrite = fetchMock.mock.calls.filter(([url]) => url === '/api/files/write').at(-1);
    const latestBody = JSON.parse(String(latestWrite?.[1]?.body));
    expect(JSON.parse(latestBody.content).pages['1'][1]).toMatchObject({
      type: 'text',
      text: 'Review this\non two lines',
      points: [{ x: 0.4, y: 0.4 }],
    });
    expect(context.fillText).toHaveBeenCalledWith('Review this', 240, 320);
    expect(context.fillText).toHaveBeenCalledWith('on two lines', 240, 340);
  });

  it('edits an existing text annotation directly on the PDF', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: JSON.stringify({
              version: 1,
              pages: {
                '1': [{
                  type: 'text', color: '#ef4444', width: 1,
                  points: [{ x: 0.4, y: 0.4 }], text: 'Review this',
                }],
              },
            }),
          }),
        } as Response;
      }
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Add text"]').trigger('click');
    const canvas = wrapper.get('.pdf-annotation-canvas');
    await canvas.trigger('pointerdown', { pointerId: 2, clientX: 245, clientY: 325 });
    await canvas.trigger('pointerup', { pointerId: 2, clientX: 245, clientY: 325 });
    await flushPromises();

    const textEditor = wrapper.get<HTMLTextAreaElement>('.pdf-text-editor');
    expect(textEditor.element.value).toBe('Review this');
    await textEditor.setValue('Updated review');
    await textEditor.trigger('keydown', { key: 'Enter', metaKey: true });
    await flushPromises();

    const latestWrite = fetchMock.mock.calls.filter(([url]) => url === '/api/files/write').at(-1);
    const body = JSON.parse(String(latestWrite?.[1]?.body));
    expect(JSON.parse(body.content).pages['1'][0]).toMatchObject({
      type: 'text', text: 'Updated review', points: [{ x: 0.4, y: 0.4 }],
    });
  });

  it('moves the topmost annotation and saves its new position', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: JSON.stringify({
              version: 1,
              pages: {
                '1': [{
                  type: 'rectangle', color: '#ef4444', width: 1,
                  points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
                }],
              },
            }),
          }),
        } as Response;
      }
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    const wrapper = mount(PdfPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Move annotation"]').trigger('click');

    const canvas = wrapper.get('.pdf-annotation-canvas');
    expect(canvas.classes()).toContain('moving');
    await canvas.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 160 });
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 240, clientY: 320 });
    await canvas.trigger('pointerup', { pointerId: 1, clientX: 240, clientY: 320 });
    await flushPromises();

    const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
    const body = JSON.parse(String(writeCall?.[1]?.body));
    const points = JSON.parse(body.content).pages['1'][0].points;
    expect(points[0].x).toBeCloseTo(0.3);
    expect(points[0].y).toBeCloseTo(0.3);
    expect(points[1].x).toBeCloseTo(0.5);
    expect(points[1].y).toBeCloseTo(0.5);
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
