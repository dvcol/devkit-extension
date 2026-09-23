import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';

export async function buildCustom(browserName: 'chrome' | 'firefox', development = false): Promise<string> {
  const root = resolve('fixtures/custom');
  const outDir = resolve(root, `dist-${browserName}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await build({ root, configFile: false, build: { outDir, emptyOutDir: false, sourcemap: true, rolldownOptions: { input: Object.fromEntries(['popup', 'options', 'sidepanel', 'devtools'].map((surface) => [surface, resolve(root, `${surface}.html`)])) } } });
  for (const entry of ['background', 'content', 'main-world']) {
    const entryPath = entry === 'main-world' ? resolve('shared/main-world.ts') : resolve(root, `${entry}.ts`);
    await build({ root, configFile: false, build: { outDir, emptyOutDir: false, sourcemap: true, minify: false, lib: { entry: entryPath, name: 'ProbeEntry', formats: entry === 'background' ? ['es'] : ['iife'], fileName: () => `${entry}.js` } } });
  }
  const manifest = {
    manifest_version: 3, name: 'Toolchain probe', version: '0.0.0',
    permissions: browserName === 'chrome' ? ['storage', 'sidePanel'] : ['storage'],
    host_permissions: ['http://127.0.0.1/*'],
    background: browserName === 'chrome' ? { service_worker: 'background.js', type: 'module' } : { scripts: ['background.js'], type: 'module' },
    action: { default_popup: 'popup.html' }, options_ui: { page: 'options.html' }, devtools_page: 'devtools.html',
    ...(browserName === 'chrome' ? { side_panel: { default_path: 'sidepanel.html' } } : { sidebar_action: { default_panel: 'sidepanel.html' } }),
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }],
    web_accessible_resources: [{ resources: ['main-world.js'], matches: ['http://127.0.0.1/*'] }],
    ...(browserName === 'firefox' ? { browser_specific_settings: { gecko: { id: 'toolchain-probe@example.invalid', data_collection_permissions: { required: ['none'] } } } } : {}),
    ...(development ? { content_security_policy: { extension_pages: "script-src 'self' http://localhost:39372; object-src 'self'" } } : {}),
  };
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (development) {
    const html = '<!doctype html><html><body><output id="result"></output><button id="increment">Increment</button><button id="failure">Fail</button><script type="module" src="http://localhost:39372/@vite/client"></script><script type="module" src="http://localhost:39372/page.ts"></script></body></html>';
    for (const surface of ['popup', 'options', 'sidepanel', 'devtools']) await writeFile(resolve(outDir, `${surface}.html`), html);
  }
  return outDir;
}

export async function serveCustom() {
  const server = await createServer({ root: resolve('fixtures/custom'), configFile: false, server: { host: 'localhost', port: 39372, strictPort: true, cors: true } });
  await server.listen();
  return server;
}

if (process.argv[1]?.endsWith('/custom-build.ts')) {
  const browserName = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
  await buildCustom(browserName);
}
