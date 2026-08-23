import { describe, expect, it } from 'vitest';
import { useChatAttachments } from './useChatAttachments';

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
