import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  counterPreviewPlugin,
  productionPreviewPlugin,
  readProductionStatus,
  watchProduction,
} from '@devkit/example-vite-hosts';
import type { ExampleHost, ProductionStatus } from '@devkit/example-vite-hosts';
import { preview } from 'vite';
import { vi } from 'vitest';

export function settledBuild(directory: string, phase: ProductionStatus['phase'], after = 0) {
  return vi.waitFor(
    () => {
      const status = readProductionStatus(directory);
      if (status.phase !== phase || status.attempt <= after)
        throw new Error(`Waiting for ${phase} after attempt ${after}: ${JSON.stringify(status)}`);
      return status;
    },
    { timeout: 10_000, interval: 25 },
  );
}

function watchFixture(directory: string, output: string) {
  return watchProduction(
    {
      configFile: false,
      root: directory,
      logLevel: 'silent',
      devtools: false,
      plugins: [
        {
          name: 'test:late-production-error',
          generateBundle(_options, bundle) {
            if (
              Object.values(bundle).some(
                (entry) => entry.type === 'chunk' && entry.code.includes('LATE_FAILURE'),
              )
            )
              this.error('Deliberate late build failure');
          },
          writeBundle(_options, bundle) {
            if (
              Object.values(bundle).some(
                (entry) => entry.type === 'chunk' && entry.code.includes('WRITE_FAILURE'),
              )
            )
              this.error('Deliberate writeBundle failure');
          },
        },
      ],
    },
    output,
  );
}

export async function readPage(origin: string) {
  const response = await fetch(origin);
  const html = await response.text();
  const source = /src="([^"]+)"/u.exec(html)?.[1];
  if (source === undefined) throw new Error('Completed page is missing its script');
  const assetUrl = new URL(source, response.url);
  const asset = await fetch(assetUrl);
  return { html, assetUrl, javascript: await asset.text() };
}

/** Real source edits drive Vite's watcher and a real late build-plugin failure. */
export async function productionFixture(host: ExampleHost) {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-watched-production-'));
  const output = join(directory, '.devkit-production');
  const client = join(directory, 'client.js');
  let watcher: Awaited<ReturnType<typeof watchProduction>> | undefined;
  await writeFile(
    join(directory, 'index.html'),
    '<main></main><script type="module" src="/client.js"></script>',
  );
  await writeFile(client, "document.querySelector('main').textContent = 'Initial build';");
  const server = await preview({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    devtools: false,
    plugins: [counterPreviewPlugin(host), productionPreviewPlugin(output)],
    preview: { host: '127.0.0.1', port: 0 },
  });
  const address = server.httpServer.address();
  if (address === null || typeof address === 'string')
    throw new Error('Preview has no TCP address');
  const start = () => watchFixture(directory, output);
  return {
    server,
    output,
    origin: `http://127.0.0.1:${address.port}`,
    change: (source: string) => writeFile(client, source),
    start,
    async watch() {
      watcher = await start();
      return watcher;
    },
    async close() {
      try {
        await watcher?.close();
      } finally {
        try {
          await server.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    },
  };
}
