export interface ExportMarkdownPdfOptions {
  filePath: string;
  html: string;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PDF_MARGIN = 51.02; // 18 mm, matching the existing print export.
const PDF_RENDER_WIDTH = 658;
const MAX_PDF_RENDER_WIDTH = 1600;
const MAX_PDF_CANVAS_DIMENSION = 16_384;
const MAX_PDF_CANVAS_PIXELS = 16_777_216;
const IMAGE_LOAD_TIMEOUT_MS = 10_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getMarkdownPdfFilename(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() || 'document.md';
  const basename = filename.replace(/\.(?:md|markdown|mdown|mkdn|mdx)$/i, '') || 'document';
  return `${basename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.pdf`;
}

export function getMarkdownPdfPath(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return `${filePath.slice(0, separatorIndex + 1)}${getMarkdownPdfFilename(filePath)}`;
}

function markdownFileDirectory(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separatorIndex === -1 ? '' : filePath.slice(0, separatorIndex + 1);
}

function ignoreImage(image: HTMLImageElement): void {
  image.removeAttribute('src');
  image.setAttribute('data-html2canvas-ignore', 'true');
}

function splitLocalImageSource(source: string): { path: string; fragment: string } {
  const fragmentIndex = source.indexOf('#');
  const fragment = fragmentIndex === -1 ? '' : source.slice(fragmentIndex);
  const pathAndQuery = fragmentIndex === -1 ? source : source.slice(0, fragmentIndex);
  const queryIndex = pathAndQuery.indexOf('?');
  const encodedPath = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  try {
    return { path: decodeURIComponent(encodedPath), fragment };
  } catch {
    return { path: encodedPath, fragment };
  }
}

function workspaceImageSource(source: string): { path: string; fragment: string } | undefined {
  const prefix = '/api/files/raw?path=';
  return source.startsWith(prefix) ? splitLocalImageSource(source.slice(prefix.length)) : undefined;
}

function normalizeImageSource(source: string, directory: string): string | undefined {
  if (source.startsWith('data:') || source.startsWith('#')) return source;

  const workspaceSource = workspaceImageSource(source);
  if (workspaceSource) {
    return `/api/files/raw?path=${encodeURIComponent(workspaceSource.path)}${workspaceSource.fragment}`;
  }

  const windowsAbsolutePath = /^[a-z]:[\\/]/i.test(source);
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source) && !windowsAbsolutePath) return undefined;

  const localSource = splitLocalImageSource(source);
  const resolvedPath = source.startsWith('/') || windowsAbsolutePath
    ? localSource.path
    : `${directory}${localSource.path.replace(/^\.\//, '')}`;
  return `/api/files/raw?path=${encodeURIComponent(resolvedPath)}${localSource.fragment}`;
}

export function normalizeMarkdownPdfHtml(html: string, filePath: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const directory = markdownFileDirectory(filePath);

  for (const image of Array.from(template.content.querySelectorAll<HTMLImageElement>('img[src]'))) {
    const source = image.getAttribute('src')?.trim();
    if (!source) continue;
    const normalizedSource = normalizeImageSource(source, directory);
    if (normalizedSource) image.setAttribute('src', normalizedSource);
    else ignoreImage(image);
  }

  for (const element of Array.from(template.content.querySelectorAll(
    'svg image[href], svg use[href], svg image[xlink\\:href], svg use[xlink\\:href]',
  ))) {
    const attribute = element.hasAttribute('href') ? 'href' : 'xlink:href';
    const source = element.getAttribute(attribute)?.trim();
    if (!source) continue;
    const normalizedSource = normalizeImageSource(source, directory);
    if (normalizedSource) element.setAttribute(attribute, normalizedSource);
    else element.removeAttribute(attribute);
  }

  for (const element of Array.from(template.content.querySelectorAll<HTMLElement>('[style]'))) {
    const backgroundImage = element.style.backgroundImage;
    const references = Array.from(backgroundImage.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi));
    let normalizedBackground = backgroundImage;
    for (const reference of references) {
      const normalizedSource = normalizeImageSource(reference[2].trim(), directory);
      if (!normalizedSource) {
        element.style.removeProperty('background-image');
        normalizedBackground = '';
        break;
      }
      normalizedBackground = normalizedBackground.replace(reference[0], `url("${normalizedSource}")`);
    }
    if (normalizedBackground) element.style.backgroundImage = normalizedBackground;
  }

  for (const source of Array.from(template.content.querySelectorAll<HTMLElement>('[srcset]'))) {
    source.removeAttribute('srcset');
  }

  return template.innerHTML;
}

