import { Script } from 'node:vm';
import { build } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  {
    browser: 'Chromium',
    mode: 'production',
    background: { service_worker: 'background.js', type: 'module' },
    browserSettings: {
      permissions: ['scripting', 'sidePanel'],
      side_panel: { default_path: 'panel.html' },
    },
  },
  {
    browser: 'Firefox',
    mode: 'firefox',
    background: { scripts: ['background.js'], type: 'module' },
    browserSettings: {
      sidebar_action: {
        default_panel: 'panel.html',
        default_title: 'Devkit',
        open_at_install: false,
      },
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
    expect.assertions(7);
    const { modules, imports, files, manifest, timingScript } = await inspectBundle(mode);
    expect(modules.filter((id) => /(?:^node:|browser-external)/u.test(id))).toEqual([]);
    expect(imports.filter((id) => /(?:^node:|browser-external)/u.test(id))).toEqual([]);
    expect(files).toEqual(
      expect.arrayContaining([
        'background.js',
        'panel.js',
        'panel.html',
        'devtools.html',
        'manifest.json',
        'script-timing.js',
      ]),
    );
    expect(timingScript).not.toBe('');
    expect(() => new Script(timingScript)).not.toThrow();
    expect(timingScript).not.toMatch(/import\s*\(/u);
    expect(manifest).toEqual({
      manifest_version: 3,
      name: 'Devkit native Port example',
      version: '0.0.1',
      background,
      action: { default_popup: 'panel.html' },
      options_ui: { page: 'panel.html', open_in_tab: true },
      devtools_page: 'devtools.html',
      host_permissions: ['http://127.0.0.1/*'],
      optional_host_permissions: ['http://localhost/*'],
      permissions: ['scripting'],
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
      },
      ...browserSettings,
    });
  },
  30_000,
);

it.each(['production', 'firefox'])(
  'adds storage permission only in the opted-in %s build',
  async (mode) => {
    expect.assertions(3);
    vi.stubEnv('VITE_COUNTER_STORAGE_KEY', 'example.persisted-counter');
    const { manifest, modules, backgroundScript } = await inspectBundle(mode);
    expect(manifest).toHaveProperty('permissions', expect.arrayContaining(['storage']));
    expect(modules.filter((id) => /(?:^node:|browser-external)/u.test(id))).toEqual([]);
    expect(backgroundScript).toContain('example.persisted-counter');
  },
  30_000,
);

async function inspectBundle(mode: string) {
  const modules: string[] = [];
  const imports: string[] = [];
  const files: string[] = [];
  let manifest: unknown;
  let timingScript = '';
  let backgroundScript = '';
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
            if (output.type === 'chunk' && output.fileName === 'background.js')
              backgroundScript = output.code;
            if (output.type === 'chunk' && output.fileName === 'script-timing.js')
              timingScript = output.code;
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
  return { modules, imports, files, manifest, timingScript, backgroundScript };
}
