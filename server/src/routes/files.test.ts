import Fastify from 'fastify';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { ZipArchive } from 'archiver';
import { pack } from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileRoutes, getSystemOpenCommand } from './files';

async function streamBuffer(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

async function createZip(entries: Record<string, string>): Promise<Buffer> {
  const archive = new ZipArchive();
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  void archive.finalize();
  return streamBuffer(archive as unknown as AsyncIterable<unknown>);
}

async function createTar(entries: Record<string, string>): Promise<Buffer> {
  const archive = pack();
  for (const [name, content] of Object.entries(entries)) archive.entry({ name }, content);
  archive.finalize();
  return streamBuffer(archive);
}

async function buildApp() {
  const app = Fastify();
  await app.register(fileRoutes, { prefix: '/api/files' });
  return app;
}

describe('getSystemOpenCommand', () => {
  it('passes Windows file paths with shell metacharacters as one non-shell argument', () => {
    const filePath = String.raw`C:\workspace\report & calc.exe.txt`;

    expect(getSystemOpenCommand(filePath, 'win32')).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', filePath],
    });
  });
});

describe('fileRoutes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-files-'));
    process.env.PI_CLOUD_ALLOWED_ROOTS = tempDir;
    app = await buildApp();
    await fs.mkdir(path.join(tempDir, 'src'));
    await fs.mkdir(path.join(tempDir, 'node_modules'));
    await fs.writeFile(path.join(tempDir, 'README.md'), 'readme', 'utf8');
    await fs.writeFile(path.join(tempDir, '.hidden'), 'hidden', 'utf8');
    await fs.writeFile(path.join(tempDir, 'src', 'main.ts'), 'console.log("hi");', 'utf8');
    await fs.writeFile(path.join(tempDir, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
  });

  afterEach(async () => {
    await app.close();
    delete process.env.PI_CLOUD_ALLOWED_ROOTS;
    delete process.env.PI_CLOUD_ENABLE_SYSTEM_OPEN;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns a sorted tree and excludes hidden files and node_modules by default', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/tree?path=${encodeURIComponent(tempDir)}&depth=2`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.path).toBe(tempDir);
    expect(body.parentPath).toBe(path.dirname(tempDir));
    expect(body.tree.map((node: { name: string }) => node.name)).toEqual(['src', 'README.md']);
    expect(body.tree[0]).toMatchObject({ name: 'src', type: 'directory' });
    expect(body.tree[0].children).toEqual([
      expect.objectContaining({ name: 'main.ts', type: 'file' }),
    ]);
  });

  it('sorts by modified time from newest to oldest like ls -t', async () => {
    const olderPath = path.join(tempDir, 'z-older.txt');
    const newerPath = path.join(tempDir, 'a-newer.txt');
    await fs.writeFile(olderPath, 'older');
    await fs.writeFile(newerPath, 'newer');
    await fs.utimes(olderPath, new Date('2025-01-01'), new Date('2025-01-01'));
    await fs.utimes(newerPath, new Date('2025-01-02'), new Date('2025-01-02'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/tree?path=${encodeURIComponent(tempDir)}&type=file&sort=modified`,
    });

    expect(response.statusCode).toBe(200);
    const tree = response.json().tree as Array<{ name: string; mtime: number }>;
    expect(tree.map((node) => node.name)).toEqual([
      'README.md',
      'a-newer.txt',
      'z-older.txt',
    ]);
    expect(tree.every((node) => typeof node.mtime === 'number')).toBe(true);
  });

  it('can include hidden files and override excluded names', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/tree?path=${encodeURIComponent(tempDir)}&hidden=true&exclude=`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tree.map((node: { name: string }) => node.name)).toEqual([
      'node_modules',
      'src',
      '.hidden',
      'README.md',
    ]);
  });

  it('marks symlinks with their resolved target type and target path', async () => {
    const linkedFileTarget = path.join(tempDir, 'README.md');
    const linkedDirectoryTarget = path.join(tempDir, 'src');
    await fs.symlink(linkedFileTarget, path.join(tempDir, 'README-link.md'));
    await fs.symlink(linkedDirectoryTarget, path.join(tempDir, 'src-link'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/tree?path=${encodeURIComponent(tempDir)}&depth=2`,
    });

    expect(response.statusCode).toBe(200);
    const tree = response.json().tree;
    expect(tree).toContainEqual(
      expect.objectContaining({
        name: 'README-link.md',
        type: 'file',
        isSymlink: true,
        linkTarget: linkedFileTarget,
        targetType: 'file',
      })
    );
    expect(tree).toContainEqual(
      expect.objectContaining({
        name: 'src-link',
        type: 'directory',
        isSymlink: true,
        linkTarget: linkedDirectoryTarget,
        targetType: 'directory',
      })
    );
    expect(tree.find((node: { name: string }) => node.name === 'src-link')).not.toHaveProperty('children');
  });

  it('downloads a file as an attachment', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/download?path=${encodeURIComponent(path.join(tempDir, 'README.md'))}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('README.md');
    expect(response.body).toBe('readme');
  });

  it('downloads a directory as a zip excluding .git and node_modules directories', async () => {
    await fs.mkdir(path.join(tempDir, 'src', '.git'));
    await fs.mkdir(path.join(tempDir, 'src', 'node_modules'));
    await fs.writeFile(path.join(tempDir, 'src', '.git', 'config'), 'secret');
    await fs.writeFile(path.join(tempDir, 'src', 'node_modules', 'package.js'), 'ignored');
    await fs.writeFile(path.join(tempDir, 'src', '.env'), 'included');

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/download?path=${encodeURIComponent(path.join(tempDir, 'src'))}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toContain('src.zip');
    const archiveContents = response.rawPayload.toString('latin1');
    expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(archiveContents).toContain('main.ts');
    expect(archiveContents).toContain('.env');
    expect(archiveContents).not.toContain('node_modules');
    expect(archiveContents).not.toContain('.git');
  });

  it('returns 404 when downloading a missing path', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/download?path=${encodeURIComponent(path.join(tempDir, 'missing'))}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('reads file contents', async () => {
    const filePath = path.join(tempDir, 'README.md');
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.path).toBe(filePath);
    expect(body.content).toBe('readme');
    expect(typeof body.mtime).toBe('number');
  });

  it.each(['zip', 'jar'])('previews entries in a .%s archive', async (extension) => {
    const filePath = path.join(tempDir, `bundle.${extension}`);
    await fs.writeFile(filePath, await createZip({
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0',
      'com/example/App.class': 'bytecode',
    }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: 'archive',
      content: expect.stringContaining('META-INF/MANIFEST.MF'),
    });
    expect(response.json().content).toContain('com/example/App.class');
  });

  it('previews entries in a tar.gz archive', async () => {
    const filePath = path.join(tempDir, 'source.tar.gz');
    await fs.writeFile(filePath, gzipSync(await createTar({
      'src/index.ts': 'export {};',
      'README.md': 'readme',
    })));

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: 'archive',
      content: expect.stringContaining('src/index.ts'),
    });
    expect(response.json().content).toContain('README.md');
  });

  it('reports invalid archives without trying to show them as text', async () => {
    const filePath = path.join(tempDir, 'broken.zip');
    await fs.writeFile(filePath, 'not a zip');

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ kind: 'binary', error: 'Archive preview failed: Invalid ZIP archive' });
  });

  it('rejects file access outside the configured allowed roots', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-files-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideFile, 'secret', 'utf8');

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/files/read?path=${encodeURIComponent(outsideFile)}`,
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns 404 when reading a missing file', async () => {
    const filePath = path.join(tempDir, 'missing.ts');
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'File not found', path: filePath });
  });

  it('rejects binary files as unsupported text', async () => {
    const filePath = path.join(tempDir, 'sound.wav');
    await fs.writeFile(filePath, Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]));

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ kind: 'binary', error: 'Unsupported file type' });
  });

  it('serves PDF files through the raw endpoint', async () => {
    const filePath = path.join(tempDir, 'document.pdf');
    const pdf = Buffer.from('%PDF-1.7\n');
    await fs.writeFile(filePath, pdf);

    const readResponse = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });
    expect(readResponse.statusCode).toBe(415);
    expect(readResponse.json()).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });

    const rawResponse = await app.inject({
      method: 'GET',
      url: `/api/files/raw?path=${encodeURIComponent(filePath)}`,
    });
    expect(rawResponse.statusCode).toBe(200);
    expect(rawResponse.headers['content-type']).toContain('application/pdf');
    expect(rawResponse.rawPayload).toEqual(pdf);
  });

  it('serves image files through the raw endpoint', async () => {
    const filePath = path.join(tempDir, 'image.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile(filePath, pngHeader);

    const readResponse = await app.inject({
      method: 'GET',
      url: `/api/files/read?path=${encodeURIComponent(filePath)}`,
    });
    expect(readResponse.statusCode).toBe(415);
    expect(readResponse.json()).toMatchObject({ kind: 'image', mime: 'image/png' });

    const rawResponse = await app.inject({
      method: 'GET',
      url: `/api/files/raw?path=${encodeURIComponent(filePath)}`,
    });
    expect(rawResponse.statusCode).toBe(200);
    expect(rawResponse.headers['content-type']).toContain('image/png');
    expect(rawResponse.rawPayload).toEqual(pngHeader);
  });

  it('sandboxes SVG responses to prevent same-origin script execution', async () => {
    const filePath = path.join(tempDir, 'active.svg');
    await fs.writeFile(filePath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const response = await app.inject({
      method: 'GET',
      url: `/api/files/raw?path=${encodeURIComponent(filePath)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(response.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
  });

  it('serves safe local assets for sandboxed HTML previews', async () => {
    const siteDir = path.join(tempDir, 'site');
    await fs.mkdir(path.join(siteDir, 'styles'), { recursive: true });
    await fs.writeFile(path.join(siteDir, 'styles', 'site.css'), 'body { background: url(../image.png); }');
    await fs.writeFile(path.join(siteDir, 'app.js'), 'alert(1)');
    const encodedRoot = Buffer.from(siteDir).toString('base64url');

    const cssResponse = await app.inject({
      method: 'GET',
      url: `/api/files/preview-asset?root=${encodedRoot}&path=${encodeURIComponent('styles/site.css')}`,
    });
    expect(cssResponse.statusCode).toBe(200);
    expect(cssResponse.headers['content-type']).toContain('text/css');
    expect(cssResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(cssResponse.body).toBe(`body { background: url(/api/files/preview-asset?root=${encodedRoot}&path=image.png); }`);

    const scriptResponse = await app.inject({
      method: 'GET',
      url: `/api/files/preview-asset?root=${encodedRoot}&path=app.js`,
    });
    expect(scriptResponse.statusCode).toBe(415);
  });

  it('rejects HTML preview assets outside the configured allowed roots', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-preview-outside-'));
    await fs.writeFile(path.join(outsideDir, 'secret.css'), 'secret');

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/files/preview-asset?root=${Buffer.from(outsideDir).toString('base64url')}&path=secret.css`,
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('writes file contents', async () => {
    const filePath = path.join(tempDir, 'README.md');
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/write',
      payload: { path: filePath, content: 'updated' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(typeof body.mtime).toBe('number');
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('updated');
  });

  it('creates a binary file from base64 without overwriting it', async () => {
    const filePath = path.join(tempDir, 'document.pdf');
    const content = Buffer.from('%PDF-1.7\n\0binary');
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/create-binary',
      payload: { path: filePath, content: content.toString('base64') },
    });

    expect(response.statusCode).toBe(200);
    await expect(fs.readFile(filePath)).resolves.toEqual(content);

    const overwriteResponse = await app.inject({
      method: 'POST',
      url: '/api/files/create-binary',
      payload: { path: filePath, content: Buffer.from('replacement').toString('base64') },
    });
    expect(overwriteResponse.statusCode).toBe(409);
    await expect(fs.readFile(filePath)).resolves.toEqual(content);
  });

  it('creates a new file without overwriting existing files', async () => {
    const filePath = path.join(tempDir, 'nested', 'new-file.txt');
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/create',
      payload: { path: filePath, content: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.path).toBe(filePath);
    expect(typeof body.mtime).toBe('number');
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('hello');

    const overwriteResponse = await app.inject({
      method: 'POST',
      url: '/api/files/create',
      payload: { path: filePath, content: 'updated' },
    });

    expect(overwriteResponse.statusCode).toBe(409);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('hello');
  });

  it('creates directories without overwriting existing paths', async () => {
    const dirPath = path.join(tempDir, 'nested', 'folder');
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/mkdir',
      payload: { path: dirPath },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, path: dirPath });
    await expect(fs.stat(dirPath)).resolves.toMatchObject({});

    const conflictResponse = await app.inject({
      method: 'POST',
      url: '/api/files/mkdir',
      payload: { path: dirPath },
    });

    expect(conflictResponse.statusCode).toBe(409);
  });

  it('renames files without overwriting existing targets', async () => {
    const from = path.join(tempDir, 'README.md');
    const to = path.join(tempDir, 'README-renamed.md');
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/rename',
      payload: { from, to },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, path: to });
    await expect(fs.readFile(to, 'utf8')).resolves.toBe('readme');
    await expect(fs.access(from)).rejects.toThrow();

    const conflictResponse = await app.inject({
      method: 'POST',
      url: '/api/files/rename',
      payload: { from: to, to: path.join(tempDir, 'src', 'main.ts') },
    });

    expect(conflictResponse.statusCode).toBe(409);
  });

  it('deletes files and directories recursively', async () => {
    const filePath = path.join(tempDir, 'README.md');
    const fileResponse = await app.inject({
      method: 'POST',
      url: '/api/files/delete',
      payload: { path: filePath },
    });

    expect(fileResponse.statusCode).toBe(200);
    await expect(fs.access(filePath)).rejects.toThrow();

    const nonEmptyDir = path.join(tempDir, 'src');
    const nonEmptyResponse = await app.inject({
      method: 'POST',
      url: '/api/files/delete',
      payload: { path: nonEmptyDir },
    });

    expect(nonEmptyResponse.statusCode).toBe(200);
    await expect(fs.access(nonEmptyDir)).rejects.toThrow();

    const emptyDir = path.join(tempDir, 'empty');
    await fs.mkdir(emptyDir);
    const emptyResponse = await app.inject({
      method: 'POST',
      url: '/api/files/delete',
      payload: { path: emptyDir },
    });

    expect(emptyResponse.statusCode).toBe(200);
    await expect(fs.access(emptyDir)).rejects.toThrow();
  });

  it('reports whether system open is explicitly enabled', async () => {
    const disabledResponse = await app.inject({
      method: 'GET',
      url: '/api/files/capabilities',
    });
    expect(disabledResponse.statusCode).toBe(200);
    expect(disabledResponse.json()).toEqual({ systemOpen: false });

    process.env.PI_CLOUD_ENABLE_SYSTEM_OPEN = 'true';
    const enabledResponse = await app.inject({
      method: 'GET',
      url: '/api/files/capabilities',
    });
    expect(enabledResponse.json()).toEqual({ systemOpen: true });
  });

  it('rejects system open from non-local hostnames unless explicitly enabled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/open-system',
      headers: { host: 'pi.example.test' },
      payload: { path: path.join(tempDir, 'README.md') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'System open is not enabled for this hostname' });
  });

  it('searches files relative to a requested path', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/files/search?path=${encodeURIComponent(tempDir)}&pattern=**/*.ts`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().files).toEqual(['src/main.ts']);
  });
});
