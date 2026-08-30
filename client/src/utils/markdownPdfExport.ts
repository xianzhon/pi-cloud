export interface ExportMarkdownPdfOptions {
  filePath: string;
  html: string;
}

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

async function waitForImages(printDocument: Document): Promise<void> {
  await Promise.all(Array.from(printDocument.images, image => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
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
  printDocument.write(buildMarkdownPrintDocument(options));
  printDocument.close();
  await waitForImages(printDocument);

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
