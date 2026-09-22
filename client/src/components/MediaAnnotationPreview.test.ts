import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaAnnotationPreview from './MediaAnnotationPreview.vue';

const pdfjsMock = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render,
  }));
  const getOutline = vi.fn<() => Promise<unknown[] | null>>(async () => []);
  const getDestination = vi.fn<(id: string) => Promise<unknown[] | null>>(async () => null);
  const getPageIndex = vi.fn<(ref: unknown) => Promise<number>>(async () => 0);
  const document = { numPages: 2, getPage, getOutline, getDestination, getPageIndex };
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({ promise: Promise.resolve(document), destroy }));
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument,
    getPage,
    getOutline,
    getDestination,
    getPageIndex,
    render,
    destroy,
    document,
  };
});

const pdfLibMock = vi.hoisted(() => {
  const drawImage = vi.fn();
  const page = { getSize: vi.fn(() => ({ width: 600, height: 800 })), drawImage };
  const embedPng = vi.fn(async () => ({}));
  const save = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const load = vi.fn(async () => ({ getPages: () => [page, page], embedPng, save }));
  return { load, embedPng, save, drawImage };
});

vi.mock('pdfjs-dist', () => pdfjsMock);
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.mjs' }));
vi.mock('pdf-lib', () => ({ PDFDocument: { load: pdfLibMock.load } }));

enableAutoUnmount(afterEach);

const context = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  rect: vi.fn(),
  fillRect: vi.fn(),
  ellipse: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn((text: string) => ({ width: text.length * 10 }) as TextMetrics),
  drawImage: vi.fn(),
  translate: vi.fn(),
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

