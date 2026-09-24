import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { counterPreviewPlugin } from '@devkit/example-vite-hosts';
import type { ExampleHost } from '@devkit/example-vite-hosts';
import { build, preview } from 'vite';

async function buildSite(directory: string) {
  await writeFile(
    join(directory, 'index.html'),
    '<main></main><script type="module" src="/client.js"></script>',
  );
  await writeFile(
    join(directory, 'client.js'),
    "document.querySelector('main').textContent = 'Built preview receipt';",
  );
  await build({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    devtools: false,
  });
}

/** Build browser source with Vite before starting either real preview backend. */
export async function previewFixture(host: ExampleHost) {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-built-preview-'));
  const output = join(directory, 'dist');
  try {
    await buildSite(directory);
    const base = host === 'devframe' ? '__devframes' : '__devtools';
    await mkdir(join(output, base));
    await writeFile(join(output, base, '__connection.json'), '{"backend":"static"}');
    const server = await preview({
      configFile: false,
      root: directory,
      logLevel: 'silent',
      devtools: false,
      plugins: [counterPreviewPlugin(host)],
      preview: { host: '127.0.0.1', port: 0 },
    });
    const address = server.httpServer.address();
    if (address === null || typeof address === 'string') {
      await server.close();
      throw new Error('Preview did not expose a TCP address');
    }
    return {
      server,
      origin: `http://127.0.0.1:${address.port}`,
      metadataPath: `/${base}/__connection.json`,
      builtHtml: await readFile(join(output, 'index.html'), 'utf8'),
      async close() {
        try {
          await server.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
