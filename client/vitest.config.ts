import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^monaco-editor$/,
        replacement: fileURLToPath(
          new URL('./src/test/monaco-stub.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.test.ts', 'src/test/**'],
      // Vitest 5's V8 branch accounting differs from Vitest 3; use the measured migration baseline.
      thresholds: {
        statements: 70,
        branches: 68,
        functions: 50,
        lines: 70,
      },
    },
  },
});
