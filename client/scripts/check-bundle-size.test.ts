import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBundleBudget } from './check-bundle-size.mjs';

const temporaryDirectories: string[] = [];

async function createBuild(manifest: Record<string, unknown>, assets: Record<string, string>) {
  const distDir = await mkdtemp(path.join(tmpdir(), 'pi-webui-bundle-'));
  temporaryDirectories.push(distDir);
  await mkdir(path.join(distDir, '.vite'), { recursive: true });
  await writeFile(path.join(distDir, '.vite/manifest.json'), JSON.stringify(manifest));
  await Promise.all(Object.entries(assets).map(async ([name, content]) => {
    const assetPath = path.join(distDir, name);
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, content);
  }));
  return distDir;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('checkBundleBudget', () => {
  it('rejects an oversized JavaScript module in the initial dependency closure', async () => {
    const entry = 'entry payload '.repeat(50);
    const shared = Array.from({ length: 300 }, (_, index) => `shared-${index}`).join('|');
    const distDir = await createBuild({
      'src/main.ts': { file: 'assets/entry.js', isEntry: true, imports: ['_shared.js'], dynamicImports: ['src/editor.ts'] },
      '_shared.js': { file: 'assets/shared.js' },
      'src/editor.ts': { file: 'assets/editor.js', isDynamicEntry: true },
    }, {
      'assets/entry.js': entry,
      'assets/shared.js': shared,
      'assets/editor.js': shared,
    });

    await expect(checkBundleBudget(distDir, {
      initialJsGzipBytes: gzipSync(entry).byteLength,
      lazyJsGzipBytes: gzipSync(shared).byteLength + 1,
      workerRawBytes: 10_000,
    })).rejects.toThrow(/initial JavaScript.*budget/i);
  });

  it('does not charge dynamically imported feature chunks to the initial budget', async () => {
    const entry = 'small entry';
    const editor = Array.from({ length: 300 }, (_, index) => `editor-${index}`).join('|');
    const distDir = await createBuild({
      'src/main.ts': { file: 'assets/entry.js', isEntry: true, dynamicImports: ['src/editor.ts'] },
      'src/editor.ts': { file: 'assets/editor.js', isDynamicEntry: true },
    }, {
      'assets/entry.js': entry,
      'assets/editor.js': editor,
    });

    const report = await checkBundleBudget(distDir, {
      initialJsGzipBytes: gzipSync(entry).byteLength,
      lazyJsGzipBytes: gzipSync(editor).byteLength,
      workerRawBytes: 10_000,
    });

    expect(report.initialFiles).toEqual(['assets/entry.js']);
    expect(report.initialGzipBytes).toBe(gzipSync(entry).byteLength);
  });

  it('rejects an oversized worker independently from lazy feature chunks', async () => {
    const distDir = await createBuild({
      'src/main.ts': { file: 'assets/entry.js', isEntry: true },
    }, {
      'assets/entry.js': 'entry',
      'assets/ts.worker-abc.js': 'worker payload',
    });

    await expect(checkBundleBudget(distDir, {
      initialJsGzipBytes: 100,
      lazyJsGzipBytes: 100,
      workerRawBytes: 5,
    })).rejects.toThrow(/worker.*budget/i);
  });
});
