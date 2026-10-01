import { viteDevframeHub } from '@devframes/vite/hub';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { counterActionsPlugin, counterService } from '@devkit/example-server-contexts';
import { createDevframeProvider, createDevToolsProvider } from '@devkit/server';
import type { ServerComposition, ServerProviderHandle } from '@devkit/server';
import { DevTools } from '@vitejs/devtools';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

import { ProviderLifetime } from './lifetime.js';

export { counterPreviewPlugin } from './preview.js';
export { htmlBootstrapPlugin } from './html-bootstrap.js';
export { productionPreviewPlugin } from './production-preview.js';
export { watchProduction } from './production-watch.js';
export { readProductionStatus } from './production-output.js';
export type { ProductionStatus } from './production-output.js';

export type ExampleHost = 'devframe' | 'devtools';

/** Vite can load its config in a different module graph, so constructor identity is unsuitable. */
function hasProviderApi(api: unknown): api is { readonly ready: Promise<ServerProviderHandle> } {
  return typeof api === 'object' && api !== null && 'ready' in api && api.ready instanceof Promise;
}

/** Call inside a Vite config factory so every config reload creates fresh native plugins. */
export async function counterHostPlugins(host: ExampleHost): Promise<Plugin[]> {
  const lifetime = new ProviderLifetime();
  const composition: ServerComposition = {
    providerId: `example.${host}-vite`,
    services: [counterService],
    plugins: [counterActionsPlugin],
    expose: { actions: [increaseCounterAction], capabilities: [counterCapability] },
  };
  if (host === 'devframe') {
    return [
      lifetime.plugin(),
      viteDevframeHub({
        ui: false,
        quiet: true,
        mcp: false,
        register: false,
        configure(context) {
          lifetime.prepare(() => createDevframeProvider({ context, ...composition }), context);
        },
      }),
    ];
  }
  return [
    {
      ...lifetime.plugin(),
      devtools: {
        setup(context) {
          lifetime.prepare(() => createDevToolsProvider({ context, ...composition }), context);
        },
      },
    },
    ...(await DevTools({ builtinDevTools: false })),
  ];
}

/** Resolve the current generation after listen/restart; a saved promise refers to the old one. */
export function providerFromVite(
  server: ViteDevServer | PreviewServer,
): Promise<ServerProviderHandle> {
  const plugin = server.config.plugins.find(
    (candidate) => candidate.name === 'devkit:example-provider',
  );
  const api: unknown = plugin?.api;
  if (!hasProviderApi(api))
    throw new Error('The Vite configuration does not contain the counter host example');
  return api.ready;
}
