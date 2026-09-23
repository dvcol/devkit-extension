import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts' }, formats: ['es'] },
    rolldownOptions: {
      external: [
        /^node:/u,
        '@devframes/vite/hub',
        '@devkit/example-server-contexts',
        '@devkit/server',
        '@vitejs/devtools',
      ],
    },
    sourcemap: true,
  },
});
