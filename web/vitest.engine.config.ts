import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/engine/**/*.spec.ts'],
    environment: 'node',
    globals: true,
  },
});
