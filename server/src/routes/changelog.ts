import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const MAX_CHANGELOG_BYTES = 256 * 1024;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATHS = [
  // The bundled route lives in server/dist; the source route lives in server/src/routes.
  path.resolve(moduleDir, '../../CHANGELOG.md'),
  path.resolve(moduleDir, '../../../CHANGELOG.md'),
  path.resolve(process.cwd(), 'CHANGELOG.md'),
  path.resolve(process.cwd(), '..', 'CHANGELOG.md'),
];

async function readChangelog() {
  for (const changelogPath of CHANGELOG_PATHS) {
    try {
      if ((await stat(changelogPath)).size > MAX_CHANGELOG_BYTES) {
        return 'The changelog is too large to display safely. Inspect CHANGELOG.md directly.';
      }
      return await readFile(changelogPath, 'utf8');
    } catch {
      // Try the next runtime layout.
    }
  }
  return null;
}

export async function changelogRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    const content = await readChangelog();
    if (content === null) {
      return reply.status(404).send({ error: 'CHANGELOG.md was not found.' });
    }
    return { content };
  });
}
