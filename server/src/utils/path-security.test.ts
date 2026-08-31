import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAllowedExistingPath, resolveAllowedPath } from './path-security.js';

describe('path security', () => {
  afterEach(() => {
    delete process.env.PI_CLOUD_ALLOWED_ROOTS;
    delete process.env.PI_CLOUD_DISABLE_PATH_CHECK;
    vi.restoreAllMocks();
  });

  it('allows home directory paths by default for the existing file tree and terminal UI', async () => {
    await expect(resolveAllowedPath('~')).resolves.toBe(os.homedir());
  });

  it('rejects paths outside configured allowed roots when the check is enabled', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-outside-'));
    process.env.PI_CLOUD_ALLOWED_ROOTS = allowedDir;
    process.env.PI_CLOUD_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedPath(outsideDir)).rejects.toThrow('Path is outside the configured allowed roots');
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects outside paths before checking whether they exist', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-allowed-'));
    const outsidePath = path.join(os.tmpdir(), 'pi-cloud-missing', 'file.txt');
    process.env.PI_CLOUD_ALLOWED_ROOTS = allowedDir;
    process.env.PI_CLOUD_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedExistingPath(outsidePath)).rejects.toThrow(
        'Path is outside the configured allowed roots',
      );
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
    }
  });

  it('returns the canonical path for existing symlinks within an allowed root', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-allowed-'));
    const targetDir = path.join(allowedDir, 'target');
    const linkedDir = path.join(allowedDir, 'link');
    await fs.mkdir(targetDir);
    await fs.symlink(targetDir, linkedDir);
    process.env.PI_CLOUD_ALLOWED_ROOTS = allowedDir;
    process.env.PI_CLOUD_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedExistingPath(linkedDir)).resolves.toBe(await fs.realpath(targetDir));
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
    }
  });

  it('rejects existing symlinks that resolve outside an allowed root', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-outside-'));
    const linkedDir = path.join(allowedDir, 'link');
    await fs.symlink(outsideDir, linkedDir);
    process.env.PI_CLOUD_ALLOWED_ROOTS = allowedDir;
    process.env.PI_CLOUD_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedExistingPath(linkedDir)).rejects.toThrow('Path is outside the configured allowed roots');
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('allows paths outside configured roots when the check is explicitly disabled', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-outside-'));
    process.env.PI_CLOUD_ALLOWED_ROOTS = allowedDir;
    process.env.PI_CLOUD_DISABLE_PATH_CHECK = 'true';

    try {
      await expect(resolveAllowedPath(outsideDir)).resolves.toBe(path.resolve(outsideDir));
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('disables the path check by default on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    process.env.PI_CLOUD_ALLOWED_ROOTS = 'C:\\Users\\test';

    await expect(resolveAllowedPath('D:\\Projects')).resolves.toBe(path.resolve('D:\\Projects'));
  });

  it('allows Windows users to explicitly enable the path check', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-outside-'));
    process.env.PI_CLOUD_ALLOWED_ROOTS = allowedDir;
    process.env.PI_CLOUD_DISABLE_PATH_CHECK = 'false';

    try {
      await expect(resolveAllowedPath(outsideDir)).rejects.toThrow('Path is outside the configured allowed roots');
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
