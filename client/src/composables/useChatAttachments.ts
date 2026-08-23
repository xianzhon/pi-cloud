import { ref, watch } from 'vue';
import type { ChatImage } from './useChat';

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface PendingAttachment extends ChatImage {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0 || !result.slice(comma + 1)) reject(new Error('read failed'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function useChatAttachments(t: Translate) {
  const attachments = ref<PendingAttachment[]>([]);
  const attachmentPreview = ref<PendingAttachment | null>(null);
  const attachmentError = ref('');
  const isDraggingImages = ref(false);

  async function addImageFiles(files: Iterable<File>): Promise<void> {
    const errors: string[] = [];
    attachmentError.value = '';

    for (const file of files) {
      if (!IMAGE_MIME_TYPES.has(file.type)) {
        errors.push(t('components.chatPanel.unsupportedImage', { name: file.name }));
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(t('components.chatPanel.imageTooLarge', { name: file.name }));
        continue;
      }
      if (attachments.value.length >= MAX_IMAGE_COUNT) {
        errors.push(t('components.chatPanel.youCanAttachUpTo4Images'));
        continue;
      }

      try {
        const data = await readImage(file);
        attachments.value.push({
          id: `${Date.now()}-${Math.random()}`,
          type: 'image',
          data,
          mimeType: file.type,
          name: file.name,
          size: file.size,
          previewUrl: `data:${file.type};base64,${data}`,
        });
      } catch {
        errors.push(t('components.chatPanel.theImageCouldNotBeReadTry'));
      }
    }

    attachmentError.value = Array.from(new Set(errors)).join(' ');
  }

  function handleImageInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    void addImageFiles(Array.from(input.files || [])).finally(() => { input.value = ''; });
  }

  function handleImagePaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void addImageFiles(files);
  }

  function handleImageDrag(event: DragEvent): void {
    const items = Array.from(event.dataTransfer?.items || []);
    isDraggingImages.value = items.some((item) => item.kind === 'file' && IMAGE_MIME_TYPES.has(item.type));
  }

  function handleDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) isDraggingImages.value = false;
  }

  function handleImageDrop(event: DragEvent): void {
    isDraggingImages.value = false;
    void addImageFiles(Array.from(event.dataTransfer?.files || []));
  }

  function removeAttachment(id: string): void {
    attachments.value = attachments.value.filter((attachment) => attachment.id !== id);
    attachmentError.value = '';
    if (attachmentPreview.value?.id === id) closeAttachmentPreview();
  }

  function openAttachmentPreview(attachment: PendingAttachment): void {
    attachmentPreview.value = attachment;
  }

  function closeAttachmentPreview(): void {
    attachmentPreview.value = null;
  }

  function handleAttachmentPreviewKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeAttachmentPreview();
  }

  watch(attachmentPreview, (preview, _previous, onCleanup) => {
    if (!preview) return;
    window.addEventListener('keydown', handleAttachmentPreviewKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleAttachmentPreviewKeydown));
  });

  function clearAcceptedAttachments(imageDraft: PendingAttachment[]): void {
    if (imageDraft.length) {
      const acceptedIds = new Set(imageDraft.map((image) => image.id));
      attachments.value = attachments.value.filter((attachment) => !acceptedIds.has(attachment.id));
    }
    attachmentError.value = '';
  }

  return {
    attachments,
    attachmentPreview,
    attachmentError,
    isDraggingImages,
    addImageFiles,
    handleImageInput,
    handleImagePaste,
    handleImageDrag,
    handleDragLeave,
    handleImageDrop,
    removeAttachment,
    openAttachmentPreview,
    closeAttachmentPreview,
    clearAcceptedAttachments,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
