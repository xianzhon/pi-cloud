// server/src/routes/files.ts
import type { FastifyInstance } from 'fastify';
import type { Dirent, Stats } from 'fs';
import { spawn } from 'child_process';
import { isUtf8 } from 'buffer';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ZipArchive } from 'archiver';
import { glob } from 'glob';
import { resolveAllowedPath } from '../utils/path-security.js';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isSymlink?: boolean;
  linkTarget?: string;
  targetType?: 'file' | 'directory' | 'missing' | 'other';
  children?: TreeNode[];
}

type TreeFilterType = 'all' | 'file' | 'directory';

const imageMimeTypes = new Map<string, string>([
  ['.apng', 'image/apng'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

const binaryExtensions = new Set([
  '.aiff', '.avi', '.bin', '.bmp', '.class', '.dmg', '.doc', '.docx', '.exe', '.flac',
  '.ico', '.jar', '.m4a', '.m4v', '.mov', '.mp3', '.mp4', '.o', '.ogg', '.pdf', '.ppt',
  '.pptx', '.psd', '.so', '.wav', '.webm', '.xls', '.xlsx', '.zip',
]);

interface BuildFileTreeOptions {
  includeHidden: boolean;
  excludeNames: Set<string>;
  filterType: TreeFilterType;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function parseFilterType(value: string | undefined): TreeFilterType {
  if (value === 'file' || value === 'directory') return value;
  return 'all';
}

function getImageMimeType(filePath: string): string | undefined {
  return imageMimeTypes.get(path.extname(filePath).toLowerCase());
}

function isBinaryFile(filePath: string, content: Buffer): boolean {
  if (binaryExtensions.has(path.extname(filePath).toLowerCase())) return true;
  return content.includes(0) || !isUtf8(content);
}

function getSystemOpenCommand(filePath: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [filePath] };
  }

  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', filePath] };
  }

  return { command: 'xdg-open', args: [filePath] };
}

function openWithSystemTool(filePath: string): void {
  const { command, args } = getSystemOpenCommand(filePath);
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function createTreeNode(dirPath: string, entry: Dirent): Promise<TreeNode> {
  const fullPath = path.join(dirPath, entry.name);
  const isSymlink = entry.isSymbolicLink();
  let isDirectory = entry.isDirectory();
  let linkTarget: string | undefined;
  let targetType: TreeNode['targetType'];

  if (isSymlink) {
    const rawTarget = await fs.readlink(fullPath);
    linkTarget = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(dirPath, rawTarget);

    try {
      const targetStats = await fs.stat(fullPath);
      if (targetStats.isDirectory()) {
        isDirectory = true;
        targetType = 'directory';
      } else if (targetStats.isFile()) {
        targetType = 'file';
      } else {
        targetType = 'other';
      }
    } catch {
      targetType = 'missing';
    }
  }

  const node: TreeNode = {
    name: entry.name,
    path: fullPath,
    type: isDirectory ? 'directory' : 'file',
  };

  if (isSymlink) {
    node.isSymlink = true;
    node.linkTarget = linkTarget;
    node.targetType = targetType;
  }

  return node;
}

async function buildFileTree(
  dirPath: string,
  depth: number,
  currentDepth: number = 0,
  options: BuildFileTreeOptions = {
    includeHidden: false,
    excludeNames: new Set(['node_modules']),
    filterType: 'all',
  }
): Promise<TreeNode[]> {
  if (currentDepth >= depth) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (!options.includeHidden && entry.name.startsWith('.')) continue;
    if (options.excludeNames.has(entry.name)) continue;

    const node = await createTreeNode(dirPath, entry);

    if (options.filterType !== 'all' && options.filterType !== node.type) {
      continue;
    }

    if (node.type === 'directory') {
      node.children = await buildFileTree(node.path, depth, currentDepth + 1, options);
    }

    nodes.push(node);
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/tree', async (req) => {
    const {
      path: dirPath,
      depth,
      type,
      hidden,
      exclude,
    } = req.query as {
      path?: string;
      depth?: string;
      type?: string;
      hidden?: string;
      exclude?: string;
    };

    const resolvedPath = await resolveAllowedPath(dirPath);
    const excludeNames = new Set(
      (exclude === undefined ? 'node_modules' : exclude)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    );

    const tree = await buildFileTree(resolvedPath, parseInt(depth || '3'), 0, {
      includeHidden: parseBoolean(hidden, false),
      excludeNames,
      filterType: parseFilterType(type),
    });

    const parentPath = path.dirname(resolvedPath);
    return {
      path: resolvedPath,
      parentPath: parentPath === resolvedPath ? null : parentPath,
      tree,
    };
  });

  app.get('/download', async (req, reply) => {
    const { path: requestedPath } = req.query as { path?: string };
    if (!requestedPath?.trim()) {
      return reply.code(400).send({ error: 'File path is required' });
    }

    const resolvedPath = await resolveAllowedPath(requestedPath);
    let stats: Stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'Path not found' });
      }
      throw error;
    }

    const name = path.basename(resolvedPath);
    const downloadName = stats.isDirectory() ? `${name}.zip` : name;
    const asciiName = downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    reply.header('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

    if (stats.isFile()) {
      return reply.type('application/octet-stream').send(createReadStream(resolvedPath));
    }
    if (!stats.isDirectory()) {
      return reply.code(400).send({ error: 'Path must be a file or directory' });
    }

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('warning', (error) => app.log.warn(error));
    archive.on('error', (error) => archive.destroy(error));
    archive.glob('**/*', {
      cwd: resolvedPath,
      dot: true,
      follow: false,
      ignore: ['**/.git/**', '**/.git', '**/node_modules/**', '**/node_modules'],
    });
    void archive.finalize();
    return reply.type('application/zip').send(archive);
  });

  app.get('/read', async (req, reply) => {
    const { path: filePath } = req.query as { path: string };
    const resolvedPath = await resolveAllowedPath(filePath);
    let content: Buffer;
    let stats: Stats;

    try {
      [content, stats] = await Promise.all([
        fs.readFile(resolvedPath),
        fs.stat(resolvedPath),
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'File not found', path: resolvedPath });
      }
      throw error;
    }

    const imageMimeType = getImageMimeType(resolvedPath);

    if (imageMimeType) {
      return reply.code(415).send({
        error: 'Image files can be previewed but not opened as text',
        kind: 'image',
        mime: imageMimeType,
        path: resolvedPath,
        mtime: stats.mtimeMs,
      });
    }

    if (isBinaryFile(resolvedPath, content)) {
      return reply.code(415).send({
        error: 'Unsupported file type',
        kind: 'binary',
        path: resolvedPath,
        mtime: stats.mtimeMs,
      });
    }

    return { path: resolvedPath, content: content.toString('utf-8'), mtime: stats.mtimeMs };
  });

  app.get('/raw', async (req, reply) => {
    const { path: filePath } = req.query as { path: string };
    const resolvedPath = await resolveAllowedPath(filePath);
    const imageMimeType = getImageMimeType(resolvedPath);
    if (!imageMimeType) {
      return reply.code(415).send({ error: 'Unsupported file type' });
    }

    const content = await fs.readFile(resolvedPath);
    if (imageMimeType === 'image/svg+xml') {
      // SVG can contain active script when navigated to directly. A sandboxed
      // response preserves image previewing without granting the WebUI origin.
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    }
    return reply.type(imageMimeType).send(content);
  });

  app.post('/write', async (req) => {
    const { path: filePath, content } = req.body as { path: string; content: string };
    const resolvedPath = await resolveAllowedPath(filePath);
    await fs.writeFile(resolvedPath, content, 'utf-8');
    const stats = await fs.stat(resolvedPath);
    app.authServices?.audit.record({
      type: 'file_write',
      status: 'success',
      metadata: { path: resolvedPath },
    });
    return { success: true, mtime: stats.mtimeMs };
  });

  app.post('/create', async (req, reply) => {
    const { path: filePath, content = '' } = req.body as { path?: string; content?: string };
    if (!filePath?.trim()) {
      return reply.code(400).send({ error: 'File path is required' });
    }

    const resolvedPath = await resolveAllowedPath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(resolvedPath, 'wx');
      await handle.writeFile(content, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return reply.code(409).send({ error: 'File already exists' });
      }
      throw error;
    } finally {
      await handle?.close();
    }

    const stats = await fs.stat(resolvedPath);
    app.authServices?.audit.record({
      type: 'file_create',
      status: 'success',
      metadata: { path: resolvedPath },
    });
    return { success: true, path: resolvedPath, mtime: stats.mtimeMs };
  });

  app.post('/mkdir', async (req, reply) => {
    const { path: dirPath } = req.body as { path?: string };
    if (!dirPath?.trim()) {
      return reply.code(400).send({ error: 'Directory path is required' });
    }

    const resolvedPath = await resolveAllowedPath(dirPath);
    try {
      await fs.mkdir(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return reply.code(409).send({ error: 'Directory already exists' });
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(resolvedPath, { recursive: true });
      } else {
        throw error;
      }
    }

    app.authServices?.audit.record({
      type: 'directory_create',
      status: 'success',
      metadata: { path: resolvedPath },
    });
    return { success: true, path: resolvedPath };
  });

  app.post('/rename', async (req, reply) => {
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from?.trim() || !to?.trim()) {
      return reply.code(400).send({ error: 'Source and target paths are required' });
    }

    const fromPath = await resolveAllowedPath(from);
    const toPath = await resolveAllowedPath(to);
    try {
      await fs.access(toPath);
      return reply.code(409).send({ error: 'Target already exists' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
    app.authServices?.audit.record({
      type: 'file_rename',
      status: 'success',
      metadata: { from: fromPath, to: toPath },
    });
    return { success: true, path: toPath };
  });

  app.post('/delete', async (req, reply) => {
    const { path: filePath } = req.body as { path?: string };
    if (!filePath?.trim()) {
      return reply.code(400).send({ error: 'File path is required' });
    }

    const resolvedPath = await resolveAllowedPath(filePath);
    const stats = await fs.stat(resolvedPath);
    if (stats.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true, force: false });
    } else {
      await fs.unlink(resolvedPath);
    }

    app.authServices?.audit.record({
      type: 'file_delete',
      status: 'success',
      metadata: { path: resolvedPath },
    });
    return { success: true };
  });

  app.post('/open-system', async (req, reply) => {
    const { path: filePath } = req.body as { path?: string };
    if (!filePath?.trim()) {
      return reply.code(400).send({ error: 'File path is required' });
    }

    const resolvedPath = await resolveAllowedPath(filePath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      return reply.code(400).send({ error: 'Path must be a file' });
    }

    openWithSystemTool(resolvedPath);
    app.authServices?.audit.record({
      type: 'file_open_system',
      status: 'success',
      metadata: { path: resolvedPath },
    });
    return { success: true };
  });

  app.get('/search', async (req) => {
    const { pattern, path: searchPath } = req.query as { pattern: string; path?: string };
    const resolvedSearchPath = await resolveAllowedPath(searchPath || '.');
    const files = await glob(pattern, { cwd: resolvedSearchPath });
    return { files };
  });
}
