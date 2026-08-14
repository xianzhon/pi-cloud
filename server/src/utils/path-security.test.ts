import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAllowedPath } from './path-security.js';

describe('path security', () => {
  afterEach(() => {
    delete process.env.PI_WEBUI_ALLOWED_ROOTS;
    delete process.env.PI_WEBUI_DISABLE_PATH_CHECK;
    vi.restoreAllMocks();
  });

  it('allows home directory paths by default for the existing file tree and terminal UI', async () => {
    await expect(resolveAllowedPath('~')).resolves.toBe(os.homedir());
  });

  it('rejects paths outside configured allowed roots when the check is enabled', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-outside-'));
    process.env.PI_WEBUI_ALLOWED_ROOTS = allowedDir;
    process.env.PI_WEBUI_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedPath(outsideDir)).rejects.toThrow('Path is outside the configured allowed roots');
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('allows paths outside configured roots when the check is explicitly disabled', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-outside-'));
    process.env.PI_WEBUI_ALLOWED_ROOTS = allowedDir;
    process.env.PI_WEBUI_DISABLE_PATH_CHECK = 'true';

    try {
      await expect(resolveAllowedPath(outsideDir)).resolves.toBe(path.resolve(outsideDir));
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('disables the path check by default on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    process.env.PI_WEBUI_ALLOWED_ROOTS = 'C:\\Users\\test';

    await expect(resolveAllowedPath('D:\\Projects')).resolves.toBe(path.resolve('D:\\Projects'));
  });

  it('allows Windows users to explicitly enable the path check', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piui-outside-'));
    process.env.PI_WEBUI_ALLOWED_ROOTS = allowedDir;
    process.env.PI_WEBUI_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedPath(outsideDir)).rejects.toThrow('Path is outside the configured allowed roots');
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
