import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { formatFileSize, useChatAttachments } from './useChatAttachments';

const translate = (key: string, params?: Record<string, unknown>) => `${key}:${params?.name ?? ''}`;

describe('useChatAttachments', () => {
  it('accepts supported images and reports rejected file types', async () => {
    const controller = useChatAttachments(translate);
    const image = new File(['image data'], 'diagram.png', { type: 'image/png' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    await controller.addImageFiles([image, text]);

    expect(controller.attachments.value).toHaveLength(1);
    expect(controller.attachments.value[0]).toMatchObject({
      name: 'diagram.png',
      mimeType: 'image/png',
      type: 'image',
    });
    expect(controller.attachmentError.value).toContain('unsupportedImage:notes.txt');
  });

  it('rejects oversized images and enforces the twenty-image limit', async () => {
    const controller = useChatAttachments(translate);
    await controller.addImageFiles([new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]);
    expect(controller.attachmentError.value).toContain('imageTooLarge:large.png');
    const images = Array.from({ length: 21 }, (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }));
    await controller.addImageFiles(images);
    expect(controller.attachments.value).toHaveLength(20);
    expect(controller.attachmentError.value).toContain('imageCountLimit');
  });

  it('handles input, paste, drag, leave, and drop events', async () => {
    const controller = useChatAttachments(translate);
    const image = new File(['x'], 'a.png', { type: 'image/png' });
    const input = { files: [image], value: 'selected' } as any;
    controller.handleImageInput({ target: input } as any);
    await vi.waitFor(() => expect(input.value).toBe(''));
    const preventDefault = vi.fn();
    controller.handleImagePaste({ clipboardData: { files: [] }, preventDefault } as any);
    controller.handleImagePaste({ clipboardData: { files: [image] }, preventDefault } as any);
    expect(preventDefault).toHaveBeenCalled();
    controller.handleImageDrag({ dataTransfer: { items: [{ kind: 'file', type: 'image/png' }] } } as any);
    expect(controller.isDraggingImages.value).toBe(true);
    controller.handleDragLeave({ currentTarget: document.body, relatedTarget: null } as any);
    expect(controller.isDraggingImages.value).toBe(false);
    controller.handleImageDrop({ dataTransfer: { files: [image] } } as any);
    await vi.waitFor(() => expect(controller.attachments.value.length).toBeGreaterThan(1));
  });

  it('pastes all embedded images and inserts accompanying text at the selection', async () => {
    const controller = useChatAttachments(translate);
    const target = document.createElement('textarea');
    target.value = 'Before replace after';
    target.setSelectionRange(7, 14);
    const onInput = vi.fn();
    target.addEventListener('input', onInput);
    const preventDefault = vi.fn();
    controller.handleImagePaste({
      target,
      preventDefault,
      clipboardData: {
        files: [new File(['duplicate'], 'native.png', { type: 'image/png' })],
        getData: (type: string) => type === 'text/plain' ? 'prompt' : '<img src="data:image/png;base64,cG5n" alt="one.png"><img src="data:image/jpeg;base64,anBlZw==" alt="two.jpg">',
      },
    } as any);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(target.value).toBe('Before prompt after');
    expect(onInput).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(controller.attachments.value).toHaveLength(2));
    expect(controller.attachments.value.map((image) => image.name)).toEqual(['one.png', 'two.jpg']);
  });

  it('leaves ordinary text pasting to the browser', () => {
    const controller = useChatAttachments(translate);
    const preventDefault = vi.fn();
    controller.handleImagePaste({ clipboardData: { files: [], getData: () => 'text' }, preventDefault } as any);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('formats byte, kilobyte, and megabyte sizes', () => {
    expect(formatFileSize(12)).toBe('12 B');
    expect(formatFileSize(1025)).toBe('2 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('closes the preview when Escape is pressed and clears accepted attachments', async () => {
    const controller = useChatAttachments(translate);
    const image = new File(['x'], 'a.png', { type: 'image/png' });
    await controller.addImageFiles([image, image]);
    controller.openAttachmentPreview(controller.attachments.value[0]);
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(controller.attachmentPreview.value).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(controller.attachmentPreview.value).toBeNull();
    controller.clearAcceptedAttachments([controller.attachments.value[0]]);
    expect(controller.attachments.value).toHaveLength(1);
    controller.clearAcceptedAttachments([]);
  });

  it('closes the preview when its attachment is removed', () => {
    const controller = useChatAttachments(translate);
    const attachment = {
      id: 'image-1',
      type: 'image' as const,
      data: 'aW1hZ2U=',
      mimeType: 'image/png',
      name: 'diagram.png',
      size: 5,
      previewUrl: 'data:image/png;base64,aW1hZ2U=',
    };
    controller.attachments.value = [attachment];
    controller.openAttachmentPreview(attachment);

    controller.removeAttachment('image-1');

    expect(controller.attachments.value).toEqual([]);
    expect(controller.attachmentPreview.value).toBeNull();
  });
});
