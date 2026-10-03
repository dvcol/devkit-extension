import { Server as HttpServer } from 'node:http';
import { initHub } from '@devframes/hub/initiate';
import { createDevframeProvider, createDevToolsProvider } from '@devkit/server';
import type { ServerComposition, ServerProviderHandle } from '@devkit/server';
import { createDevToolsContext, createDevToolsHub } from '@vitejs/devtools';
import type { Plugin, PreviewServer } from 'vite';

interface InspectorPreviewOptions {
  host: 'devframe' | 'devtools';
  composition: ServerComposition;
}

/** Attach the actual native host to Vite preview; built HTML remains unchanged. */
export function inspectorPreviewPlugin(options: InspectorPreviewOptions): Plugin {
  let resources = new AsyncDisposableStack();
  let disposal: Promise<void> | undefined;
  return {
    name: 'devkit:example-inspector-preview',
    async configurePreviewServer(server) {
      await using startup = new AsyncDisposableStack();
      let provider: ServerProviderHandle;
      if (options.host === 'devframe')
        provider = await devframe(server, options.composition, startup);
      else provider = await devtools(server, options.composition, startup);
      const view = provider.startup.plugins.find(
        (plugin) => plugin.snapshot().id === 'example.inspector-native',
      );
      if (view?.snapshot().status !== 'ready')
        throw new Error('The inspector contributions did not activate');
      resources = startup.move();
    },
    closePreviewServer() {
      disposal ??= resources.disposeAsync();
      return disposal;
    },
  };
}

function httpServer(server: PreviewServer): HttpServer {
  if (!(server.httpServer instanceof HttpServer))
    throw new Error('This inspector preview requires an HTTP/1 server without TLS');
  return server.httpServer;
}

async function devframe(
  server: PreviewServer,
  composition: ServerComposition,
  startup: AsyncDisposableStack,
) {
  let provider: ServerProviderHandle | undefined;
  const native = initHub({
    base: '/__devframes/',
    cwd: server.config.root,
    server: httpServer(server),
    register: false,
    mcp: false,
    async configure(context) {
      provider = await createDevframeProvider({ context, ...composition });
      const installed = provider;
      startup.defer(() => installed.dispose());
    },
  });
  startup.defer(() => native.close());
  await native.ready;
  if (provider === undefined)
    throw new Error('The native preview did not install an inspector provider');
  server.middlewares.use(native.nodeMiddleware);
  return provider;
}

async function devtools(
  server: PreviewServer,
  composition: ServerComposition,
  startup: AsyncDisposableStack,
) {
  const context = await createDevToolsContext(server.config);
  /** Preview has no development server; native auth URLs need its actual listening origin. */
  context.host.resolveOrigin = () => {
    const address = server.resolvedUrls?.local[0];
    if (address === undefined)
      throw new Error('The inspector preview origin is unavailable before listening');
    return new URL(address).origin;
  };
  const native = await createDevToolsHub({
    context,
    server: httpServer(server),
    host: '127.0.0.1',
  });
  startup.defer(() => native.close());
  const provider = await createDevToolsProvider({ context, ...composition });
  startup.defer(() => provider.dispose());
  server.middlewares.use(native.middleware);
  return provider;
}
