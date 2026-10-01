import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { createManifest } from './wxt.config.ts';

export default defineConfig(({ mode }) => {
  const firefox = mode === 'firefox';
  const storageKey = process.env.VITE_COUNTER_STORAGE_KEY ?? '';
  const directory = firefox ? 'dist/firefox' : 'dist/chromium';
  const outDir = resolve(
    import.meta.dirname,
    storageKey === '' ? directory : `${directory}-persistent`,
  );
  return {
    root: resolve(import.meta.dirname, 'entrypoints'),
    base: './',
    define: {
      'import.meta.env.VITE_COUNTER_STORAGE_KEY': JSON.stringify(storageKey),
    },
    plugins: [
      {
        name: 'webext-example-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify({
              ...createManifest(firefox),
              manifest_version: 3,
              background: createBackground(firefox),
            }),
          });
        },
        async writeBundle() {
          await copyFile(`${outDir}/panel.html`, `${outDir}/denied.html`);
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'esnext',
      minify: false,
      rolldownOptions: {
        input: {
          panel: resolve(import.meta.dirname, 'entrypoints/panel.html'),
          devtools: resolve(import.meta.dirname, 'entrypoints/devtools.html'),
          background: resolve(import.meta.dirname, 'src/background-entry.ts'),
          'script-timing': resolve(import.meta.dirname, 'src/script-timing-entry.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  };
});

function createBackground(firefox: boolean) {
  if (firefox) return { scripts: ['background.js'], type: 'module' };
  return { service_worker: 'background.js', type: 'module' };
}
