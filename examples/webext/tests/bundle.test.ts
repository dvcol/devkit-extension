import { build } from 'vite';
import { expect, it } from 'vitest';

it.each([
  {
    browser: 'Chromium',
    mode: 'production',
    background: { service_worker: 'background.js', type: 'module' },
    browserSettings: {},
  },
  {
    browser: 'Firefox',
    mode: 'firefox',
    background: { scripts: ['background.js'], type: 'module' },
    browserSettings: {
      browser_specific_settings: {
        gecko: {
          id: 'devkit-native-port@example.invalid',
          data_collection_permissions: { required: ['none'] },
        },
      },
    },
  },
])(
  'bundles native RPC and rendering for $browser',
  async ({ mode, background, browserSettings }) => {
    expect.assertions(4);
    const { modules, imports, files, manifest } = await inspectBundle(mode);
    expect(modules.filter((id) => /(?:^node:|browser-external)/u.test(id))).toEqual([]);
    expect(imports.filter((id) => /(?:^node:|browser-external)/u.test(id))).toEqual([]);
    expect(files).toEqual(
      expect.arrayContaining(['background.js', 'panel.js', 'panel.html', 'manifest.json']),
    );
    expect(manifest).toEqual({
      manifest_version: 3,
      name: 'Devkit native Port example',
      version: '0.0.1',
      background,
      action: { default_popup: 'panel.html' },
      options_ui: { page: 'panel.html', open_in_tab: true },
      host_permissions: ['http://127.0.0.1/*'],
      permissions: ['scripting'],
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
      },
      ...browserSettings,
    });
  },
);

async function inspectBundle(mode: string) {
  const modules: string[] = [];
  const imports: string[] = [];
  const files: string[] = [];
  let manifest: unknown;
  await build({
    configFile: './vite.config.ts',
    mode,
    logLevel: 'silent',
    plugins: [
      {
        name: 'inspect-extension-bundle',
        enforce: 'post',
        generateBundle(_options, bundle) {
          modules.push(...this.getModuleIds());
          files.push(...Object.keys(bundle));
          for (const output of Object.values(bundle)) {
            if (output.type === 'chunk') imports.push(...output.imports, ...output.dynamicImports);
            if (output.type !== 'asset' || output.fileName !== 'manifest.json') continue;
            const source = output.source;
            const text = typeof source === 'string' ? source : new TextDecoder().decode(source);
            manifest = JSON.parse(text) as unknown;
          }
        },
      },
    ],
    build: { write: false },
  });
  return { modules, imports, files, manifest };
}
