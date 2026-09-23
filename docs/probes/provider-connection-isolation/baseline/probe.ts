import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { build, preview } from 'vite';
import type { PreviewServer } from 'vite';
import { createEndpoint } from './endpoint.ts';
import { isRecord } from './validation.ts';
const directory = import.meta.dirname;
const credentials = {
  endpointA: randomBytes(32).toString('hex'),
  endpointB: randomBytes(32).toString('hex'),
};
const endpoints: Awaited<ReturnType<typeof createEndpoint>>[] = [];
const result: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  passed: false,
  nodeVersion: process.version,
  packages: { devframe: '1.0.0', hub: '1.0.0', kit: '0.7.5', vite: '8.3.0' },
};
let previewServer: PreviewServer | undefined;
let origin = 'http://127.0.0.1';
let resolveBrowserResult: (value: Record<string, unknown>) => void;
const browserResult = new Promise<Record<string, unknown>>((resolve) => {
  resolveBrowserResult = resolve;
});
function resolveOrigin(): string {
  return origin;
}

function sanitized(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const credential of Object.values(credentials))
    message = message.replaceAll(credential, '[credential]');
  return message.replaceAll(directory, '<probe-directory>');
}
function configureControl(server: PreviewServer): void {
  server.middlewares.use((request, response, next) => {
    const bootstrap = request.url === '/__probe-control/bootstrap';
    const code = request.url === '/__probe-control/code';
    const count = request.url === '/__probe-control/count';
    if (bootstrap || code || count) {
      let payload: unknown = { credentials };
      if (code)
        payload = { code: endpoints.find((endpoint) => endpoint.endpoint === 'endpointA')?.code() };
      if (count)
        payload = {
          count: endpoints.find((endpoint) => endpoint.endpoint === 'endpointB')?.receipts.length,
        };
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(payload));
      return;
    }
    if (request.url !== '/__probe-control/result' || request.method !== 'POST') {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const received: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.ok(isRecord(received));
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
      resolveBrowserResult(received);
    });
  });
}
function verifyBrowserResult(browser: Record<string, unknown>): void {
  assert.equal(browser.passed, true);
  assert.deepEqual(
    Object.fromEntries(endpoints.map((endpoint) => [endpoint.endpoint, endpoint.value()])),
    { endpointA: 7, endpointB: 15 },
  );
  assert.ok(
    endpoints
      .flatMap((endpoint) => endpoint.receipts)
      .every((receipt) => receipt.credentialKind !== 'unknown'),
  );
}

async function main(): Promise<void> {
  await build({
    root: directory,
    configFile: false,
    logLevel: 'warn',
    build: { outDir: 'dist', emptyOutDir: true },
  });
  previewServer = await preview({
    root: directory,
    configFile: false,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
    plugins: [
      {
        name: 'two-public-hub-connections',
        async configurePreviewServer(server) {
          configureControl(server);
          for (const [endpoint, base] of [
            ['endpointA', '/__endpoint-a/'],
            ['endpointB', '/__endpoint-b/'],
          ] as const) {
            endpoints.push(
              await createEndpoint(server, endpoint, base, credentials[endpoint], resolveOrigin),
            );
          }
        },
      },
    ],
  });
  const address = previewServer.httpServer.address();
  assert.ok(address !== null && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  await writeFile(
    join(directory, 'running.json'),
    JSON.stringify({ origin, processId: process.pid }),
  );
  console.info(styleText('cyan', '🧪 [connection-probe]'), 'Open built preview:', origin);
  const browser = await browserResult;
  result.browser = browser;
  verifyBrowserResult(browser);
  result.passed = true;
}
try {
  await main();
} catch (error) {
  result.error = sanitized(error);
  process.exitCode = 1;
} finally {
  const cleanupErrors: string[] = [];
  for (const endpoint of endpoints) endpoint.detach();
  for (const endpoint of endpoints) {
    try {
      await endpoint.hub.close();
    } catch (error) {
      cleanupErrors.push(sanitized(error));
    }
  }
  if (previewServer) {
    try {
      await previewServer.close();
    } catch (error) {
      cleanupErrors.push(sanitized(error));
    }
  }
  result.cleanup = {
    hubsClosed: cleanupErrors.length === 0,
    previewStopped: previewServer ? !previewServer.httpServer.listening : true,
    errors: cleanupErrors,
  };
  if (cleanupErrors.length > 0) {
    result.passed = false;
    process.exitCode = 1;
  }
  result.serverValues = Object.fromEntries(
    endpoints.map((endpoint) => [endpoint.endpoint, endpoint.value()]),
  );
  result.serverReceipts = endpoints.flatMap((endpoint) => endpoint.receipts);
  result.finishedAt = new Date().toISOString();
  let serialized = JSON.stringify(result, null, 2);
  for (const credential of Object.values(credentials))
    serialized = serialized.replaceAll(credential, '[credential]');
  await writeFile(join(directory, 'result.json'), `${serialized}\n`);
  console.info(styleText('cyan', '🧪 [connection-probe]'), serialized);
}
