import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['example.test.ts'],maxWorkers:1}});
