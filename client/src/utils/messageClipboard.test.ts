import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyMessage, pastedImageFiles } from './messageClipboard';

const images = [
  { type: 'image' as const, mimeType: 'image/png', data: 'cG5n', name: 'chart.png' },
  { type: 'image' as const, mimeType: 'image/jpeg', data: 'anBlZw==', name: 'photo.jpg' },
];

afterEach(() => vi.unstubAllGlobals());

function clipboard() {
  const write = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { write, writeText } });
  vi.stubGlobal('ClipboardItem', class {
    constructor(public data: Record<string, Blob>) {}
  });
  return { write, writeText };
}

describe('message clipboard', () => {
  it('keeps text-only copying unchanged', async () => {
    const { write, writeText } = clipboard();
    expect(await copyMessage('original\ntext', [])).toBe(true);
    expect(writeText).toHaveBeenCalledWith('original\ntext');
    expect(write).not.toHaveBeenCalled();
  });

  it('copies text and all images in one item with a native PNG', async () => {
    const { write, writeText } = clipboard();
    const text = '<script>not HTML</script>\nCompare these';
    expect(await copyMessage(text, images)).toBe(true);
    const items = write.mock.calls[0][0];
    expect(items).toHaveLength(1);
    const data = items[0].data;
    expect(await data['text/plain'].text()).toBe(text);
    const html = await data['text/html'].text();
    expect(html).toContain('&lt;script&gt;');
    expect(pastedImageFiles(html).map((file) => [file.name, file.type, file.size])).toEqual([
      ['chart.png', 'image/png', 3], ['photo.jpg', 'image/jpeg', 4],
    ]);
    expect(data['image/png'].type).toBe('image/png');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies image-only and non-PNG messages as rich content', async () => {
    const { write } = clipboard();
    expect(await copyMessage('', [images[1]])).toBe(true);
    expect(write.mock.calls[0][0][0].data['image/png']).toBeUndefined();
    expect(pastedImageFiles(await write.mock.calls[0][0][0].data['text/html'].text())).toHaveLength(1);
  });

  it.each(['missing API', 'rejected write'])('falls back to text for %s', async (reason) => {
    const { write, writeText } = clipboard();
    if (reason === 'missing API') vi.stubGlobal('ClipboardItem', undefined);
    else write.mockRejectedValue(new Error('Not supported'));
    expect(await copyMessage('prompt', images)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('prompt');
    expect(await copyMessage('', images)).toBe(false);
  });

  it('ignores remote, unsupported and malformed images', () => {
    expect(pastedImageFiles('<img src="https://example.com/a.png"><img src="data:image/svg+xml;base64,eA=="><img src="data:image/png;base64,a">')).toEqual([]);
  });
});
