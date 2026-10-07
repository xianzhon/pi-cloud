import type { ChatImage } from '../composables/useChat';

function imageFile(image: ChatImage): File {
  const bytes = Uint8Array.from(atob(image.data), (character) => character.charCodeAt(0));
  return new File([bytes], image.name || 'image', { type: image.mimeType });
}

export async function copyMessage(text: string, images: ChatImage[]): Promise<boolean> {
  if (images.length && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const container = document.createElement('div');
      const prompt = document.createElement('pre');
      prompt.textContent = text;
      container.append(prompt);
      for (const image of images) {
        const element = document.createElement('img');
        element.src = `data:${image.mimeType};base64,${image.data}`;
        element.alt = image.name || '';
        container.append(element);
      }
      const data: Record<string, Blob> = {
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([container.outerHTML], { type: 'text/html' }),
      };
      // A single item avoids browsers that reject multiple clipboard items.
      // HTML retains all images; a native PNG also works in image-only destinations.
      const png = images.find((image) => image.mimeType === 'image/png');
      if (png) data['image/png'] = imageFile(png);
      await navigator.clipboard.write([new ClipboardItem(data)]);
      return true;
    } catch {
      // Rich clipboard writes can be unsupported or denied even when the API exists.
    }
  }
  if (!text) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

export function pastedImageFiles(html: string): File[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(parsed.querySelectorAll('img')).flatMap((image) => {
    // Only embedded supported images are read. Never fetch clipboard URLs.
    const match = image.getAttribute('src')?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) return [];
    try {
      return [imageFile({ type: 'image', mimeType: match[1], data: match[2], name: image.alt || undefined })];
    } catch {
      return [];
    }
  });
}
