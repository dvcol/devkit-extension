import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const firefox = mode === 'firefox';
  const outDir = firefox ? 'dist/firefox' : 'dist/chromium';
  return {
    base: './',
    plugins: [
      {
        name: 'webext-example-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify(createManifest(firefox)),
          });
        },
        async writeBundle() {
          await copyFile(`${outDir}/panel.html`, `${outDir}/denied.html`);
        },
      },
    ],
    build: {
      outDir,
      target: 'esnext',
      minify: false,
      rolldownOptions: {
        input: { panel: 'panel.html', background: 'src/background-entry.ts' },
        output: { entryFileNames: '[name].js' },
      },
    },
  };
});

function createManifest(firefox: boolean) {
  const background = createBackground(firefox);
  const manifest = {
    manifest_version: 3,
    name: 'Devkit native Port example',
    version: '0.0.1',
    background,
    action: { default_popup: 'panel.html' },
    options_ui: { page: 'panel.html', open_in_tab: true },
    host_permissions: ['http://127.0.0.1/*'],
    permissions: ['scripting'],
    /** Allow this example's loopback WebSocket without Firefox's default insecure-request upgrade. */
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
    },
  };
  if (!firefox) return manifest;
  return {
    ...manifest,
    browser_specific_settings: {
      gecko: {
        id: 'devkit-native-port@example.invalid',
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}

function createBackground(firefox: boolean) {
  if (firefox) return { scripts: ['background.js'], type: 'module' };
  return { service_worker: 'background.js', type: 'module' };
}
