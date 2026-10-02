import { viteDevframeHub } from '@devframes/vite/hub';
import { createDevframeProvider, createDevToolsProvider } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { DevTools } from '@vitejs/devtools';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

import { ProviderLifetime } from './lifetime.js';
import { counterComposition } from './composition.js';

export { counterPreviewPlugin } from './preview.js';
export { htmlBootstrapPlugin } from './html-bootstrap.js';
export { htmlTransformPlugins } from './html-transforms.js';
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
  const { composition, plugins } = counterComposition(host);
  if (host === 'devframe') {
    return [
      ...plugins,
      lifetime.plugin(),
      viteDevframeHub({
        ui: false,
        quiet: true,
        mcp: false,
        register: false,
        configure(context) {
          lifetime.prepare(() => createDevframeProvider({ context, ...composition }));
        },
      }),
    ];
  }
  return [
    ...plugins,
    {
      ...lifetime.plugin(),
      devtools: {
        setup(context) {
          lifetime.prepare(() => createDevToolsProvider({ context, ...composition }));
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
