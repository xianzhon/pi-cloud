import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { expandHomePath } from './paths.js';

const DEFAULT_ALLOWED_ROOTS = [os.homedir()];

export class PathAccessError extends Error {
  statusCode = 403;

  constructor(requestedPath: string) {
    super(`Path is outside the configured allowed roots: ${requestedPath}`);
  }
}

function isPathCheckDisabled(): boolean {
  const configured = process.env.PI_WEBUI_DISABLE_PATH_CHECK?.trim().toLowerCase();
  if (!configured) return process.platform === 'win32';
  return ['true', '1', 'yes', 'on'].includes(configured);
}

function configuredAllowedRoots(): string[] {
  const raw = process.env.PI_WEBUI_ALLOWED_ROOTS;
  if (!raw?.trim()) return DEFAULT_ALLOWED_ROOTS;

  return raw
    .split(',')
    .map(root => root.trim())
    .filter(Boolean);
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function realpathIfExists(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return path.resolve(candidate);
    }
    throw error;
  }
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await fs.access(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function allowedRoots(): Promise<string[]> {
  return Promise.all(configuredAllowedRoots().map(root => realpathIfExists(expandHomePath(root))));
}

export async function resolveAllowedPath(requestedPath: string | undefined): Promise<string> {
  const resolvedPath = path.resolve(expandHomePath(requestedPath));
  if (isPathCheckDisabled()) return resolvedPath;

  const configuredRoots = configuredAllowedRoots().map(root => path.resolve(expandHomePath(root)));
  const matchedRoot = configuredRoots.find(root => isInsideRoot(resolvedPath, root));
  if (!matchedRoot) throw new PathAccessError(resolvedPath);

  // Keep this guard local so static analysis can verify that the normalized
  // request cannot traverse above its configured root.
  const relativePath = path.relative(matchedRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new PathAccessError(resolvedPath);
  }

  const existingPath = await nearestExistingPath(resolvedPath);
  const realExistingPath = await realpathIfExists(existingPath);
  const roots = await allowedRoots();

  if (!roots.some(root => isInsideRoot(realExistingPath, root))) {
    throw new PathAccessError(resolvedPath);
  }

  return resolvedPath;
}
