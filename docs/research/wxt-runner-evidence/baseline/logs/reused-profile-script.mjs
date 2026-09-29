import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { createServer as createNetworkServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'wxt';

async function availablePort() {
  const server = createNetworkServer();
  await new Promise((resolveListening, rejectListening) => {
    server.once('error', rejectListening);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

async function connectBrowser(port) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1_000 });
    } catch (error) {
      lastError = error;
      await setTimeout(100);
    }
  }
  throw lastError;
}

async function readExtension(browser, expectedVersion) {
  const context = browser.contexts()[0];
  assert(context, 'Native runner must provide a browser context');
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.version, expectedVersion);
  await page.getByRole('button', { name: 'Increment', exact: true }).click();
  await expect(page.locator('#result')).toContainText('requestId', { timeout: 10_000 });
  const result = JSON.parse(await page.locator('#result').innerText());
  assert.equal(result.version, expectedVersion);
  assert.equal(result.count, 1);
  assert.equal(typeof result.requestId, 'string');
  assert.equal(typeof result.generation, 'string');
  return { extensionId, manifestVersion: manifest.version, action: result };
}

const chromiumPort = await availablePort();
const developmentPort = await availablePort();
const lifecycle = [];
const receipt = {
  binary: chromium.executablePath(),
  profile: resolve('profile'),
  chromiumPort,
  developmentPort,
  lifecycle,
  browserOwner: 'WXT native web-ext runner',
  trigger: 'wxt.config.ts manifest.version source edit from 1.0.0 to 1.0.1',
};
const configuration = `import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: { name: 'Managed lifecycle proof', version: '1.0.0' },
  dev: { server: { host: '127.0.0.1', port: ${developmentPort} } },
  webExt: {
    binaries: { chrome: ${JSON.stringify(receipt.binary)} },
    chromiumProfile: ${JSON.stringify(receipt.profile)},
    keepProfileChanges: true,
    chromiumPort: ${chromiumPort},
    chromiumArgs: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=${chromiumPort}'],
  },
});
`;
await writeFile('wxt.config.ts', configuration);
let server;
let browser;
let failure;
try {
  server = await createServer({
    browser: 'chrome',
    manifestVersion: 3,
    hooks: {
      'server:started': () => lifecycle.push({ event: 'started', at: Date.now() }),
      'server:closed': () => lifecycle.push({ event: 'closed', at: Date.now() }),
    },
  });
  await server.start();
  browser = await connectBrowser(chromiumPort);
  receipt.browserVersion = browser.version();
  receipt.initialDebugEndpoint = (await (await fetch(`http://127.0.0.1:${chromiumPort}/json/version`)).json()).webSocketDebuggerUrl;
  receipt.before = await readExtension(browser, '1.0.0');
  const initialBrowser = browser;
  initialBrowser.on('disconnected', () => { receipt.initialBrowserDisconnectedAt = Date.now(); });
  receipt.changeAt = Date.now();
  assert.equal((await readFile('wxt.config.ts', 'utf8')).match(/version: '1\.0\.0'/gu)?.length, 1);
  await writeFile('wxt.config.ts', configuration.replace("version: '1.0.0'", "version: '1.0.1'"));
  await expect.poll(() => initialBrowser.isConnected(), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => lifecycle.filter((event) => event.event === 'started').length, { timeout: 30_000 }).toBe(2);
  browser = await connectBrowser(chromiumPort);
  receipt.nextDebugEndpoint = (await (await fetch(`http://127.0.0.1:${chromiumPort}/json/version`)).json()).webSocketDebuggerUrl;
  assert.notEqual(receipt.nextDebugEndpoint, receipt.initialDebugEndpoint);
  receipt.after = await readExtension(browser, '1.0.1');
  assert.equal(receipt.after.extensionId, receipt.before.extensionId);
  assert.notEqual(receipt.after.action.generation, receipt.before.action.generation);
  assert.notEqual(receipt.after.action.requestId, receipt.before.action.requestId);
  assert.deepEqual(lifecycle.map((event) => event.event), ['started', 'closed', 'started']);
  receipt.passed = true;
} catch (error) {
  failure = error;
  receipt.error = String(error);
} finally {
  const cleanup = await Promise.allSettled([server?.stop()]);
  if (browser?.isConnected()) cleanup.push(...await Promise.allSettled([browser.close()]));
  receipt.cleanup = cleanup.map((result) => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, error: String(result.reason) });
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  assert(cleanup.every((result) => result.status === 'fulfilled'), 'Owned WXT/browser cleanup must succeed');
}
if (failure) throw failure;
console.info(JSON.stringify(receipt, null, 2));
