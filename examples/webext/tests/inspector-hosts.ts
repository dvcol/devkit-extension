import assert from 'node:assert/strict';
import { initHub } from '@devframes/hub/initiate';
import { definePlugin } from '@devkit/core';
import {
  configureInspectorAction,
  createInspectorActions,
  inspectorCapability,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { createInspectorView } from '@devkit/example-json-render/inspector';
import { createRemoteContext } from '@devkit/example-server-contexts';
import { devframeHubContext, serverExecution } from '@devkit/server';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createInspectorFeature } from '../../vite-hosts/src/inspector.ts';

/** Native contexts share the owned Vite HTTP server; each connection keeps its own auth and state. */
export async function startInspectorHost(options: {
  readonly mode: 'devframe' | 'devtools';
  readonly extensionOrigin: string;
  readonly directory: string;
}) {
  const { mode, extensionOrigin, directory } = options;
  await using cleanup = new AsyncDisposableStack();
  const feature = createInspectorFeature();
  const { context, createProvider } = await createRemoteContext(mode, directory);
  const token = crypto.randomUUID();
  let hub: ReturnType<typeof initHub> | undefined;
  let server: ViteDevServer | undefined;
  cleanup.defer(() => server?.close());
  server = await createServer({
    configFile: false,
    root: directory,
    plugins: [
      feature.plugin,
      {
        name: 'example:inspector-native-hub',
        configureServer(nativeServer) {
          hub = attachHub({ context, server: nativeServer, extensionOrigin, token, cleanup });
        },
      },
    ],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  assert.ok(hub);
  await hub.ready;
  const provider = await createProvider(composition(feature, mode));
  cleanup.defer(() => provider.dispose());
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== undefined && address !== null && typeof address !== 'string');
  const lifetime = cleanup.move();
  return {
    provider,
    token,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => lifetime.disposeAsync(),
  };
}

function attachHub(options: {
  readonly context: Awaited<ReturnType<typeof createRemoteContext>>['context'];
  readonly server: ViteDevServer;
  readonly extensionOrigin: string;
  readonly token: string;
  readonly cleanup: AsyncDisposableStack;
}) {
  const { context, server, extensionOrigin, token, cleanup } = options;
  assert.ok(server.httpServer !== null && 'headersTimeout' in server.httpServer);
  const hub = initHub({
    context,
    server: server.httpServer,
    base: '/__devkit-remote/',
    allowedOrigins: [extensionOrigin],
    auth: createInteractiveAuth(context, { clientAuthTokens: [token], banner() {} }),
    register: false,
    mcp: false,
    sse: false,
  });
  cleanup.defer(() => hub.close());
  server.middlewares.use(hub.nodeMiddleware);
  return hub;
}

export type InspectorHost = Awaited<ReturnType<typeof startInspectorHost>>;

function composition(feature: ReturnType<typeof createInspectorFeature>, mode: string) {
  return {
    providerId: `example.${mode}`,
    services: [feature.service],
    plugins: [
      createInspectorActions({ execution: serverExecution }),
      definePlugin({
        id: 'example.inspector-native',
        scripts: [feature.script],
        transforms: [feature.transform],
        views: [
          createInspectorView({ execution: serverExecution, nativeContext: devframeHubContext }),
        ],
      }),
    ],
    expose: {
      capabilities: [inspectorCapability],
      actions: [
        readInspectorAction,
        configureInspectorAction,
        markInspectorAction,
        resetInspectorAction,
      ],
    },
  };
}

export const inspectorHostHtml = `<!doctype html><html><head><script>
document.documentElement.dataset.firstScript = JSON.stringify({
  marker: Reflect.get(globalThis, 'responseInspectorMarker') ?? null,
  readyState: document.readyState,
});
</script><title>Owned native inspector fixture</title></head><body>
<h1>Owned native inspector fixture</h1></body></html>`;