export function getMarkdownPdfRenderWidth(documentWidth: number, bodyWidth: number): number {
  return Math.min(MAX_PDF_RENDER_WIDTH, Math.max(PDF_RENDER_WIDTH, documentWidth, bodyWidth));
}

export function getCanvasPageSlices(canvasWidth: number, canvasHeight: number): Array<{ sourceY: number; sourceHeight: number }> {
  const contentWidth = A4_WIDTH - PDF_MARGIN * 2;
  const contentHeight = A4_HEIGHT - PDF_MARGIN * 2;
  const pageHeight = contentHeight * canvasWidth / contentWidth;
  const pageCount = Math.max(1, Math.ceil(canvasHeight / pageHeight));

  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const sourceY = Math.round(pageIndex * pageHeight);
    const sourceEnd = Math.min(canvasHeight, Math.round((pageIndex + 1) * pageHeight));
    return { sourceY, sourceHeight: sourceEnd - sourceY };
  });
}

export function getMarkdownPdfRenderChunks(
  width: number,
  height: number,
  scale: number,
): Array<{
  sourceY: number;
  sourceHeight: number;
  pages: Array<{ sourceY: number; sourceHeight: number }>;
}> {
  const maxHeight = Math.floor(Math.min(
    MAX_PDF_CANVAS_DIMENSION / scale,
    MAX_PDF_CANVAS_PIXELS / (width * scale * scale),
  ));
  const chunks: Array<{
    sourceY: number;
    sourceHeight: number;
    pages: Array<{ sourceY: number; sourceHeight: number }>;
  }> = [];

  for (const page of getCanvasPageSlices(width, height)) {
    const chunk = chunks.at(-1);
    if (!chunk || page.sourceY + page.sourceHeight - chunk.sourceY > maxHeight) {
      chunks.push({ sourceY: page.sourceY, sourceHeight: page.sourceHeight, pages: [page] });
    } else {
      chunk.sourceHeight = page.sourceY + page.sourceHeight - chunk.sourceY;
      chunk.pages.push(page);
    }
  }

  return chunks;
}

