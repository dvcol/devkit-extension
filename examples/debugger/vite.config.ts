import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const browser = mode === 'firefox' ? 'firefox' : 'chromium';
  const remote = mode === 'devframe';
  const manifest = remote ? remoteManifest() : manifestFor(browser);
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
          if (remote)
            this.emitFile({
              type: 'asset',
              fileName: 'caller.html',
              source:
                '<!doctype html><title>Native CDB caller</title><script type="module" src="caller.js"></script>',
            });
          this.emitFile({
            type: 'asset',
            fileName: remote ? 'control.html' : 'probe.html',
            source: '<!doctype html><title>Debugger test controller</title>',
          });
        },
      },
    ],
    build: {
      outDir: remote ? 'dist/devframe' : `dist/${browser}`,
      target: 'esnext',
      minify: false,
      rolldownOptions: {
        input: remoteEntries(remote),
        output: { entryFileNames: '[name].js' },
      },
    },
  };
});

function remoteManifest() {
  return {
    manifest_version: 3,
    name: 'Devkit authenticated CDB example',
    version: '0.0.1',
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['debugger', 'tabs', 'tabGroups', 'webNavigation', 'storage', 'alarms'],
    host_permissions: ['http://127.0.0.1/*'],
  };
}

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

function remoteEntries(remote: boolean) {
  if (remote) return { background: 'tests/remote/worker.ts', caller: 'tests/remote/caller.ts' };
  return { background: 'tests/fixtures/background.ts' };
}
