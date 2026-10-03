import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', view: 'src/view.ts', inspector: 'src/inspector.ts' },
      formats: ['es'],
    },
    rolldownOptions: { external: [/^@devframes\//u, /^@devkit\//u, /^devframe\//u, /^node:/u] },
    sourcemap: true,
  },
});
