import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Each file opens its own embedded database. Starting them all at once makes the first
  // hook exceed its limit before any assertion runs, so files run one at a time, and the
  // hook limit matches the 30 second test limit.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
});
