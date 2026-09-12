import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageMetadata {
  dependencies?: Record<string, string>;
}

function readPackage(path: URL): PackageMetadata {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata;
}

describe('published package metadata', () => {
  it('includes every server runtime dependency', () => {
    const publishedPackage = readPackage(new URL('../../package.json', import.meta.url));
    const serverPackage = readPackage(new URL('../package.json', import.meta.url));
    const missingDependencies = Object.keys(serverPackage.dependencies ?? {})
      .filter((dependency) => !publishedPackage.dependencies?.[dependency]);

    expect(missingDependencies).toEqual([]);
  });
});
