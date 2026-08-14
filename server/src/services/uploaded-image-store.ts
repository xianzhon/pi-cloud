import type { ImageContent } from '@earendil-works/pi-ai';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const UPLOAD_DIRECTORY = ['tmp', 'upload_images'] as const;

export async function saveUploadedImages(
  projectRoot: string,
  images: readonly ImageContent[],
  names: readonly (string | undefined)[] = [],
  now = new Date(),
): Promise<string[]> {
  const directory = join(projectRoot, ...UPLOAD_DIRECTORY);
  const timestamp = formatLocalTimestamp(now);
  await mkdir(directory, { recursive: true });

  return Promise.all(images.map((image, index) => saveWithoutOverwrite(
    directory,
    safeImageName(names[index], image.mimeType, index, timestamp),
    Buffer.from(image.data, 'base64'),
  )));
}

async function saveWithoutOverwrite(directory: string, filename: string, bytes: Buffer): Promise<string> {
  const extension = extname(filename);
  const stem = filename.slice(0, -extension.length);

  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(directory, suffix === 1 ? filename : `${stem}-${suffix}${extension}`);
    try {
      await writeFile(candidate, bytes, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

function safeImageName(name: string | undefined, mimeType: string, index: number, timestamp: string): string {
  const originalStem = name ? basename(name, extname(name)) : `uploaded-image-${index + 1}`;
  const safeStem = originalStem
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 100) || `uploaded-image-${index + 1}`;
  return `${safeStem}-${timestamp}.${extensionForMimeType(mimeType)}`;
}

function formatLocalTimestamp(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  const second = String(value.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
}
