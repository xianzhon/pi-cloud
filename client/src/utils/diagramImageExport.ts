export function getDiagramImageFilename(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() || 'diagram.mmd';
  const basename = filename.replace(/\.mmd$/i, '') || 'diagram';
  return `${basename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.svg`;
}

export function exportDiagramImage(filePath: string, svg: SVGSVGElement, theme: 'dark' | 'light' = 'light'): void {
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

  const blob = new Blob([new XMLSerializer().serializeToString(exportedSvg)], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getDiagramImageFilename(filePath);
  link.click();
  URL.revokeObjectURL(url);
}
