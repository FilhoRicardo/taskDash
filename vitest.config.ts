import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // The 'obsidian' npm package is types-only; tests use a runtime stub.
      obsidian: fileURLToPath(new URL('./src/__tests__/helpers/obsidian-stub.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  },
});
