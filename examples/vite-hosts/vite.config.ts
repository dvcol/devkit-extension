import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', inspector: 'src/inspector-entry.ts' },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [
        /^node:/u,
        '@devframes/hub/initiate',
        '@devframes/vite/hub',
        '@devkit/core',
        '@devkit/example-server-contexts',
        '@devkit/example-json-render/view',
        '@devkit/example-json-render/inspector',
        '@devkit/example-contribution',
        '@devkit/example-contribution/inspector',
        '@devkit/server',
        '@vitejs/devtools',
        'vite',
      ],
    },
    sourcemap: true,
  },
});
