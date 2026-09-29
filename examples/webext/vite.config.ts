import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'webext-example-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify({
            manifest_version: 3,
            name: 'Devkit native Port example',
            version: '0.0.1',
            background: { service_worker: 'background.js', type: 'module' },
            action: { default_popup: 'panel.html' },
            options_ui: { page: 'panel.html', open_in_tab: true },
            host_permissions: ['http://127.0.0.1/*'],
            permissions: ['scripting'],
          }),
        });
      },
      async writeBundle() {
        await copyFile('dist/panel.html', 'dist/denied.html');
      },
    },
  ],
  build: {
    target: 'esnext',
    minify: false,
    rolldownOptions: {
      input: { panel: 'panel.html', background: 'src/background.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
});
