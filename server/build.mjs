import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist/index.js.map', { force: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});
