import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['isolation.test.ts'], maxWorkers: 1 },
});
