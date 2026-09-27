type DiagramImageFormat = 'svg' | 'png';
type DiagramTheme = 'dark' | 'light';

export function getDiagramImageFilename(filePath: string, format: DiagramImageFormat = 'svg'): string {
  const filename = filePath.split(/[\\/]/).pop() || 'diagram.mmd';
  const basename = filename.replace(/\.mmd$/i, '') || 'diagram';
  return `${basename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.${format}`;
}

function prepareSvg(svg: SVGSVGElement, theme: DiagramTheme): SVGSVGElement {
  const exportedSvg = svg.cloneNode(true) as SVGSVGElement;
  exportedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  exportedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  if (theme === 'dark') {
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', '#0f0f14');
    exportedSvg.insertBefore(background, exportedSvg.firstChild);
  }

  const bounds = svg.getBoundingClientRect();
  if (!exportedSvg.hasAttribute('width') && bounds.width) exportedSvg.setAttribute('width', String(bounds.width));
  if (!exportedSvg.hasAttribute('height') && bounds.height) exportedSvg.setAttribute('height', String(bounds.height));
  return exportedSvg;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportDiagramImage(filePath: string, svg: SVGSVGElement, theme: DiagramTheme = 'light'): void {
  const exportedSvg = prepareSvg(svg, theme);
  const blob = new Blob([new XMLSerializer().serializeToString(exportedSvg)], {
    type: 'image/svg+xml;charset=utf-8',
  });
  downloadBlob(blob, getDiagramImageFilename(filePath));
}

export async function exportDiagramPng(filePath: string, svg: SVGSVGElement, theme: DiagramTheme = 'light'): Promise<void> {
  const exportedSvg = prepareSvg(svg, theme);
  const bounds = svg.getBoundingClientRect();
  const width = Math.ceil(svg.viewBox.baseVal.width || bounds.width);
  const height = Math.ceil(svg.viewBox.baseVal.height || bounds.height);
  if (!width || !height) throw new Error('Diagram has no exportable dimensions');

  exportedSvg.setAttribute('width', String(width));
  exportedSvg.setAttribute('height', String(height));
  const source = new Blob([new XMLSerializer().serializeToString(exportedSvg)], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(source);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render diagram as PNG'));
      image.src = sourceUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create PNG canvas');
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create PNG image')), 'image/png');
    });
    downloadBlob(png, getDiagramImageFilename(filePath, 'png'));
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
