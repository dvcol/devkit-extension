import { Server as HttpServer } from 'node:http';

import { initHub } from '@devframes/hub/initiate';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { publishCounterView } from '@devkit/example-json-render';
import { counterActionsPlugin, counterService } from '@devkit/example-server-contexts';
import { createDevframeProvider, createDevToolsProvider } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { createDevToolsContext, createDevToolsHub } from '@vitejs/devtools';
import type { Plugin, PreviewServer } from 'vite';

import type { ExampleHost } from './index.js';

class PreviewLifetime {
  readonly readiness = Promise.withResolvers<ServerProviderHandle>();
  private provider: ServerProviderHandle | undefined;
  private closeHost: (() => Promise<void>) | undefined;
  private disposal: Promise<void> | undefined;
  private disposeView: (() => void) | undefined;

  constructor() {
    void this.readiness.promise.catch(() => null);
  }

  private async dispose() {
    const failures: unknown[] = [];
    try {
      this.disposeView?.();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.provider?.dispose();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.closeHost?.();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Preview backend cleanup failed');
  }

  close() {
    this.disposal ??= this.dispose();
    return this.disposal;
  }

  private async install(server: PreviewServer, host: ExampleHost) {
    if (!(server.httpServer instanceof HttpServer))
      throw new Error('This preview example requires an HTTP/1 server without TLS');
    const composition = {
      providerId: `example.${host}-preview`,
      services: [counterService],
      plugins: [counterActionsPlugin],
      expose: { actions: [increaseCounterAction], capabilities: [counterCapability] },
    };
    if (host === 'devframe') {
      const nativeHost = initHub({
        base: '/__devframes/',
        cwd: server.config.root,
        server: server.httpServer,
        register: false,
        mcp: false,
        configure: async (context) => {
          this.provider = await createDevframeProvider({ context, ...composition });
          this.disposeView = (
            await publishCounterView({ context, actionName: increaseCounterAction.id })
          ).dispose;
        },
      });
      this.closeHost = () => nativeHost.close();
      await nativeHost.ready;
      server.middlewares.use(nativeHost.nodeMiddleware);
      return;
    }
    const context = await createDevToolsContext(server.config);
    /** Native DevTools otherwise falls back to the development port when no ViteDevServer exists. */
    context.host.resolveOrigin = () => {
      const url = server.resolvedUrls?.local[0];
      if (url === undefined)
        throw new Error('The preview server origin is not available before listening');
      return new URL(url).origin;
    };
    const nativeHost = await createDevToolsHub({
      context,
      server: server.httpServer,
      host: '127.0.0.1',
    });
    this.closeHost = () => nativeHost.close();
    this.provider = await createDevToolsProvider({ context, ...composition });
    this.disposeView = (
      await publishCounterView({ context, actionName: increaseCounterAction.id })
    ).dispose;
    server.middlewares.use(nativeHost.middleware);
  }

  async configure(server: PreviewServer, host: ExampleHost) {
    try {
      await this.install(server, host);
      if (this.provider === undefined)
        throw new Error('Native preview host did not install a provider');
      this.readiness.resolve(this.provider);
    } catch (error) {
      this.readiness.reject(error);
      try {
        await this.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Preview startup and cleanup failed', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }
}

/** Example binding for live native backends alongside Vite's built asset server. */
export function counterPreviewPlugin(host: ExampleHost): Plugin {
  const lifetime = new PreviewLifetime();
  return {
    name: 'devkit:example-provider',
    apply: 'serve',
    api: { ready: lifetime.readiness.promise },
    configurePreviewServer: (server) => lifetime.configure(server, host),
    closePreviewServer: () => lifetime.close(),
  };
}
