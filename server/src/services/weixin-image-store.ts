import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function saveWeixinImage(projectRoot: string, messageId: string, index: number, mimeType: string, bytes: Buffer, now = new Date()): Promise<string> {
  const directory = join(projectRoot, 'wechat_images');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${formatTimestamp(now)}-${safeFilenamePart(messageId)}-${index}.${extensionForMimeType(mimeType)}`);
  await writeFile(path, bytes);
  return path;
}

function formatTimestamp(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  const second = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
}
