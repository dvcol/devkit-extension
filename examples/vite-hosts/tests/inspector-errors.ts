import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { connectInspector } from './inspector-browser-actions.ts';
import { checkInspectorError } from './inspector-error-actions.ts';

await using cleanup = new AsyncDisposableStack();
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const version = browser.version();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const context = await browser.newContext();
context.on('weberror', (error) => pageErrors.push(error.error().message));
const observations = [];
for (const host of ['devframe', 'devtools'] as const) {
  const failure = { active: false, requests: 0 };
  const server = await createServer({
    configFile: fileURLToPath(new URL('../inspector.config.ts', import.meta.url)),
    mode: host,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'test:inspector-http-failure',
        enforce: 'pre',
        configureServer(native) {
          native.middlewares.use((request, response, next) => {
            if (request.url !== '/inspector-response' || !failure.active) {
              next();
              return;
            }
            failure.requests += 1;
            response.destroy();
          });
        },
      },
    ],
  });
  cleanup.defer(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== null && address !== undefined && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await connectInspector({ page, origin, host });
  for (const renderer of ['reference', 'custom'] as const)
    observations.push({ host, ...(await checkInspectorError({ page, failure, renderer })) });
  await page.close();
}
await cleanup.disposeAsync();
assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleErrors, []);
const receipt = {
  browser: version,
  observations,
  pageErrors,
  consoleErrors,
  checks: [
    'an actual owned-endpoint connection failure rejects the native inspector read and executes its authored onError callback',
    'failed reads preserve prior provider state, document and renderer mount',
    'reset and a fresh read recover through the same provider and renderer without an unhandled page error',
  ],
  limitations: [
    'Native development with routed single-provider actions; broadcast recipient errors are results, not rejected calls',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/inspector-errors-chromium.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.info(styleText('green', '✅ [vite-hosts/inspector/errors]'), receipt);