describe('MediaAnnotationPreview', () => {
  beforeEach(() => {
    localStorage.removeItem('pi-cloud.annotationToolShortcuts');
    pdfjsMock.document.numPages = 2;
    pdfjsMock.getOutline.mockResolvedValue([]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,overlay');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    pdfjsMock.getDocument.mockClear();
    pdfjsMock.getPage.mockClear();
    pdfjsMock.getOutline.mockClear();
    pdfjsMock.getDestination.mockClear();
    pdfjsMock.getPageIndex.mockClear();
    pdfjsMock.render.mockClear();
    pdfjsMock.destroy.mockClear();
    pdfLibMock.load.mockClear();
    pdfLibMock.embedPng.mockClear();
    pdfLibMock.save.mockClear();
    pdfLibMock.drawImage.mockClear();
  });

  it('loads a PDF and supports page navigation and zoom', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.mjs');
    expect(pdfjsMock.getDocument).toHaveBeenCalledWith({
      url: '/api/files/raw?path=document.pdf',
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
    });
    expect(fetch).toHaveBeenCalledWith('/api/files/read?path=%2Fproject%2F.annotations%2Fdocument.pdf.annotations.json');
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(1);
    expect(wrapper.find('.pdf-page-status').text()).toBe('1/2');
    expect(wrapper.get('[aria-label="PDF page color"]').element.tagName).toBe('BUTTON');

    await wrapper.find('[aria-label="Next page"]').trigger('click');
    await flushPromises();
    expect(pdfjsMock.getPage).toHaveBeenLastCalledWith(2);
    expect(wrapper.find('.pdf-page-status').text()).toBe('2/2');

    await wrapper.find('[aria-label="Zoom in"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.pdf-zoom-level').text()).toBe('110%');
  });

  it('renders and annotates MHTML directly without converting it to PDF', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/files/read')) return { ok: false, status: 404 } as Response;
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    }));

    const wrapper = mount(MediaAnnotationPreview, {
      props: {
        src: '',
        filePath: '/project/snapshot.mhtml',
        htmlDocument: '<!doctype html><html><body><h1>Archived page</h1></body></html>',
        kind: 'html',
      },
    });
    await flushPromises();

    const frame = wrapper.get('iframe.mhtml-document-frame');
    expect(frame.attributes('srcdoc')).toContain('Archived page');
    expect(frame.attributes('sandbox')).toBe('allow-same-origin');
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/files/read?path=%2Fproject%2F.annotations%2Fsnapshot.mhtml.annotations.json');

    await frame.trigger('load');
    await flushPromises();
    expect(wrapper.find('.pdf-navigation-toolbar').exists()).toBe(false);
    expect(wrapper.find('[aria-label="MHTML annotation controls"]').exists()).toBe(true);

    await wrapper.get('[aria-label="Cover MHTML content with rectangle"]').trigger('click');
    const canvas = wrapper.get<HTMLCanvasElement>('.pdf-annotation-canvas');
    expect(canvas.classes()).toContain('mhtml');
    expect(wrapper.findAll('.pdf-page > canvas')).toHaveLength(1);
    await canvas.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 20 });

    let drawFrame: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      drawFrame = callback;
      return 1;
    });
    vi.mocked(context.clearRect).mockClear();
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 30, clientY: 30 });
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 40, clientY: 40 });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(context.clearRect).not.toHaveBeenCalled();
    drawFrame?.(0);
    expect(context.clearRect).toHaveBeenCalledTimes(1);

    await canvas.trigger('pointerup', { pointerId: 1, clientX: 40, clientY: 40 });
    await flushPromises();

    vi.spyOn(wrapper.get<HTMLElement>('.pdf-page').element, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: -120, width: 600, height: 800, right: 600, bottom: 680, x: 0, y: -120, toJSON: () => ({}),
    });
    canvas.element.width = 600;
    requestFrame.mockClear();
    vi.mocked(context.translate).mockClear();
    await wrapper.get('.pdf-viewport').trigger('scroll');
    expect(requestFrame).not.toHaveBeenCalled();
    expect(vi.mocked(context.translate).mock.calls.at(-1)?.[1]).toBe(-120);

    expect(fetch).toHaveBeenCalledWith('/api/files/write', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('/project/.annotations/snapshot.mhtml.annotations.json'),
    }));
  });

  it('keeps the MHTML layout fixed when zooming and resizing the viewport', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    let resize: (() => void) | undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const wrapper = mount(MediaAnnotationPreview, {
      attachTo: document.body,
      props: { src: '', filePath: '/project/zoom.mhtml', kind: 'html', htmlDocument: '<p>Content</p>' },
    });
    await flushPromises();
    const viewport = wrapper.get<HTMLElement>('.pdf-viewport');
    Object.defineProperty(viewport.element, 'clientWidth', { configurable: true, value: 640 });
    viewport.element.style.padding = '0px';
    const frame = wrapper.get<HTMLIFrameElement>('.mhtml-document-frame');
    const htmlDocument = window.document.implementation.createHTMLDocument();
    Object.defineProperty(htmlDocument.documentElement, 'scrollHeight', { value: 800 });
    Object.defineProperty(frame.element, 'contentDocument', { value: htmlDocument });
    await frame.trigger('load');
    await flushPromises();
    const layoutWidth = frame.element.style.width;
    const pageWidth = wrapper.get<HTMLElement>('.pdf-page').element.style.width;
    expect(parseFloat(layoutWidth)).toBeGreaterThan(1);

    await viewport.trigger('wheel', { ctrlKey: true, deltaY: -100 });
    await flushPromises();
    expect(frame.element.style.width).toBe(layoutWidth);
    expect(frame.element.style.transform).toBe('scale(1.1)');
    expect(parseFloat(wrapper.get<HTMLElement>('.pdf-page').element.style.width))
      .toBe(Math.floor(parseFloat(pageWidth) * 1.1));

    Object.defineProperty(viewport.element, 'clientWidth', { configurable: true, value: 400 });
    resize?.();
    await flushPromises();
    expect(frame.element.style.width).toBe(layoutWidth);
    expect(parseFloat(wrapper.get<HTMLElement>('.pdf-page').element.style.width))
      .toBe(Math.floor(parseFloat(pageWidth) * 1.1));
  });

  it('loads and annotates an image using the PDF toolset', async () => {
    class MockImage {
      naturalWidth = 800;
      naturalHeight = 600;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/files/read')) return { ok: false, status: 404 } as Response;
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    }));

    const wrapper = mount(MediaAnnotationPreview, {
      props: {
        src: '/api/files/raw?path=image.png',
        filePath: '/project/image.png',
        kind: 'image',
      },
    });
    await flushPromises();

    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
    expect(wrapper.find('.pdf-page-status').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Draw on image"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Export annotated image"]').exists()).toBe(true);

    const toneControl = wrapper.get('[aria-label="Image color"]');
    expect(toneControl.element.tagName).toBe('BUTTON');
    await toneControl.trigger('click');
    const warmOption = wrapper.findAll('[role="option"]').find(option => option.text() === 'Warm');
    expect(warmOption).toBeDefined();
    await warmOption!.trigger('click');
    await flushPromises();
    expect(wrapper.get('.pdf-pages').classes()).toContain('tone-warm');
    expect(fetch).toHaveBeenCalledWith('/api/files/write', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('\\"pageTone\\": \\"warm\\"'),
    }));

    const viewport = wrapper.get('.pdf-viewport');
    const wheelEvent = (ctrlKey: boolean): WheelEvent => {
      const event = new Event('wheel', { cancelable: true }) as WheelEvent;
      Object.defineProperties(event, {
        deltaY: { value: -100 },
        ctrlKey: { value: ctrlKey },
      });
      return event;
    };
    const regularScroll = wheelEvent(false);
    viewport.element.dispatchEvent(regularScroll);
    await wrapper.vm.$nextTick();
    expect(regularScroll.defaultPrevented).toBe(false);
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('100%');

    const modifierZoom = wheelEvent(true);
    viewport.element.dispatchEvent(modifierZoom);
    await flushPromises();
    expect(modifierZoom.defaultPrevented).toBe(true);
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('105%');

    await viewport.trigger('dblclick');
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('100%');

    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 150 });
    await viewport.trigger('pointerdown', { button: 0, pointerId: 2, clientX: 300, clientY: 150 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 0, clientY: 150 });
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('150%');
    await viewport.trigger('pointerup', { pointerId: 1 });
    await viewport.trigger('pointerup', { pointerId: 2 });

    for (let step = 0; step < 30; step++) await wrapper.get('[aria-label="Zoom out"]').trigger('click');
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('5%');

    const canvas = wrapper.get('.pdf-annotation-canvas');
    await wrapper.get('[aria-label="Add text"]').trigger('click');
    await canvas.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await canvas.trigger('pointerup', { pointerId: 1, clientX: 10, clientY: 10 });
    expect(wrapper.get('.pdf-text-editor').attributes('style')).toContain('font-size: 16px');
    await wrapper.get('.pdf-text-editor').trigger('keydown', { key: 'Escape' });

    await wrapper.get('[aria-label="Highlight image"]').trigger('click');
    expect(canvas.classes()).toContain('highlighter');
    await wrapper.get('[aria-label="Draw on image"]').trigger('click');
    expect(canvas.classes()).toContain('pen');
    await canvas.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 20, clientY: 20 });
    await canvas.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 20 });
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/files/write', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('/project/.annotations/image.png.annotations.json'),
    }));

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await wrapper.get('[aria-label="Export annotated image"]').trigger('click');
    await flushPromises();
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
    expect(click).toHaveBeenCalledOnce();
  });

  it('reports image loading failures', async () => {
    class MockImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal('Image', MockImage);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const wrapper = mount(MediaAnnotationPreview, {
      props: {
        src: '/api/files/raw?path=image.png',
        filePath: '/project/image.png',
        kind: 'image',
      },
    });
    await flushPromises();

    expect(wrapper.get('.pdf-error').text()).toBe('Failed to load image');
  });

  it('reports image rendering failures separately from image loading failures', async () => {
    class MockImage {
      naturalWidth = 800;
      naturalHeight = 600;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', MockImage);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);

    const wrapper = mount(MediaAnnotationPreview, {
      props: {
        src: '/api/files/raw?path=image.png',
        filePath: '/project/image.png',
        kind: 'image',
      },
    });
    await flushPromises();

    expect(wrapper.get('.pdf-error').text()).toBe('Failed to render image');
  });

  it('loads a PDF without an outline', async () => {
    pdfjsMock.getOutline.mockResolvedValueOnce(null);
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(wrapper.find('.pdf-error').exists()).toBe(false);
    expect(wrapper.find('.pdf-page-status').text()).toBe('1/2');
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(1);
  });

  it('shows the embedded PDF outline and navigates named destinations', async () => {
    pdfjsMock.getOutline.mockResolvedValueOnce([
      {
        title: 'Introduction',
        dest: [0],
        items: [{ title: 'Details', dest: 'details', items: [] }],
      },
    ]);
    pdfjsMock.getDestination.mockResolvedValueOnce([{ num: 4, gen: 0 }]);
    pdfjsMock.getPageIndex.mockResolvedValueOnce(1);
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const items = wrapper.findAll('.pdf-outline-items button');
    expect(items.map(item => item.text())).toEqual(['Introduction', 'Details']);
    expect(items[1].attributes('style')).toContain('padding-left: 1.5rem');

    await items[1].trigger('click');
    await flushPromises();
    expect(pdfjsMock.getDestination).toHaveBeenCalledWith('details');
    expect(pdfjsMock.getPageIndex).toHaveBeenCalledWith({ num: 4, gen: 0 });
    expect(wrapper.find('.pdf-page-status').text()).toBe('2/2');

    await wrapper.get('[aria-label="Hide PDF outline"]').trigger('click');
    expect(wrapper.find('.pdf-outline').exists()).toBe(false);
    await wrapper.get('[aria-label="Show PDF outline"]').trigger('click');
    expect(wrapper.find('.pdf-outline').exists()).toBe(true);
  });

  it('toggles between fitting the current page to the viewport width and height', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const viewport = wrapper.get<HTMLElement>('.pdf-viewport').element;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 700 },
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingLeft: '16px',
      paddingRight: '16px',
      paddingTop: '64px',
      paddingBottom: '64px',
    } as CSSStyleDeclaration);

    await wrapper.get('[aria-label="Fit PDF to viewport width"]').trigger('click');
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('161%');
    expect(wrapper.find('[aria-label="Fit PDF to viewport width"]').exists()).toBe(false);

    await wrapper.get('[aria-label="Fit PDF to viewport height"]').trigger('click');
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('72%');
    expect(wrapper.find('[aria-label="Fit PDF to viewport width"]').exists()).toBe(true);
  });

  it('renders a newly selected PDF once after resetting a changed zoom level', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('110%');

    pdfjsMock.render.mockClear();
    await wrapper.setProps({
      src: '/api/files/raw?path=other.pdf',
      filePath: '/project/other.pdf',
    });
    await flushPromises();

    expect(wrapper.find('.pdf-error').exists()).toBe(false);
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('100%');
    expect(pdfjsMock.render).toHaveBeenCalledTimes(2);
  });

  it('zooms the PDF with modifier-wheel without triggering browser zoom', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const viewport = wrapper.get('.pdf-viewport');
    const createWheelEvent = (deltaY: number, modifier?: 'ctrlKey' | 'metaKey'): WheelEvent => {
      const event = new Event('wheel', { cancelable: true }) as WheelEvent;
      Object.defineProperties(event, {
        deltaY: { value: deltaY },
        ctrlKey: { value: modifier === 'ctrlKey' },
        metaKey: { value: modifier === 'metaKey' },
      });
      return event;
    };
    const zoomIn = createWheelEvent(-100, 'ctrlKey');
    const preventZoomIn = vi.spyOn(zoomIn, 'preventDefault');
    viewport.element.dispatchEvent(zoomIn);
    await flushPromises();
    expect(preventZoomIn).toHaveBeenCalled();
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('110%');

    const zoomOut = createWheelEvent(100, 'metaKey');
    const preventZoomOut = vi.spyOn(zoomOut, 'preventDefault');
    viewport.element.dispatchEvent(zoomOut);
    await flushPromises();
    expect(preventZoomOut).toHaveBeenCalled();
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('100%');

    const regularScroll = createWheelEvent(100);
    const preventRegularScroll = vi.spyOn(regularScroll, 'preventDefault');
    viewport.element.dispatchEvent(regularScroll);
    expect(preventRegularScroll).not.toHaveBeenCalled();
    expect(wrapper.get('.pdf-zoom-level').text()).toBe('100%');
  });

  it('uses continuous scrolling without a view mode control', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(wrapper.findAll('.pdf-page')).toHaveLength(2);
    expect(wrapper.get('.pdf-pages').classes()).toContain('continuous');
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(2);
    expect(wrapper.find('[aria-label="Continuous scroll"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Single page view"]').exists()).toBe(false);
  });

  it('only rasterizes nearby pages when a PDF has many pages', async () => {
    pdfjsMock.document.numPages = 20;
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=large.pdf', filePath: '/project/large.pdf' },
    });
    await flushPromises();

    expect(wrapper.findAll('.pdf-page')).toHaveLength(20);
    expect(pdfjsMock.render).toHaveBeenCalledTimes(2);
  });

  it('pans the PDF viewport by dragging when annotation tools are inactive', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
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

  it('moves the annotation toolbar and switches to a vertical layout', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const preview = wrapper.get<HTMLElement>('.pdf-preview');
    const toolbar = wrapper.get<HTMLElement>('.pdf-toolbar');
    vi.spyOn(preview.element, 'getBoundingClientRect').mockReturnValue({
      left: 20, top: 30, width: 800, height: 600, right: 820, bottom: 630, x: 20, y: 30, toJSON: () => ({}),
    });
    vi.spyOn(toolbar.element, 'getBoundingClientRect').mockReturnValue({
      left: 120, top: 42, width: 500, height: 36, right: 620, bottom: 78, x: 120, y: 42, toJSON: () => ({}),
    });

    await wrapper.get('.pdf-toolbar-drag-handle').trigger('pointerdown', {
      button: 0, pointerId: 3, clientX: 130, clientY: 50,
    });
    const move = new Event('pointermove') as PointerEvent;
    Object.defineProperties(move, {
      pointerId: { value: 3 }, clientX: { value: 1000 }, clientY: { value: 1000 },
    });
    window.dispatchEvent(move);
    await wrapper.vm.$nextTick();

    expect(toolbar.attributes('style')).toContain('left: 300px');
    expect(toolbar.attributes('style')).toContain('top: 564px');

    await wrapper.get('.pdf-toolbar-drag-handle').trigger('keydown', { key: 'ArrowLeft' });
    expect(toolbar.attributes('style')).toContain('left: 290px');

    const verticalToggle = wrapper.get('[aria-label="Show annotation toolbar vertically"]');
    await verticalToggle.trigger('click');
    await flushPromises();
    expect(toolbar.classes()).toContain('vertical');
    expect(toolbar.attributes('style')).toContain('left: 12px');
    expect(toolbar.attributes('style')).toContain('top: 282px');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Annotation width"]').element.value).toBe('1');

    await wrapper.get('[aria-label="Show annotation toolbar horizontally"]').trigger('click');
    expect(toolbar.classes()).not.toContain('vertical');
    expect(toolbar.attributes('style') || '').not.toContain('left:');
  });

  it('keeps annotation controls at the top and page controls at the bottom-left', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const annotationToolbar = wrapper.get('.pdf-toolbar');
    const navigationToolbar = wrapper.get('.pdf-navigation-toolbar');
    expect(annotationToolbar.find('[aria-label="Previous page"]').exists()).toBe(false);
    expect(navigationToolbar.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
      'Previous page',
      'Next page',
      'Zoom out',
      'Reset PDF zoom',
      'Zoom in',
      'PDF page color',
      'Fit PDF to viewport width',
      'Export annotated PDF',
    ]);
    expect(annotationToolbar.get('[aria-label="Draw on PDF"]').attributes('data-tooltip')).toBe('Draw on PDF');
    for (const label of ['Highlight PDF', 'Draw line', 'Draw arrow', 'Draw rectangle', 'Draw ellipse', 'Add text', 'Move annotation', 'Cover PDF content with rectangle']) {
      expect(wrapper.get(`[aria-label="${label}"]`).attributes('data-tooltip')).toBe(label);
    }
    expect(wrapper.get('[aria-label="Undo annotation"]').attributes('data-tooltip')).toBe('Undo annotation');
    for (const button of navigationToolbar.findAll('button')) {
      expect(button.attributes('data-tooltip')).toBeUndefined();
      expect(button.classes()).not.toContain('tooltip');
    }

    const penButton = annotationToolbar.get('[aria-label="Draw on PDF"]');
    await penButton.trigger('mouseover');
    expect(wrapper.get('.pdf-annotation-tooltip').text()).toBe('Draw on PDF');
    await penButton.trigger('mouseout');
    expect(wrapper.find('.pdf-annotation-tooltip').exists()).toBe(false);
    await penButton.trigger('mouseover');
    await penButton.trigger('click');
    expect(wrapper.find('.pdf-annotation-tooltip').exists()).toBe(false);

    const penWidth = wrapper.get<HTMLInputElement>('[aria-label="Annotation width"]');
    expect(wrapper.get('.pdf-width-value').text()).toBe('1');
    await penWidth.setValue(7);
    expect(wrapper.get('.pdf-width-value').text()).toBe('7');
    expect(penWidth.attributes('style')).toContain('--pdf-pen-width-progress: 54.545');

    await wrapper.get('[aria-label="Erase PDF annotations"]').trigger('click');
    expect(wrapper.get('.pdf-annotation-canvas').classes()).toContain('erasing');
  });

  it('activates annotation tools with number shortcuts in toolbar order', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    const shortcuts = [
      ['1', 'Draw on PDF'],
      ['2', 'Highlight PDF'],
      ['3', 'Draw line'],
      ['4', 'Draw arrow'],
      ['5', 'Draw rectangle'],
      ['6', 'Draw ellipse'],
      ['7', 'Add text'],
      ['8', 'Move annotation'],
      ['9', 'Cover PDF content with rectangle'],
      ['0', 'Erase PDF annotations'],
    ];
    for (const [key, label] of shortcuts) {
      const button = wrapper.get(`[aria-label="${label}"]`);
      expect(button.attributes('aria-keyshortcuts')).toBe(key);
      expect(button.get('.pdf-tool-shortcut').text()).toBe(key);
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await wrapper.vm.$nextTick();
      expect(button.classes()).toContain('active');
    }

    const colorInput = wrapper.get<HTMLInputElement>('[aria-label="Annotation color"]');
    colorInput.element.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[aria-label="Erase PDF annotations"]').classes()).toContain('active');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }));
    await wrapper.vm.$nextTick();
    const eraserButton = wrapper.get('[aria-label="Erase PDF annotations"]');
    expect(eraserButton.classes()).toContain('active');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    await wrapper.vm.$nextTick();
    expect(eraserButton.classes()).not.toContain('active');
    expect(wrapper.get('.pdf-annotation-canvas').classes()).not.toContain('enabled');
  });

  it('shows the shortcut settings beside the toolbar with tool icons and after the delete control', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('pdf-preview')) {
        return { left: 20, top: 30, width: 800, height: 600, right: 820, bottom: 630, x: 20, y: 30, toJSON: () => ({}) };
      }
      if (this.classList.contains('pdf-toolbar')) {
        return { left: 120, top: 42, width: 500, height: 36, right: 620, bottom: 78, x: 120, y: 42, toJSON: () => ({}) };
      }
      if (this.getAttribute('aria-label') === 'Customize annotation shortcuts') {
        return { left: 560, top: 42, width: 36, height: 34, right: 596, bottom: 76, x: 560, y: 42, toJSON: () => ({}) };
      }
      if (this.classList.contains('pdf-shortcut-editor')) {
        return { left: 0, top: 0, width: 280, height: 500, right: 280, bottom: 500, x: 0, y: 0, toJSON: () => ({}) };
      }
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    const toolbarButtons = wrapper.get('.pdf-toolbar-group').findAll('button');
    const deleteIndex = toolbarButtons.findIndex(button => button.attributes('aria-label') === 'Clear annotations on this page');
    expect(toolbarButtons[deleteIndex + 1].attributes('aria-label')).toBe('Customize annotation shortcuts');
    expect(toolbarButtons[deleteIndex + 1].find('svg').exists()).toBe(true);

    await toolbarButtons[deleteIndex + 1].trigger('click');
    const editor = wrapper.get('.pdf-shortcut-editor');
    expect(editor.attributes('style')).toContain('left: 418px');
    expect(editor.attributes('style')).toContain('top: 56px');
    const shortcutTools = editor.findAll('.pdf-shortcut-tool');
    expect(shortcutTools).toHaveLength(10);
    expect(shortcutTools.every(tool => tool.find('svg').exists())).toBe(true);
  });

  it('customizes and persists single-key annotation shortcuts while retaining unchanged number shortcuts', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    await wrapper.get('[aria-label="Customize annotation shortcuts"]').trigger('click');
    for (const [label, key] of [
      ['Shortcut for Draw on PDF', 'a'],
      ['Shortcut for Highlight PDF', 's'],
      ['Shortcut for Draw line', 'd'],
      ['Shortcut for Draw arrow', 'f'],
    ]) {
      await wrapper.get(`[aria-label="${label}"]`).trigger('keydown', { key });
    }

    for (const [key, label] of [
      ['a', 'Draw on PDF'],
      ['s', 'Highlight PDF'],
      ['d', 'Draw line'],
      ['f', 'Draw arrow'],
      ['5', 'Draw rectangle'],
    ]) {
      const button = wrapper.get(`[aria-label="${label}"]`);
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await wrapper.vm.$nextTick();
      expect(button.classes()).toContain('active');
    }

    expect(wrapper.get('[aria-label="Draw on PDF"]').attributes('aria-keyshortcuts')).toBe('A');
    expect(wrapper.get('[aria-label="Draw rectangle"]').attributes('aria-keyshortcuts')).toBe('5');
    await flushPromises();
    const savedShortcuts = JSON.parse(localStorage.getItem('pi-cloud.annotationToolShortcuts') || '{}');
    expect(savedShortcuts).toMatchObject({
      pen: 'A', highlighter: 'S', line: 'D', arrow: 'F', rectangle: '5',
    });
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotationToolShortcuts: savedShortcuts }),
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[aria-label="Draw on PDF"]').classes()).not.toContain('active');
  });

  it('swaps duplicate shortcut assignments and can reset the numeric defaults', async () => {
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    await wrapper.get('[aria-label="Customize annotation shortcuts"]').trigger('click');
    await wrapper.get('[aria-label="Shortcut for Highlight PDF"]').trigger('keydown', { key: '1' });
    expect(wrapper.get('[aria-label="Highlight PDF"]').attributes('aria-keyshortcuts')).toBe('1');
    expect(wrapper.get('[aria-label="Draw on PDF"]').attributes('aria-keyshortcuts')).toBe('2');

    await wrapper.get('.pdf-shortcut-reset').trigger('click');
    expect(wrapper.get('[aria-label="Draw on PDF"]').attributes('aria-keyshortcuts')).toBe('1');
    expect(wrapper.get('[aria-label="Highlight PDF"]').attributes('aria-keyshortcuts')).toBe('2');
    expect(JSON.parse(localStorage.getItem('pi-cloud.annotationToolShortcuts') || '{}')).toMatchObject({
      pen: '1', highlighter: '2', whiteout: '9', eraser: '0',
    });
  });

  it('loads annotations from the hidden annotation directory', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: JSON.stringify({
          version: 1,
          pages: { '1': [{ color: '#ef4444', width: 3, points: [{ x: 0.1, y: 0.1 }] }] },
        }),
      }),
    } as Response);

    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/files/read?path=%2Fproject%2F.annotations%2Fdocument.pdf.annotations.json');
    expect(wrapper.find('[aria-label="Clear annotations on this page"]').attributes('disabled')).toBeUndefined();
  });

  it.each([
    ['hidden sibling', '/project/.document.pdf.annotations.json'],
    ['visible sibling', '/project/document.pdf.annotations.json'],
  ])('reads annotations from the legacy %s sidecar without modifying it', async (_label, legacyPath) => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === '/api/files/write') return { ok: true, status: 200 } as Response;
      if (String(url) === `/api/files/read?path=${encodeURIComponent(legacyPath)}`) {
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
      return { ok: false, status: 404 } as Response;
    });

    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(`/api/files/read?path=${encodeURIComponent(legacyPath)}`);
    const clearButton = wrapper.get('[aria-label="Clear annotations on this page"]');
    expect(clearButton.attributes('disabled')).toBeUndefined();

    await clearButton.trigger('click');
    await flushPromises();
    const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
    expect(writeCall).toBeDefined();
    expect(JSON.parse(String(writeCall?.[1]?.body)).path)
      .toBe('/project/.annotations/document.pdf.annotations.json');
  });

  it('falls back to a legacy sidecar when the canonical sidecar is unreadable', async () => {
    const canonicalPath = '/project/.annotations/document.pdf.annotations.json';
    const legacyPath = '/project/.document.pdf.annotations.json';
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === `/api/files/read?path=${encodeURIComponent(canonicalPath)}`) {
        return { ok: false, status: 500 } as Response;
      }
      if (String(url) === `/api/files/read?path=${encodeURIComponent(legacyPath)}`) {
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
      return { ok: false, status: 404 } as Response;
    });

    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(`/api/files/read?path=${encodeURIComponent(legacyPath)}`);
    expect(wrapper.get('[aria-label="Clear annotations on this page"]').attributes('disabled')).toBeUndefined();
  });

  it('restores and saves viewer state in an existing annotation sidecar', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: JSON.stringify({
              version: 1,
              pages: { '1': [{ color: '#ef4444', width: 1, points: [{ x: 0.1, y: 0.1 }] }] },
              view: {
                scale: 1.5,
                page: 2,
                tool: 'eraser',
                penColor: '#123456',
                coverColor: '#3f3f4d',
                penWidth: 7,
                toolbarVertical: true,
                toolbarPosition: { left: 0, top: 0 },
              },
            }),
          }),
        } as Response;
      }
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();

    expect(wrapper.get('.pdf-zoom-level').text()).toBe('150%');
    expect(wrapper.get('.pdf-page-status').text()).toBe('2/2');
    expect(wrapper.get('[aria-label="Erase PDF annotations"]').classes()).toContain('active');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Annotation color"]').element.value).toBe('#123456');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Annotation width"]').element.value).toBe('7');
    expect(wrapper.get('.pdf-toolbar').classes()).toContain('vertical');
    expect(wrapper.get('.pdf-toolbar').attributes('style')).toContain('left: 0px');

    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 350));
    await flushPromises();

    const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
    const body = JSON.parse(String(writeCall?.[1]?.body));
    expect(JSON.parse(body.content).view).toEqual({
      scale: 1.6,
      page: 2,
      tool: 'eraser',
      penColor: '#123456',
      coverColor: '#3f3f4d',
      penWidth: 7,
      pageTone: 'original',
      toolbarVertical: true,
      toolbarPosition: { left: 0, top: 0 },
    });
  });

  it('draws and saves shape annotations', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) return { ok: false, status: 404 } as Response;
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    const wrapper = mount(MediaAnnotationPreview, {
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
    Object.defineProperty(textEditor.element, 'scrollHeight', { configurable: true, value: 72 });
    expect(textEditor.attributes('aria-label')).toBe('Enter annotation text');
    expect(textEditor.attributes('style')).toContain('width: 24ch');
    await textEditor.setValue('Review this');
    await textEditor.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.find('.pdf-text-editor').exists()).toBe(true);
    const longLine = 'this is a long text, cool, is it? how does it work?';
    await textEditor.setValue(`${longLine}\non two lines`);
    expect(textEditor.attributes('style')).toContain('width: 53ch');
    expect(textEditor.attributes('style')).toContain('max-width: 59%');
    expect(textEditor.element.style.height).toBe('72px');
    await textEditor.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(wrapper.find('.pdf-text-editor').exists()).toBe(false);

    const latestWrite = fetchMock.mock.calls.filter(([url]) => url === '/api/files/write').at(-1);
    const latestBody = JSON.parse(String(latestWrite?.[1]?.body));
    expect(JSON.parse(latestBody.content).pages['1'][1]).toMatchObject({
      type: 'text',
      text: `${longLine}\non two lines`,
      points: [{ x: 0.4, y: 0.4 }],
    });
    expect(context.fillText).toHaveBeenCalledWith('this is a long text, cool, is it?', 240, 320);
    expect(context.fillText).toHaveBeenCalledWith('how does it work?', 240, 340);
    expect(context.fillText).toHaveBeenCalledWith('on two lines', 240, 360);
  });

  it('covers PDF content with a selectable color that defaults to white', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) return { ok: false, status: 404 } as Response;
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Cover PDF content with rectangle"]').trigger('click');
    const colorInput = wrapper.get<HTMLInputElement>('[aria-label="Cover color"]');
    expect(colorInput.element.value).toBe('#ffffff');
    await colorInput.setValue('#3f3f4d');

    const canvas = wrapper.get('.pdf-annotation-canvas');
    await canvas.trigger('pointerdown', { pointerId: 1, clientX: 60, clientY: 80 });
    await canvas.trigger('pointermove', { pointerId: 1, clientX: 180, clientY: 240 });
    await canvas.trigger('pointerup', { pointerId: 1, clientX: 180, clientY: 240 });
    await flushPromises();

    const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
    const body = JSON.parse(String(writeCall?.[1]?.body));
    expect(JSON.parse(body.content).pages['1'][0]).toMatchObject({
      type: 'whiteout',
      color: '#3f3f4d',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
    });
    expect(context.fillRect).toHaveBeenCalledWith(60, 80, 120, 160);
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
    const wrapper = mount(MediaAnnotationPreview, {
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
    const wrapper = mount(MediaAnnotationPreview, {
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

  it.each(['line', 'rectangle', 'ellipse'] as const)(
    'resizes an existing %s annotation by dragging its handle',
    async (type) => {
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
                    type, color: '#ef4444', width: 1,
                    points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
                  }],
                },
              }),
            }),
          } as Response;
        }
        if (url === '/api/files/write' && init?.method === 'POST') {
          return { ok: true, status: 200 } as Response;
        }
        throw new Error(`Unexpected fetch: ${String(url)}`);
      });
      const wrapper = mount(MediaAnnotationPreview, {
        props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
      });
      await flushPromises();
      await wrapper.get('[aria-label="Move annotation"]').trigger('click');

      const canvas = wrapper.get('.pdf-annotation-canvas');
      await canvas.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 180, clientY: 240 });
      await canvas.trigger('pointermove', { pointerId: 1, clientX: 300, clientY: 400 });
      await canvas.trigger('pointerup', { pointerId: 1, clientX: 300, clientY: 400 });
      await flushPromises();

      const writeCall = fetchMock.mock.calls.find(([url]) => url === '/api/files/write');
      const body = JSON.parse(String(writeCall?.[1]?.body));
      expect(JSON.parse(body.content).pages['1'][0].points).toEqual([
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
      ]);
    },
  );

  it('exports a PDF with its annotations flattened into the downloaded copy', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/files/read')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: JSON.stringify({
              version: 1,
              pages: {
                '1': [{
                  type: 'rectangle', color: '#ef4444', width: 2,
                  points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
                }],
              },
            }),
          }),
        } as Response;
      }
      if (url === '/api/files/raw?path=document.pdf') {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:annotated-pdf'),
      revokeObjectURL: vi.fn(),
    });
    let downloadedFilename = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download;
    });

    const wrapper = mount(MediaAnnotationPreview, {
      props: { src: '/api/files/raw?path=document.pdf', filePath: '/project/document.pdf' },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Export annotated PDF"]').trigger('click');
    await flushPromises();

    expect(pdfLibMock.load).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(pdfLibMock.embedPng).toHaveBeenCalledWith('data:image/png;base64,overlay');
    expect(pdfLibMock.drawImage).toHaveBeenCalledWith({}, { x: 0, y: 0, width: 600, height: 800 });
    expect(pdfLibMock.save).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(downloadedFilename).toBe('document-annotated.pdf');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:annotated-pdf');
  });

  it('draws and saves annotations in the hidden annotations directory', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/files/read')) return { ok: false, status: 404 } as Response;
      if (url === '/api/files/write' && init?.method === 'POST') return { ok: true, status: 200 } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });
    const wrapper = mount(MediaAnnotationPreview, {
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
    expect(body.path).toBe('/project/.annotations/document.pdf.annotations.json');
    expect(JSON.parse(body.content).pages['1'][0].points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]);
  });
});
