import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Vitest 5's V8 branch accounting differs from Vitest 3; use the measured migration baseline.
      thresholds: {
        statements: 70,
        branches: 64,
        functions: 70,
        lines: 70,
      },
    },
  },
});
