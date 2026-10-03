import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', provider: 'src/provider.ts', inspector: 'src/inspector.ts' },
      formats: ['es'],
    },
    rolldownOptions: { external: ['@devkit/core', '@devkit/runtime', 'zod'] },
    sourcemap: true,
  },
});
