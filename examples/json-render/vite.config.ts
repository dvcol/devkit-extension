import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rolldownOptions: { external: [/^@devframes\//u, /^@devkit\//u, /^devframe\//u, /^node:/u] },
    sourcemap: true,
  },
});
