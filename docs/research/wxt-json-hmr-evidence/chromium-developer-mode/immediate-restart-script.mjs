import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createServer as createNetworkServer } from 'node:net';
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

async function readExtension(browser, expectedVersion, expectedCount = 1) {
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
  assert.equal(result.count, expectedCount);
  assert.equal(typeof result.requestId, 'string');
  assert.equal(typeof result.generation, 'string');
  return { extensionId, manifestVersion: manifest.version, action: result };
}

const profile = await mkdtemp('/private/tmp/devkit-wxt-owned-profile-');
const chromiumPort = await availablePort();
const developmentPort = await availablePort();
const lifecycle = [];
const receipt = {
  binary: chromium.executablePath(),
  profilePolicy: 'dedicated native profile reused across browser restarts, removed after test',
  runId: crypto.randomUUID(),
  chromiumPort,
  developmentPort,
  lifecycle,
  browserOwner: 'WXT native web-ext runner',
  trigger: 'background count initializer source edit from 0 to 100',
};
const configuration = `import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: { name: 'Managed lifecycle proof', version: '1.0.0' },
  dev: { server: { host: '127.0.0.1', port: ${developmentPort} } },
  webExt: {
    chromiumProfile: ${JSON.stringify(profile)},
    keepProfileChanges: true,
    binaries: { chrome: ${JSON.stringify(receipt.binary)} },
    chromiumPort: ${chromiumPort},
    chromiumArgs: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=${chromiumPort}'],
  },
});
`;
await writeFile('wxt.config.ts', configuration);
await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
const initialBackground = await readFile('entrypoints/background.ts', 'utf8');
await writeFile('entrypoints/background.ts', initialBackground.replace('let count = 100;', 'let count = 0;'));
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
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  const diagnosticSession = await browser.newBrowserCDPSession();
  receipt.extensionsBefore = await diagnosticSession.send('Extensions.getExtensions');
  const manager = await browser.contexts()[0].newPage();
  await manager.goto('chrome://extensions');
  await expect(manager.locator('#devMode')).toHaveCount(1);
  receipt.developerModeBefore = await manager.locator('#devMode').evaluate(element => ({ checked: element.checked, disabled: element.disabled, role: element.getAttribute('role'), aria: element.getAttribute('aria-pressed') }));
  if (process.env.PROOF_ENABLE_DEVELOPER_MODE === '1') {
    await manager.locator('#devMode').click();
    receipt.developerModeAfterClick = await manager.locator('#devMode').evaluate(element => ({ checked: element.checked, disabled: element.disabled }));
    assert.equal(receipt.developerModeAfterClick.checked, true);
  }
  receipt.manifestBefore = await readFile('.output/chrome-mv3-dev/manifest.json', 'utf8');
  const backgroundPath = 'entrypoints/background.ts';
  const originalBackground = await readFile(backgroundPath, 'utf8');
  receipt.changeAt = Date.now();
  await writeFile(backgroundPath, originalBackground.replace('let count = 0;', 'let count = 100;'));
  await setTimeout(3000);
  receipt.manifestAfter = await readFile('.output/chrome-mv3-dev/manifest.json', 'utf8');
  receipt.extensionsAfter = await diagnosticSession.send('Extensions.getExtensions');
  await manager.reload();
  receipt.developerModeAfter = await manager.locator('#devMode').evaluate(element => ({ checked: element.checked, disabled: element.disabled, role: element.getAttribute('role'), aria: element.getAttribute('aria-pressed') }));
  receipt.managerText = await manager.locator('extensions-manager').innerText();
  await manager.screenshot({ path: 'extensions-after.png', fullPage: true });
  const page = await browser.contexts()[0].newPage();
  receipt.navigationFailures = [];
  await expect(async () => {
    try { await page.goto(`chrome-extension://${receipt.before.extensionId}/popup.html`, { timeout: 2000 }); }
    catch (error) { receipt.navigationFailures.push(String(error)); throw error; }
  }).toPass({ timeout: 10000, intervals: [100, 250, 500] });
  await page.getByRole('button', { name: 'Increment', exact: true }).click();
  await expect(page.locator('#result')).toContainText('requestId');
  receipt.after = JSON.parse(await page.locator('#result').innerText());
  assert.equal(receipt.after.count, 101);
  assert.notEqual(receipt.after.generation, receipt.before.action.generation);
  const beforeRestart = browser;
  await server.restartBrowser();
  assert.equal(beforeRestart.isConnected(), false);
  browser = await connectBrowser(chromiumPort);
  const nextManager = await browser.contexts()[0].newPage();
  await nextManager.goto('chrome://extensions');
  receipt.developerModeAfterNativeRestart = await nextManager.locator('#devMode').evaluate(element => element.checked);
  assert.equal(receipt.developerModeAfterNativeRestart, true);
  receipt.afterNativeRestart = await readExtension(browser, '1.0.0', 101);
  const nextBackground = await readFile(backgroundPath, 'utf8');
  await writeFile(backgroundPath, nextBackground.replace('let count = 100;', 'let count = 200;'));
  await setTimeout(2000);
  receipt.afterSecondNativeReload = await readExtension(browser, '1.0.0', 201);
  assert.notEqual(receipt.afterSecondNativeReload.action.generation, receipt.afterNativeRestart.action.generation);
  receipt.passed = true;
} catch (error) {
  failure = error;
  receipt.error = String(error);
} finally {
  const cleanup = await Promise.allSettled([server?.stop()]);
  if (browser?.isConnected()) cleanup.push(...await Promise.allSettled([browser.close()]));
  receipt.cleanup = cleanup.map((result) => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, error: String(result.reason) });
  await rm(profile, { recursive: true, force: true });
  receipt.profileRemoved = true;
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  assert(cleanup.every((result) => result.status === 'fulfilled'), 'Owned WXT/browser cleanup must succeed');
}
if (failure) throw failure;
console.info(JSON.stringify(receipt, null, 2));
