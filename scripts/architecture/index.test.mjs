import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkArchitecture,
  extractImportSpecifiers,
  updateBaseline,
} from './index.mjs';

test('extractImportSpecifiers handles static, dynamic, and type imports', () => {
  const source = `
    import value from './value.js';
    import type { Item } from '@/types/item';
    export { other } from './other';
    const lazy = import('@/lazy/module');
  `;

  assert.deepEqual(extractImportSpecifiers(source).sort(), [
    './other',
    './value.js',
    '@/lazy/module',
    '@/types/item',
  ]);
});

test('checks Vue aliases and resolves JavaScript specifiers to TypeScript sources', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-cloud-architecture-'));
  try {
    await mkdir(path.join(cwd, 'src/components'), { recursive: true });
    await mkdir(path.join(cwd, 'src/feature'), { recursive: true });
    await mkdir(path.join(cwd, 'src/shared'), { recursive: true });
    await writeFile(
      path.join(cwd, 'src/index.ts'),
      "import './feature/thing.js';\n",
    );
    await writeFile(
      path.join(cwd, 'src/feature/thing.ts'),
      'export const thing = true;\n',
    );
    await writeFile(
      path.join(cwd, 'src/shared/lazy.ts'),
      'export const lazy = true;\n',
    );
    await writeFile(
      path.join(cwd, 'src/components/View.vue'),
      `<script setup lang="ts">\nimport { thing } from '@/feature/thing';\nconst lazy = import('@/shared/lazy');\n</script>\n`,
    );
    await writeFile(
      path.join(cwd, 'architecture-policy.json'),
      `${JSON.stringify(
        {
          version: 1,
          modules: [
            { id: 'core', roots: ['src'], requires: ['feature'] },
            { id: 'ui', roots: ['src/components'], requires: ['feature'] },
            { id: 'feature', roots: ['src/feature'], requires: [] },
            { id: 'shared', roots: ['src/shared'], requires: [] },
          ],
          global: { aliases: { '@/': 'src/' } },
        },
        null,
        2,
      )}\n`,
    );

    const result = await checkArchitecture({ cwd });

    assert.equal(result.newViolations.length, 1);
    assert.deepEqual(result.newViolations[0], {
      rule: 'module-dependency',
      file: 'src/components/View.vue',
      module: 'ui',
      detail: 'shared',
      message: 'ui imports shared without declaring it in requires',
      fingerprint: result.newViolations[0].fingerprint,
    });
    assert.deepEqual(
      result.modules.find((module) => module.id === 'core')?.dependencies,
      ['feature'],
    );
    assert.deepEqual(
      result.modules.find((module) => module.id === 'ui')?.dependencies,
      ['feature', 'shared'],
    );

    const unrelatedChange = await checkArchitecture({
      cwd,
      changedFiles: ['README.md'],
    });
    assert.equal(unrelatedChange.newViolations.length, 0);
    const policyChange = await checkArchitecture({
      cwd,
      changedFiles: ['architecture-policy.json'],
    });
    assert.equal(policyChange.newViolations.length, 1);

    await updateBaseline(cwd, result.violations);
    const baselined = await checkArchitecture({ cwd });
    assert.equal(baselined.newViolations.length, 0);
    assert.equal(baselined.baselineViolations.length, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
