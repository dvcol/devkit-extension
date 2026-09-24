import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts' }, formats: ['es'] },
    rolldownOptions: {
      external: [
        /^node:/u,
        '@devframes/hub/initiate',
        '@devframes/vite/hub',
        '@devkit/example-server-contexts',
        '@devkit/server',
        '@vitejs/devtools',
        'vite',
      ],
    },
    sourcemap: true,
  },
});
