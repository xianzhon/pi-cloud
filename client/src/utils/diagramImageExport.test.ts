import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportDiagramImage, getDiagramImageFilename } from './diagramImageExport';

describe('diagram image export', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a safe SVG filename from an mmd path', () => {
    expect(getDiagramImageFilename('/project/architecture.mmd')).toBe('architecture.svg');
    expect(getDiagramImageFilename('bad:name.MMD')).toBe('bad_name.svg');
  });

  it('downloads a standalone SVG with its rendered dimensions', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = '<text>Diagram</text>';
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 360 } as DOMRect);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    exportDiagramImage('/project/system.mmd', svg);

    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const exported = await blob.text();
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    expect(exported).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(exported).toContain('width="640"');
    expect(exported).toContain('height="360"');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagram');
  });

  it('adds the preview background to dark-mode exports', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = '<text>Diagram</text>';
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    exportDiagramImage('/project/system.mmd', svg, 'dark');

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const exported = await blob.text();
    expect(exported).toContain('<rect width="100%" height="100%" fill="#0f0f14"/>');
    expect(exported.indexOf('<rect')).toBeLessThan(exported.indexOf('<text'));
  });
});
