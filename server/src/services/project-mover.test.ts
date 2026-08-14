import { mkdir, readFile, stat, writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ProjectMover } from './project-mover.js';

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'piui-project-mover-'));
}

describe('ProjectMover', () => {
  it('moves a project directory into a selected parent with a new name', async () => {
    const root = await tempRoot();
    const source = join(root, 'old-app');
    const parent = join(root, 'archive');
    await mkdir(source, { recursive: true });
    await mkdir(parent, { recursive: true });
    await writeFile(join(source, 'README.md'), 'hello');

    const result = await new ProjectMover().move({
      oldProjectPath: source,
      destinationParentPath: parent,
      newProjectName: 'new-app',
    });

    expect(result.projectPath).toBe(join(parent, 'new-app'));
    expect(await readFile(join(parent, 'new-app', 'README.md'), 'utf8')).toBe('hello');
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects invalid project folder names', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'old-app'), { recursive: true });
    await mkdir(join(root, 'archive'), { recursive: true });

    await expect(new ProjectMover().move({
      oldProjectPath: join(root, 'old-app'),
      destinationParentPath: join(root, 'archive'),
      newProjectName: '../bad',
    })).rejects.toThrow('Project folder name must be a single folder name');
  });

  it('rejects an existing destination', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'old-app'), { recursive: true });
    await mkdir(join(root, 'archive', 'old-app'), { recursive: true });

    await expect(new ProjectMover().move({
      oldProjectPath: join(root, 'old-app'),
      destinationParentPath: join(root, 'archive'),
      newProjectName: 'old-app',
    })).rejects.toThrow('Destination project folder already exists');
  });

  it('rejects moving a project into itself', async () => {
    const root = await tempRoot();
    const source = join(root, 'old-app');
    await mkdir(join(source, 'nested'), { recursive: true });

    await expect(new ProjectMover().move({
      oldProjectPath: source,
      destinationParentPath: join(source, 'nested'),
      newProjectName: 'copy',
    })).rejects.toThrow('Cannot move a project inside itself');
  });
});
