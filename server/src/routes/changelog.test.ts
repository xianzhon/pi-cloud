import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changelogRoutes } from './changelog';

const originalCwd = process.cwd();
let tempDir: string | undefined;

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('changelogRoutes', () => {
  it('reads the packaged changelog independently of the working directory', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'pi-webui-changelog-'));
    process.chdir(tempDir);

    const app = Fastify();
    await app.register(changelogRoutes, { prefix: '/api/changelog' });
    const response = await app.inject({ method: 'GET', url: '/api/changelog' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().content).toContain('# Changelog');
  });
});
