import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const DEFAULT_BUNDLE_LIMITS = Object.freeze({
  initialJsGzipBytes: 900 * 1024,
  lazyJsGzipBytes: 1100 * 1024,
  workerRawBytes: 6250 * 1024,
});

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function collectInitialManifestKeys(manifest) {
  const initialKeys = new Set();
  const pending = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([key]) => key);

  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || initialKeys.has(key)) continue;
    initialKeys.add(key);
    for (const importedKey of manifest[key]?.imports ?? []) pending.push(importedKey);
  }

  return initialKeys;
}

async function gzipSize(filePath) {
  return gzipSync(await readFile(filePath)).byteLength;
}

export async function checkBundleBudget(distDir, limits = DEFAULT_BUNDLE_LIMITS) {
  const manifestPath = path.join(distDir, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const initialKeys = collectInitialManifestKeys(manifest);
  const initialFiles = [...initialKeys]
    .map((key) => manifest[key]?.file)
    .filter((file) => typeof file === 'string' && file.endsWith('.js'))
    .sort();
  const initialGzipBytes = (await Promise.all(
    initialFiles.map((file) => gzipSize(path.join(distDir, file))),
  )).reduce((total, bytes) => total + bytes, 0);

  if (initialGzipBytes > limits.initialJsGzipBytes) {
    throw new Error(
      `Initial JavaScript gzip size ${formatKiB(initialGzipBytes)} exceeds budget ${formatKiB(limits.initialJsGzipBytes)}`,
    );
  }

  const initialFileSet = new Set(initialFiles);
  const lazyFiles = [...new Set(Object.values(manifest)
    .map((chunk) => chunk.file)
    .filter((file) => typeof file === 'string' && file.endsWith('.js') && !initialFileSet.has(file)))]
    .sort();

  for (const file of lazyFiles) {
    const bytes = await gzipSize(path.join(distDir, file));
    if (bytes > limits.lazyJsGzipBytes) {
      throw new Error(
        `Lazy JavaScript chunk ${file} gzip size ${formatKiB(bytes)} exceeds budget ${formatKiB(limits.lazyJsGzipBytes)}`,
      );
    }
  }

  const assetDirectory = path.join(distDir, 'assets');
  const assetNames = await readdir(assetDirectory, { recursive: true });
  const workerFiles = assetNames.filter((file) => /(?:^|\/)\w+\.worker-[^/]+\.js$/.test(file));
  for (const file of workerFiles) {
    const bytes = (await stat(path.join(assetDirectory, file))).size;
    if (bytes > limits.workerRawBytes) {
      throw new Error(
        `Worker ${file} raw size ${formatKiB(bytes)} exceeds budget ${formatKiB(limits.workerRawBytes)}`,
      );
    }
  }

  return { initialFiles, initialGzipBytes, lazyFiles, workerFiles };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const distDir = path.resolve(process.argv[2] || 'dist');
  checkBundleBudget(distDir)
    .then((report) => {
      console.log(`Bundle budget passed: initial JavaScript ${formatKiB(report.initialGzipBytes)}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
