import { copyFile, writeFile } from 'node:fs/promises';
import { build } from 'vite';
await build({
  configFile: false,
  base: './',
  build: {
    target: 'esnext',
    minify: false,
    rolldownOptions: {
      input: { panel: 'panel.html', background: 'background.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
});
await writeFile(
  'dist/manifest.json',
  JSON.stringify({
    manifest_version: 3,
    name: 'Native Port proof',
    version: '0.0.1',
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'panel.html' },
    options_ui: { page: 'panel.html', open_in_tab: true },
  }),
);

await copyFile('dist/panel.html', 'dist/denied.html');
