import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveUploadedImages } from './uploaded-image-store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('saveUploadedImages', () => {
  it('saves images under tmp/upload_images without overwriting an existing upload', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pi-uploaded-image-'));
    tempDirs.push(projectRoot);
    const first = { type: 'image' as const, data: Buffer.from('first').toString('base64'), mimeType: 'image/png' as const };
    const second = { ...first, data: Buffer.from('second').toString('base64') };

    const now = new Date(2026, 7, 13, 14, 30, 52);
    const [firstPath] = await saveUploadedImages(projectRoot, [first], ['../daily chart.jpeg'], now);
    const [secondPath] = await saveUploadedImages(projectRoot, [second], ['../daily chart.jpeg'], now);

    expect(firstPath).toBe(join(projectRoot, 'tmp', 'upload_images', 'daily chart-20260813-143052.png'));
    expect(secondPath).toBe(join(projectRoot, 'tmp', 'upload_images', 'daily chart-20260813-143052-2.png'));
    await expect(readFile(firstPath, 'utf8')).resolves.toBe('first');
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('second');
  });
});
