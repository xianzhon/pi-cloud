import { mkdtemp, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { SessionFileRelocator } from './session-file-relocator.js';

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'pi-cloud-relocator-'));
}

function jsonl(records: unknown[]) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

describe('SessionFileRelocator', () => {
  it('rejects session ids containing path separators', async () => {
    const root = await makeTempDir();

    await expect(new SessionFileRelocator().plan({
      sessionId: '../../outside',
      sourceSessionDir: join(root, 'old'),
      destinationSessionDir: join(root, 'new'),
      expectedOldCwd: '/old/project',
      newCwd: '/new/project',
    })).rejects.toThrow('Invalid session id');
  });

  it('moves all session files and rewrites matching cwd fields', async () => {
    const root = await makeTempDir();
    const sourceDir = join(root, 'old');
    const destDir = join(root, 'new');
    const relocator = new SessionFileRelocator();

    await import('fs/promises').then((fs) => fs.mkdir(sourceDir, { recursive: true }));
    await writeFile(join(sourceDir, 'one.jsonl'), jsonl([
      { type: 'session', id: 'one', cwd: '/old/project' },
      { type: 'message', cwd: '/old/project', text: 'hello' },
      { type: 'message', cwd: '/other/project', text: 'unchanged' },
    ]));
    await writeFile(join(sourceDir, 'two.jsonl'), jsonl([
      { type: 'session', id: 'two', cwd: '/old/project' },
      { type: 'message', cwd: '/old/project', text: 'world' },
    ]));

    const result = await relocator.relocateProject({
      sourceSessionDir: sourceDir,
      destinationSessionDir: destDir,
      expectedOldCwd: '/old/project',
      newCwd: '/new/project',
    });

    expect(result).toEqual({ moved: 2, skipped: 0, conflicts: [] });
    await expect(readdir(sourceDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(destDir)).toEqual(['one.jsonl', 'two.jsonl']);
    const moved = (await readFile(join(destDir, 'one.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(moved).toEqual([
      { type: 'session', id: 'one', cwd: '/new/project' },
      { type: 'message', cwd: '/new/project', text: 'hello' },
      { type: 'message', cwd: '/other/project', text: 'unchanged' },
    ]);
  });

  it('refuses destination conflicts before deleting source files', async () => {
    const root = await makeTempDir();
    const sourceDir = join(root, 'old');
    const destDir = join(root, 'new');
    const relocator = new SessionFileRelocator();
    const fs = await import('fs/promises');

    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(destDir, { recursive: true });
    await writeFile(join(sourceDir, 'same.jsonl'), jsonl([{ type: 'session', cwd: '/old/project' }]));
    await writeFile(join(destDir, 'same.jsonl'), jsonl([{ type: 'session', cwd: '/new/project' }]));

    await expect(relocator.relocateProject({
      sourceSessionDir: sourceDir,
      destinationSessionDir: destDir,
      expectedOldCwd: '/old/project',
      newCwd: '/new/project',
    })).rejects.toThrow('Destination session file already exists');

    expect(await readFile(join(sourceDir, 'same.jsonl'), 'utf8')).toContain('/old/project');
    expect(await readFile(join(destDir, 'same.jsonl'), 'utf8')).toContain('/new/project');
  });

  it('treats a missing source directory as a no-op', async () => {
    const root = await makeTempDir();
    const relocator = new SessionFileRelocator();

    await expect(relocator.relocateProject({
      sourceSessionDir: join(root, 'missing'),
      destinationSessionDir: join(root, 'new'),
      expectedOldCwd: '/old/project',
      newCwd: '/new/project',
    })).resolves.toEqual({ moved: 0, skipped: 0, conflicts: [] });
  });
});
