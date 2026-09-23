import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: { entry: { index: 'src/index.ts', node: 'src/node.ts' }, formats: ['es'] },
    rolldownOptions: { external: ['node:os'] },
  },
});
