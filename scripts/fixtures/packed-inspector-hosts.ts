/** Uses the maintained feature and native HTTP/WebSocket bootstrap from installed public entries. */
export const packedInspectorHosts = `
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { initHub } from '@devframes/hub/initiate';
import { createRemoteContext } from '@devkit/example-server-contexts';
import { createInspectorFeature, inspectorComposition } from '@devkit/example-vite-hosts/inspector';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';
import { build, createServer } from 'vite';
import type { ViteDevServer } from 'vite';

export async function buildBrowser(directory: string): Promise<void> {
  const observed = new Set<string>();
  const required = ['@devkit/example-json-render/dist/renderer', '@devframes/json-render-ui'];
  await build({
    root: directory, configFile: false, logLevel: 'silent',
    build: { outDir: 'site', target: 'esnext' },
    plugins: [{
      name: 'verify-packed-inspector-browser',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue;
          for (const imported of [...output.imports, ...output.dynamicImports])
            assert.ok(Object.hasOwn(bundle, imported), 'External browser import: ' + imported);
        }
        for (const identifier of this.getModuleIds()) {
          assert.ok(!/(?:^node:|browser-external)/u.test(identifier), 'Node browser import: ' + identifier);
          if (identifier.startsWith('\\0')) continue;
          const local = relative(directory, identifier);
          assert.ok(local !== '..' && !local.startsWith('../') && !local.startsWith('..\\\\'), 'Module outside consumer: ' + identifier);
          for (const name of required) if (identifier.includes(name)) observed.add(name);
        }
      },
    }],
  });
  assert.deepEqual([...observed].sort(), required.sort());
}

export async function createHost(mode: 'devframe' | 'devtools', directory: string) {
  await using cleanup = new AsyncDisposableStack();
  const feature = createInspectorFeature();
  const { context, createProvider } = await createRemoteContext(mode, directory);
  const token = crypto.randomUUID();
  let hub: ReturnType<typeof initHub> | undefined;
  let server: ViteDevServer | undefined;
  cleanup.defer(() => server?.close());
  server = await createServer({
    root: directory + '/site', configFile: false, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [feature.plugin, {
      name: 'packed-inspector-native-hub',
      configureServer(nativeServer) {
        assert.ok(nativeServer.httpServer !== null && 'headersTimeout' in nativeServer.httpServer);
        hub = initHub({
          context, server: nativeServer.httpServer, base: '/__packed/',
          auth: createInteractiveAuth(context, { clientAuthTokens: [token], banner() {} }),
          register: false, mcp: false, sse: false,
        });
        const ownedHub = hub;
        cleanup.defer(() => ownedHub.close());
        nativeServer.middlewares.use(hub.nodeMiddleware);
      },
    }],
  });
  assert.ok(hub);
  await hub.ready;
  const provider = await createProvider(inspectorComposition(feature, mode));
  cleanup.defer(() => provider.dispose());
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== undefined && address !== null && typeof address !== 'string');
  const lifetime = cleanup.move();
  return {
    mode, provider, token, origin: 'http://127.0.0.1:' + address.port,
    close: () => lifetime.disposeAsync(),
  };
}
`;
