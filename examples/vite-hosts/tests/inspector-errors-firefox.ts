import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { createServer } from 'vite';
import { checkInspectorError } from './inspector-error-firefox-actions.ts';
import { connectInspector } from './inspector-firefox-actions.ts';

await using cleanup = new AsyncDisposableStack();
const options = new Options().addArguments('-headless');
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const driver = Driver.createSession(options, new ServiceBuilder().build());
cleanup.defer(() => driver.quit());
const capabilities = await driver.getCapabilities();
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
  await connectInspector({ driver, origin, host, window: await driver.getWindowHandle() });
  for (const renderer of ['reference', 'custom'] as const)
    observations.push({ host, ...(await checkInspectorError({ driver, failure, renderer })) });
  await driver.get('about:blank');
}
await cleanup.disposeAsync();
const receipt = {
  browser: capabilities.getBrowserVersion(),
  driver: capabilities.get('moz:geckodriverVersion') as unknown,
  observations,
  checks: [
    'an actual owned-endpoint connection failure executes the authored inspector onError callback and displays the native error in both renderers',
    'failed reads preserve prior provider state, document and renderer mount',
    'reset and a fresh read recover through the same provider and renderer and clear the visible alert',
  ],
  limitations: [
    'No global page-error or browser-console capture through WebDriver Classic',
    'Native development with routed single-provider actions; broadcast recipient errors are results, not rejected calls',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/inspector-errors-firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [vite-hosts/inspector/errors/firefox]'), receipt);
