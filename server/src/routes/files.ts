// server/src/routes/files.ts
import type { FastifyInstance } from 'fastify';
import type { Dirent, Stats } from 'fs';
import { spawn } from 'child_process';
import { isUtf8 } from 'buffer';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ZipArchive } from 'archiver';
import { globIterate } from 'glob';
import { archivePreview, isArchivePath } from '../utils/archive-preview.js';
import { resolveAllowedPath } from '../utils/path-security.js';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isSymlink?: boolean;
  linkTarget?: string;
  targetType?: 'file' | 'directory' | 'missing' | 'other';
  mtime?: number;
  children?: TreeNode[];
}

type TreeFilterType = 'all' | 'file' | 'directory';
type TreeSort = 'name' | 'modified';

const MAX_FILE_TREE_DEPTH = 10;
const MAX_FILE_TREE_NODES = 5_000;
const FILE_TREE_TIMEOUT_MS = 5_000;
const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SEARCH_RESULTS = 5_000;
const FILE_SEARCH_TIMEOUT_MS = 5_000;
const FILE_SEARCH_IGNORES = ['**/.git/**', '**/node_modules/**'];

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

const previewAssetMimeTypes = new Map<string, string>([
  ...imageMimeTypes,
  ['.css', 'text/css; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.otf', 'font/otf'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
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
  sort: TreeSort;
}

interface FileTreeBudget {
  remainingNodes: number;
  deadline: number;
  truncated: boolean;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function parseFilterType(value: string | undefined): TreeFilterType {
  if (value === 'file' || value === 'directory') return value;
  return 'all';
}

function parseTreeSort(value: string | undefined): TreeSort {
  return value === 'modified' ? 'modified' : 'name';
}

function getImageMimeType(filePath: string): string | undefined {
  return imageMimeTypes.get(path.extname(filePath).toLowerCase());
}

function isBinaryFile(filePath: string, content: Buffer): boolean {
  if (binaryExtensions.has(path.extname(filePath).toLowerCase())) return true;
  return content.includes(0) || !isUtf8(content);
}

function rewritePreviewCss(css: string, root: string, cssPath: string): string {
  // CSS loaded through a query endpoint cannot resolve its nested URLs against
  // the source file's directory, so preserve that directory explicitly.
  function rewriteReference(reference: string): string {
    if (!reference || reference.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('//')) {
      return reference;
    }
    const [assetPath] = reference.split(/[?#]/, 1);
    const resolvedAssetPath = assetPath.startsWith('/')
      ? assetPath.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(cssPath.replace(/\\/g, '/')), assetPath));
    return `/api/files/preview-asset?${new URLSearchParams({ root, path: resolvedAssetPath })}`;
  }

  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_match, quote: string, reference: string) => `url(${quote}${rewriteReference(reference.trim())}${quote})`)
    .replace(/(@import\s+)(['"])([^'"]+)\2/gi, (_match, prefix: string, quote: string, reference: string) => `${prefix}${quote}${rewriteReference(reference)}${quote}`);
}

export function getSystemOpenCommand(filePath: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform === 'darwin') {
    return { command: 'open', args: [filePath] };
  }

  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', filePath] };
  }

  return { command: 'xdg-open', args: [filePath] };
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
}

function isSystemOpenExplicitlyEnabled(): boolean {
  return parseBoolean(process.env.PI_CLOUD_ENABLE_SYSTEM_OPEN, false);
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
  currentDepth: number,
  options: BuildFileTreeOptions,
  budget: FileTreeBudget,
): Promise<TreeNode[]> {
  if (currentDepth >= depth) return [];

  const nodes: TreeNode[] = [];
  const directory = await fs.opendir(dirPath);
  try {
    let entry = await directory.read();
    while (entry !== null) {
      if (budget.remainingNodes <= 0 || Date.now() >= budget.deadline) {
        budget.truncated = true;
        break;
      }
      if (!options.includeHidden && entry.name.startsWith('.')) {
        entry = await directory.read();
        continue;
      }
      if (options.excludeNames.has(entry.name)) {
        entry = await directory.read();
        continue;
      }

      const node = await createTreeNode(dirPath, entry);
      if (options.sort === 'modified') {
        node.mtime = (await fs.lstat(node.path)).mtimeMs;
      }

      if (options.filterType === 'all' || options.filterType === node.type) {
        budget.remainingNodes--;

        if (node.type === 'directory' && !node.isSymlink) {
          node.children = await buildFileTree(node.path, depth, currentDepth + 1, options, budget);
        }

        nodes.push(node);
      }
      entry = await directory.read();
    }
  } finally {
    await directory.close();
  }

  return nodes.sort((a, b) => {
    if (options.sort === 'modified') {
      return (b.mtime! - a.mtime!) || a.name.localeCompare(b.name);
    }
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/tree', async (req, reply) => {
    const {
      path: dirPath,
      depth,
      type,
      hidden,
      exclude,
      sort,
    } = req.query as {
      path?: string;
      depth?: string;
      type?: string;
      hidden?: string;
      exclude?: string;
      sort?: string;
    };

    const requestedDepth = depth === undefined ? 3 : Number(depth);
    if (!Number.isInteger(requestedDepth) || requestedDepth < 1 || requestedDepth > MAX_FILE_TREE_DEPTH) {
      return reply.code(400).send({ error: `depth must be an integer between 1 and ${MAX_FILE_TREE_DEPTH}` });
    }

    const resolvedPath = await resolveAllowedPath(dirPath);
    const excludeNames = new Set(
      (exclude === undefined ? 'node_modules' : exclude)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    );

    const budget: FileTreeBudget = {
      remainingNodes: MAX_FILE_TREE_NODES,
      deadline: Date.now() + FILE_TREE_TIMEOUT_MS,
      truncated: false,
    };
    const tree = await buildFileTree(resolvedPath, requestedDepth, 0, {
      includeHidden: parseBoolean(hidden, false),
      excludeNames,
      filterType: parseFilterType(type),
      sort: parseTreeSort(sort),
    }, budget);

    const parentPath = path.dirname(resolvedPath);
    return {
      path: resolvedPath,
      parentPath: parentPath === resolvedPath ? null : parentPath,
      tree,
      truncated: budget.truncated,
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
    let stats: Stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'File not found', path: resolvedPath });
      }
      throw error;
    }

    const imageMimeType = getImageMimeType(resolvedPath);

    if (isArchivePath(resolvedPath)) {
      try {
        return {
          path: resolvedPath,
          content: await archivePreview(resolvedPath),
          kind: 'archive',
          mtime: stats.mtimeMs,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown archive error';
        return reply.code(415).send({
          error: `Archive preview failed: ${message}`,
          kind: 'binary',
          path: resolvedPath,
          mtime: stats.mtimeMs,
        });
      }
    }

    if (path.extname(resolvedPath).toLowerCase() === '.pdf') {
      return reply.code(415).send({
        error: 'PDF files can be previewed but not opened as text',
        kind: 'pdf',
        mime: 'application/pdf',
        path: resolvedPath,
        mtime: stats.mtimeMs,
      });
    }

    if (imageMimeType) {
      return reply.code(415).send({
        error: 'Image files can be previewed but not opened as text',
        kind: 'image',
        mime: imageMimeType,
        path: resolvedPath,
        mtime: stats.mtimeMs,
      });
    }

    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(resolvedPath, 'r');
      const openedStats = await handle.stat();
      if (openedStats.size > MAX_TEXT_FILE_BYTES) {
        return reply.code(413).send({
          error: 'File is too large to open as text',
          maxBytes: MAX_TEXT_FILE_BYTES,
          path: resolvedPath,
        });
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      while (true) {
        const remainingBytes = MAX_TEXT_FILE_BYTES + 1 - totalBytes;
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
        if (bytesRead === 0) break;
        totalBytes += bytesRead;
        if (totalBytes > MAX_TEXT_FILE_BYTES) {
          return reply.code(413).send({
            error: 'File is too large to open as text',
            maxBytes: MAX_TEXT_FILE_BYTES,
            path: resolvedPath,
          });
        }
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const content = Buffer.concat(chunks, totalBytes);

      if (isBinaryFile(resolvedPath, content)) {
        return reply.code(415).send({
          error: 'Unsupported file type',
          kind: 'binary',
          path: resolvedPath,
          mtime: openedStats.mtimeMs,
        });
      }

      return { path: resolvedPath, content: content.toString('utf-8'), mtime: openedStats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'File not found', path: resolvedPath });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  });

  app.get('/preview-asset', async (req, reply) => {
    const { root, path: relativePath } = req.query as { root?: string; path?: string };
    if (!root || !relativePath) {
      return reply.code(400).send({ error: 'Preview asset path is required' });
    }
    const previewRoot = Buffer.from(root, 'base64url').toString('utf8');
    if (!previewRoot) {
      return reply.code(400).send({ error: 'Preview asset path is required' });
    }

    const resolvedPath = await resolveAllowedPath(path.resolve(previewRoot, relativePath));
    const mimeType = previewAssetMimeTypes.get(path.extname(resolvedPath).toLowerCase());
    if (!mimeType) {
      return reply.code(415).send({ error: 'Unsupported preview asset type' });
    }

    try {
      const content = await fs.readFile(resolvedPath);
      reply.header('X-Content-Type-Options', 'nosniff');
      if (mimeType === 'image/svg+xml') {
        reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      }
      if (mimeType.startsWith('text/css')) {
        return reply.type(mimeType).send(rewritePreviewCss(content.toString('utf8'), root, relativePath));
      }
      return reply.type(mimeType).send(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'Preview asset not found' });
      }
      throw error;
    }
  });

  app.get('/raw', async (req, reply) => {
    const { path: filePath } = req.query as { path: string };
    const resolvedPath = await resolveAllowedPath(filePath);
    const imageMimeType = getImageMimeType(resolvedPath);
    const isPdf = path.extname(resolvedPath).toLowerCase() === '.pdf';
    if (!imageMimeType && !isPdf) {
      return reply.code(415).send({ error: 'Unsupported file type' });
    }

    if (isPdf) {
      return reply.type('application/pdf').send(createReadStream(resolvedPath));
    }

    if (imageMimeType === 'image/svg+xml') {
      // SVG can contain active script when navigated to directly. A sandboxed
      // response preserves image previewing without granting the WebUI origin.
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    }
    return reply.type(imageMimeType!).send(createReadStream(resolvedPath));
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

  app.post('/create-binary', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const { path: filePath, content } = req.body as { path?: string; content?: string };
    if (!filePath?.trim() || typeof content !== 'string') {
      return reply.code(400).send({ error: 'File path and base64 content are required' });
    }

    const resolvedPath = await resolveAllowedPath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    try {
      await fs.writeFile(resolvedPath, Buffer.from(content, 'base64'), { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return reply.code(409).send({ error: 'File already exists' });
      }
      throw error;
    }

    const stats = await fs.stat(resolvedPath);
    app.authServices?.audit.record({
      type: 'file_create',
      status: 'success',
      metadata: { path: resolvedPath },
    });
    return { success: true, path: resolvedPath, mtime: stats.mtimeMs };
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

  app.get('/capabilities', async () => ({
    systemOpen: isSystemOpenExplicitlyEnabled(),
  }));

  app.post('/open-system', async (req, reply) => {
    if (!isLocalHostname(req.hostname) && !isSystemOpenExplicitlyEnabled()) {
      return reply.code(403).send({ error: 'System open is not enabled for this hostname' });
    }

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

  app.get('/search', async (req, reply) => {
    const { pattern, path: searchPath } = req.query as { pattern: string; path?: string };
    if (!pattern?.trim()) {
      return reply.code(400).send({ error: 'Search pattern is required' });
    }
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const patternSegments = normalizedPattern.split('/');
    const unsafeMagic = ['{', '}', '[', ']'].some((character) => normalizedPattern.includes(character))
      || /[?*+@!]\(/.test(normalizedPattern);
    const unsafeDotSegment = patternSegments.some((segment) => (
      segment === '..' || (segment.includes('.') && /^[.*?]+$/.test(segment))
    ));
    if (path.isAbsolute(pattern) || unsafeMagic || unsafeDotSegment) {
      return reply.code(400).send({ error: 'Search pattern must stay within the requested path' });
    }

    const resolvedSearchPath = await resolveAllowedPath(searchPath || '.');
    const files: string[] = [];
    const signal = AbortSignal.timeout(FILE_SEARCH_TIMEOUT_MS);
    try {
      for await (const file of globIterate(normalizedPattern, {
        cwd: resolvedSearchPath,
        root: resolvedSearchPath,
        ignore: FILE_SEARCH_IGNORES,
        nodir: true,
        signal,
      })) {
        const relativePath = path.relative(resolvedSearchPath, path.resolve(resolvedSearchPath, file));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          return reply.code(400).send({ error: 'Search pattern must stay within the requested path' });
        }
        if (files.length === MAX_FILE_SEARCH_RESULTS) {
          return { files, truncated: true };
        }
        files.push(file);
      }
    } catch (error) {
      if (signal.aborted) {
        return reply.code(408).send({ error: 'File search timed out' });
      }
      throw error;
    }
    return { files, truncated: false };
  });
}
