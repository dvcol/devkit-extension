import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InstallationResult } from '@devkit/core';
import { counterCapability } from '@devkit/example-contribution';
import type { ExampleHost } from '@devkit/example-vite-hosts';
import type { ServerProviderHandle } from '@devkit/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

export function admitted(result: InstallationResult | undefined) {
  if (result?.status !== 'admitted') throw new Error('Expected an admitted installation');
  return result.handle;
}

export async function bindingFor(provider: ServerProviderHandle) {
  const resolution = await provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available' || resolution.binding.context.access !== 'local')
    throw new Error('Expected an available local counter');
  return { api: resolution.binding.api, native: resolution.binding.context.native };
}

export function connectionMetadata(server: ViteDevServer, host: ExampleHost) {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string')
    throw new Error('Vite did not expose a TCP address');
  const base = host === 'devframe' ? '/__devframes/' : '/__devtools/';
  return fetch(`http://127.0.0.1:${address.port}${base}__connection.json`);
}

export async function fixture(host: ExampleHost, watch = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'devkit-vite-host-')));
  const configFile = join(directory, 'vite.config.mts');
  const originalConfig = fileURLToPath(new URL('../host.config.ts', import.meta.url));
  const configSource = `export { default } from ${JSON.stringify(originalConfig)};\n`;
  await writeFile(configFile, configSource);
  const clientFile = join(directory, 'client.js');
  await writeFile(clientFile, 'export const value = 1;\n');
  const server = await createServer({
    root: directory,
    configFile,
    mode: host,
    logLevel: 'silent',
    publicDir: false,
    plugins: [
      {
        name: 'test:watcher-ready',
        enforce: 'pre',
        async configureServer({ watcher }) {
          /** Watched paths appear before the initial scan can reliably report edits. */
          if (watch) await once(watcher, 'ready');
        },
      },
    ],
    /** Poll temporary fixtures to avoid delayed macOS creation events reporting unchanged configs. */
    server: { host: '127.0.0.1', port: 0, watch: watch ? { usePolling: true } : null, hmr: watch },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return {
    server,
    changeConfig: () => writeFile(configFile, `${configSource}// Config reload receipt\n`),
    changeClient: () => writeFile(clientFile, 'export const value = 2;\n'),
    async close() {
      try {
        await server.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
