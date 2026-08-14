import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { saveWeixinImage } from './weixin-image-store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('saveWeixinImage', () => {
  it('saves downloaded WeChat image bytes under the project wechat_images folder', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pi-weixin-image-'));
    tempDirs.push(projectRoot);
    const bytes = Buffer.from('image bytes');

    const savedPath = await saveWeixinImage(projectRoot, '7492129567365607000', 1, 'image/jpeg', bytes, new Date('2026-08-09T12:34:56Z'));

    expect(savedPath).toBe(join(projectRoot, 'wechat_images', '20260809-123456-7492129567365607000-1.jpg'));
    await expect(readFile(savedPath)).resolves.toEqual(bytes);
  });
});
