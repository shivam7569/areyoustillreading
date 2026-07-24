import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Build the site once before the suite, then assert against dist/.
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