export function buildMarkdownPrintDocument(options: ExportMarkdownPdfOptions): string {
  const filename = getMarkdownPdfFilename(options.filePath);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(filename)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1f2328; background: #fff; font: 14px/1.6 Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
    h1, h2, h3, h4, h5, h6 { margin: 1.5em 0 .65em; line-height: 1.25; break-after: avoid; }
    h1, h2 { padding-bottom: .3em; border-bottom: 1px solid #d0d7de; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1rem; }
    a { color: #0969da; }
    blockquote { padding: 0 1rem; color: #59636e; border-left: 4px solid #d0d7de; }
    code { padding: .15rem .3rem; border-radius: 4px; background: #eff1f3; font-family: "SFMono-Regular", Consolas, "Liberation Mono", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace; }
    pre { padding: 1rem; overflow: visible; white-space: pre-wrap; background: #f6f8fa; break-inside: avoid-page; }
    pre code { padding: 0; background: transparent; }
    img, svg { max-width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; break-inside: avoid-page; }
    th, td { padding: .4rem .65rem; border: 1px solid #d0d7de; text-align: left; }
    tbody tr:nth-child(2n) { background: #f6f8fa; }
    .markdown-frontmatter th { width: 1%; white-space: nowrap; }
    .mermaid-diagram { text-align: center; break-inside: avoid-page; }
  </style>
</head>
<body>${options.html}</body>
</html>`;
}

export async function waitForMarkdownPdfImages(
  printDocument: Document,
  timeoutMs = IMAGE_LOAD_TIMEOUT_MS,
): Promise<void> {
  const images = Array.from(printDocument.querySelectorAll('img'));
  await Promise.all(images.map(image => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timeout);
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        resolve();
      };
      const timeout = setTimeout(finish, timeoutMs);
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
    });
  }));

  for (const image of images) {
    if (image.naturalWidth === 0) image.setAttribute('data-html2canvas-ignore', 'true');
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function inlineMarkdownPdfImages(renderDocument: Document): Promise<void> {
  const images = Array.from(renderDocument.querySelectorAll<HTMLImageElement>('img[src]'));
  const sources = new Map<string, Promise<string | undefined>>();

  for (const image of images) {
    const source = image.getAttribute('src');
    if (!source || source.startsWith('data:')) continue;
    const fragmentIndex = source.indexOf('#');
    const requestSource = fragmentIndex === -1 ? source : source.slice(0, fragmentIndex);
    const fragment = fragmentIndex === -1 ? '' : source.slice(fragmentIndex);
    let encodedSource = sources.get(source);
    if (!encodedSource) {
      encodedSource = fetch(requestSource)
        .then(async response => {
          if (!response.ok) return undefined;
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          const bytes = new Uint8Array(await response.arrayBuffer());
          return `data:${contentType};base64,${bytesToBase64(bytes)}${fragment}`;
        })
        .catch(() => undefined);
      sources.set(source, encodedSource);
    }
    const dataSource = await encodedSource;
    if (dataSource) image.src = dataSource;
  }
}

export async function createMarkdownPdfCopy(options: ExportMarkdownPdfOptions): Promise<string> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-10000px;bottom:0;width:658px;border:0;opacity:0;pointer-events:none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  try {
    const renderDocument = iframe.contentDocument;
    if (!renderDocument) throw new Error('Could not create Markdown PDF render frame.');
    renderDocument.open();
    renderDocument.write(buildMarkdownPrintDocument({
      ...options,
      html: normalizeMarkdownPdfHtml(options.html, options.filePath),
    }));
    renderDocument.close();
    await inlineMarkdownPdfImages(renderDocument);
    await waitForMarkdownPdfImages(renderDocument);
    await renderDocument.fonts?.ready;

    const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([
      import('html2canvas'),
      import('pdf-lib'),
    ]);
    const pdf = await PDFDocument.create();
    const contentWidth = A4_WIDTH - PDF_MARGIN * 2;
    const renderWidth = getMarkdownPdfRenderWidth(
      renderDocument.documentElement.scrollWidth,
      renderDocument.body.scrollWidth,
    );
    const renderHeight = Math.max(
      renderDocument.documentElement.scrollHeight,
      renderDocument.body.scrollHeight,
      1,
    );

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    for (const chunk of getMarkdownPdfRenderChunks(renderWidth, renderHeight, scale)) {
      const canvas = await html2canvas(renderDocument.body, {
        backgroundColor: '#ffffff',
        height: chunk.sourceHeight,
        logging: false,
        scale,
        useCORS: true,
        width: renderWidth,
        windowHeight: chunk.sourceHeight,
        windowWidth: renderWidth,
        x: 0,
        y: chunk.sourceY,
      });
      const renderedScale = canvas.height / chunk.sourceHeight;

      for (const pageSlice of chunk.pages) {
        const sourceY = Math.round((pageSlice.sourceY - chunk.sourceY) * renderedScale);
        const sourceEnd = Math.round(
          (pageSlice.sourceY + pageSlice.sourceHeight - chunk.sourceY) * renderedScale,
        );
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceEnd - sourceY;
        const context = pageCanvas.getContext('2d');
        if (!context) throw new Error('Could not create Markdown PDF page canvas.');
        context.drawImage(
          canvas,
          0,
          sourceY,
          canvas.width,
          pageCanvas.height,
          0,
          0,
          canvas.width,
          pageCanvas.height,
        );

        const image = await pdf.embedPng(pageCanvas.toDataURL('image/png'));
        const imageHeight = pageCanvas.height * contentWidth / pageCanvas.width;
        const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
        page.drawImage(image, {
          x: PDF_MARGIN,
          y: A4_HEIGHT - PDF_MARGIN - imageHeight,
          width: contentWidth,
          height: imageHeight,
        });
      }
    }

    const path = getMarkdownPdfPath(options.filePath);
    const response = await fetch('/api/files/create-binary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: bytesToBase64(await pdf.save()) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return path;
  } finally {
    iframe.remove();
  }
}

export async function exportMarkdownPdf(options: ExportMarkdownPdfOptions): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-10000px;bottom:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  const printDocument = iframe.contentDocument;
  if (!printWindow || !printDocument) {
    iframe.remove();
    throw new Error('Could not create Markdown PDF print frame.');
  }

  printDocument.open();
  printDocument.write(buildMarkdownPrintDocument({
    ...options,
    html: normalizeMarkdownPdfHtml(options.html, options.filePath),
  }));
  printDocument.close();
  await waitForMarkdownPdfImages(printDocument);

  // Chromium derives an iframe print job's suggested filename from the parent
  // tab title, so expose the Markdown filename until the print job finishes.
  const originalTitle = document.title;
  document.title = getMarkdownPdfFilename(options.filePath);
  const cleanup = () => {
    document.title = originalTitle;
    window.setTimeout(() => iframe.remove(), 0);
  };
  const fallbackCleanup = window.setTimeout(cleanup, 60_000);
  printWindow.addEventListener('afterprint', () => {
    window.clearTimeout(fallbackCleanup);
    cleanup();
  }, { once: true });

  try {
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    window.clearTimeout(fallbackCleanup);
    cleanup();
    throw error;
  }
}
