import type { ImageContent } from '@earendil-works/pi-ai';

export const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_IMAGE_COUNT = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageValidationResult =
  | { ok: true; images: ImageContent[]; names: (string | undefined)[] }
  | { ok: false; code: string; message: string };

function invalidImage(message = 'The image could not be read. Try selecting it again.'): ImageValidationResult {
  return { ok: false, code: 'image_malformed', message };
}

export function sniffImageMimeType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

export function validateImages(value: unknown, model: { input?: readonly string[] } | undefined): ImageValidationResult {
  if (value === undefined) return { ok: true, images: [], names: [] };
  if (!Array.isArray(value)) return invalidImage('Images must be sent as an array.');
  if (value.length > MAX_IMAGE_COUNT) {
    return { ok: false, code: 'image_limit_exceeded', message: 'You can attach up to 4 images.' };
  }
  if (value.length && !model?.input?.includes('image')) {
    return { ok: false, code: 'model_image_unsupported', message: 'This model can’t read images. Switch to an image-capable model or remove the images.' };
  }

  const images: ImageContent[] = [];
  const names: (string | undefined)[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return invalidImage();
    const { type, data, mimeType, name } = entry as Record<string, unknown>;
    if (type !== 'image' || typeof data !== 'string' || typeof mimeType !== 'string' || !data.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
      return invalidImage();
    }
    const decoded = Buffer.from(data, 'base64');
    // Node's decoder is permissive, so require a canonical round trip before trusting the bytes.
    if (decoded.toString('base64') !== data) return invalidImage();
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      return { ok: false, code: 'image_type_unsupported', message: 'The image type isn’t supported. Choose PNG, JPEG, WebP, or GIF.' };
    }
    if (decoded.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, code: 'image_too_large', message: 'An image is larger than 10 MB.' };
    }
    const sniffedMimeType = sniffImageMimeType(decoded);
    if (!sniffedMimeType || sniffedMimeType !== mimeType) return invalidImage();
    images.push({ type: 'image', data, mimeType });
    names.push(typeof name === 'string' && name.trim() ? name : undefined);
  }
  return { ok: true, images, names };
}
