import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createNetworkServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'wxt';

const repository = process.env.DEVKIT_REPOSITORY;
assert(repository, 'Set DEVKIT_REPOSITORY to the absolute maintained repository path');
const panelPath = `${repository}/examples/webext/src/panel.ts`;
const original = await readFile(panelPath, 'utf8');
await mkdir('entrypoints', { recursive: true });
await writeFile('entrypoints/background.ts', `import { defineBackground } from 'wxt/utils/define-background';
import { startExampleBackground } from ${JSON.stringify(`${repository}/examples/webext/src/background.ts`)};
export default defineBackground({ type: 'module', main: startExampleBackground });
`);
await writeFile('entrypoints/panel.html', (await readFile(`${repository}/examples/webext/panel.html`, 'utf8')).replace('./src/panel.ts', panelPath));
const receipt = { source: panelPath, sourceSha256: createHash('sha256').update(original).digest('hex'), events: [], errors: [], console: [], passed: false };
async function availablePort() {
  const server = createNetworkServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function connectBrowser(port) {
  let lastError;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); }
    catch (error) { lastError = error; await setTimeout(100); }
  }
  throw lastError;
}
async function identity(page) {
  await page.getByRole('button', { name: 'Caller identity' }).click();
  await expect(page.locator('#result')).toContainText('panel.html');
  return JSON.parse(await page.locator('#result').innerText());
}
async function clickListenerCount(page, selector) {
  const session = await page.context().newCDPSession(page);
  try {
    const { result } = await session.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
    const { listeners } = await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.filter(listener => listener.type === 'click').length;
  } finally { await session.detach(); }
}
const chromiumPort = await availablePort();
const developmentPort = await availablePort();
await writeFile('wxt.config.ts', `import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: {
    name: 'Native JSON renderer HMR proof', version: '1.0.0',
    action: { default_popup: 'panel.html' },
    permissions: ['scripting'], host_permissions: ['http://127.0.0.1/*'],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*" },
  },
  vite: () => ({ server: { fs: { allow: [${JSON.stringify(process.cwd())}, ${JSON.stringify(repository)}] } } }),
  dev: { server: { host: '127.0.0.1', origin: 'http://127.0.0.1', port: ${developmentPort} } },
  webExt: {
    binaries: { chrome: ${JSON.stringify(chromium.executablePath())} },
    chromiumArgs: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=${chromiumPort}'],
  },
});
`);
let server;
let browser;
let failure;
try {
  server = await createServer({ browser: 'chrome', manifestVersion: 3 });
  await server.start();
  browser = await connectBrowser(chromiumPort);
  receipt.browser = browser.version();
  const context = browser.contexts()[0];
  context.on('weberror', error => receipt.errors.push(error.error().message));
  context.on('console', message => { receipt.console.push({ type: message.type(), text: message.text() }); console.info(message.type(), message.text()); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 30000 });
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.proofPorts = [];
    globalThis.proofGeneration = crypto.randomUUID();
    chrome.runtime.onConnect.addListener(port => {
      if (port.name !== 'devkit-native-port-example') return;
      const record = { connected: Date.now(), disconnected: null };
      globalThis.proofPorts.push(record);
      port.onDisconnect.addListener(() => { record.disconnected = Date.now(); });
    });
  });
  const first = await context.newPage();
  const second = await context.newPage();
  for (const page of [first, second]) {
    await page.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(page.locator('#status')).toHaveText('Connected', { timeout: 30000 });
    await expect(page.getByText('Counter: 0', { exact: true })).toBeVisible();
  }
  receipt.before = {
    clickListeners: await clickListenerCount(first, '#routed'),
    manifest: await first.evaluate(() => chrome.runtime.getManifest().version),
    timeOrigin: await first.evaluate(() => performance.timeOrigin),
    identity: await identity(first),
    generation: await worker.evaluate(() => globalThis.proofGeneration),
    ports: await worker.evaluate(() => globalThis.proofPorts),
  };
  assert.equal(receipt.before.manifest, '1.0.0');
  assert.equal(receipt.before.ports.length, 2);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second]) await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Start pending action' }).click();
  await expect(first.locator('#result')).toHaveText('Pending');
  await second.getByRole('button', { name: 'Execution counts' }).click();
  await expect(second.locator('#result')).toHaveText('{"started":1,"completed":0}');
  receipt.editAt = Date.now();
  await writeFile(panelPath, original + '\ndocument.body.dataset.hmrProof = "updated";\n');
  for (const page of [first, second]) {
    await expect(page.locator('body')).toHaveAttribute('data-hmr-proof', 'updated', { timeout: 30000 });
    await expect(page.locator('#status')).toHaveText('Connected');
    await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Increase counter', exact: true })).toHaveCount(1);
  }
  await expect(first.locator('#result')).toHaveText('Pending');
  receipt.after = {
    clickListeners: await clickListenerCount(first, '#routed'),
    timeOrigin: await first.evaluate(() => performance.timeOrigin),
    identity: await identity(first),
    generation: await worker.evaluate(() => globalThis.proofGeneration),
    ports: await worker.evaluate(() => globalThis.proofPorts),
  };
  assert.equal(receipt.before.clickListeners, 1);
  assert.equal(receipt.after.clickListeners, 1);
  assert.equal(receipt.after.timeOrigin, receipt.before.timeOrigin);
  assert.equal(receipt.after.generation, receipt.before.generation);
  assert.notEqual(receipt.after.identity.id, receipt.before.identity.id);
  assert.equal(receipt.after.ports.length, 4);
  assert.equal(receipt.after.ports.filter(port => port.disconnected === null).length, 2);
  await first.getByRole('button', { name: 'Routed increase', exact: true }).click();
  await expect(first.locator('#result')).toHaveText('2');
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second]) await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Release pending action' }).click();
  await second.getByRole('button', { name: 'Execution counts' }).click();
  await expect(second.locator('#result')).toHaveText('{"started":1,"completed":1}');
  await setTimeout(750);
  await expect(first.locator('#result')).toHaveText('2');
  for (const page of [first, second]) await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  receipt.finalPorts = await worker.evaluate(() => globalThis.proofPorts);
  assert.deepEqual(receipt.errors, []);
  await first.screenshot({ path: 'json-hmr.png', fullPage: true });
} catch (error) {
  failure = error;
  receipt.error = String(error);
} finally {
  const cleanup = await Promise.allSettled([server?.stop()]);
  receipt.nativeStopDisconnectedBrowser = !browser?.isConnected();
  if (browser?.isConnected()) cleanup.push(...await Promise.allSettled([browser.close()]));
  await writeFile(panelPath, original);
  receipt.restored = (await readFile(panelPath, 'utf8')) === original;
  receipt.cleanup = cleanup.map(result => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, error: String(result.reason) });
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
if (failure) throw failure;
assert.equal(receipt.nativeStopDisconnectedBrowser, true);
assert.equal(receipt.restored, true);
assert(receipt.cleanup.every(result => result.status === 'fulfilled'));
receipt.passed = true;
await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(JSON.stringify({ ...receipt, console: undefined }, null, 2));
