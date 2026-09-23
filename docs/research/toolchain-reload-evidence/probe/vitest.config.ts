import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['probe.test.ts'], maxWorkers: 1 } });
