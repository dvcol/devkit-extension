import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts' }, formats: ['es'] },
    rolldownOptions: {
      external: [
        /^node:/u,
        '@devframes/hub/initiate',
        '@devframes/hub/node',
        '@devkit/core',
        '@devkit/example-contribution',
        '@devkit/server',
        '@vitejs/devtools-kit/node',
      ],
    },
    sourcemap: true,
  },
});
