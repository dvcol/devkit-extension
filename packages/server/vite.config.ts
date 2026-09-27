import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts', client: 'src/client/index.ts' }, formats: ['es'] },
    rolldownOptions: {
      external: [
        '@devkit/core',
        '@devkit/runtime',
        '@devkit/client',
        'zod',
        'node:crypto',
        'node:util',
      ],
    },
  },
});
