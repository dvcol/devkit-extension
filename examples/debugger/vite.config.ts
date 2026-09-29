import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const browser = mode === 'firefox' ? 'firefox' : 'chromium';
  const manifest = manifestFor(browser);
  return {
    define: { DEBUGGER_BROWSER: JSON.stringify(browser) },
    plugins: [
      {
        name: 'debugger-fixture-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify(manifest),
          });
          this.emitFile({
            type: 'asset',
            fileName: 'probe.html',
            source: '<!doctype html><title>Debugger test controller</title>',
          });
        },
      },
    ],
    build: {
      outDir: `dist/${browser}`,
      target: 'esnext',
      minify: false,
      rolldownOptions: {
        input: 'tests/fixtures/background.ts',
        output: { entryFileNames: 'background.js' },
      },
    },
  };
});

function manifestFor(browser: 'chromium' | 'firefox') {
  const common = { manifest_version: 3, name: 'Devkit debugger example', version: '0.0.1' };
  if (browser === 'firefox')
    return {
      ...common,
      background: { scripts: ['background.js'], type: 'module' },
      permissions: [],
      browser_specific_settings: {
        gecko: {
          id: 'devkit-debugger@example.invalid',
          data_collection_permissions: { required: ['none'] },
        },
      },
    };
  return {
    ...common,
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['debugger', 'tabs'],
  };
}
