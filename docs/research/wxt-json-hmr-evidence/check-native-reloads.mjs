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
export default defineBackground({ type: 'module', main() { startExampleBackground(); Reflect.set(globalThis, 'proofBackgroundVersion', 'before'); } });
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
  if (process.env.PROOF_ENABLE_DEVELOPER_MODE === '1') {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    receipt.developerModeBefore = await manager.locator('#devMode').evaluate(element => element.checked);
    if (!receipt.developerModeBefore) await manager.locator('#devMode').click();
    receipt.developerModeAfter = await manager.locator('#devMode').evaluate(element => element.checked);
    assert.equal(receipt.developerModeAfter, true);
    await manager.close();
  }
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
  const beforeHtml = await first.evaluate(() => performance.timeOrigin);
  const htmlPath = 'entrypoints/panel.html';
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(htmlPath, html.replace('<h1>Native Port proof</h1>', '<h1>Updated native Port proof</h1>'));
  for (const page of [first, second]) {
    await expect(page.getByRole('heading', { name: 'Updated native Port proof' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#status')).toHaveText('Connected');
    await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  }
  receipt.htmlReload = {
    beforeTimeOrigin: beforeHtml,
    afterTimeOrigin: await first.evaluate(() => performance.timeOrigin),
    backgroundGeneration: await worker.evaluate(() => globalThis.proofGeneration),
    provider: JSON.parse(await first.locator('#provider').innerText()),
  };
  assert.notEqual(receipt.htmlReload.afterTimeOrigin, beforeHtml);
  assert.equal(receipt.htmlReload.backgroundGeneration, receipt.before.generation);
  await first.getByRole('button', { name: 'Start pending action' }).click();
  await second.getByRole('button', { name: 'Execution counts' }).click();
  await expect(second.locator('#result')).toHaveText('{"started":2,"completed":1}');
  const nextWorkerPromise = context.waitForEvent('serviceworker', { predicate: candidate => candidate !== worker, timeout: 15000 }).catch(error => error);
  const oldWorkerClosed = worker.waitForEvent('close', { timeout: 15000 }).catch(error => error);
  const backgroundPath = 'entrypoints/background.ts';
  const backgroundSource = await readFile(backgroundPath, 'utf8');
  await writeFile(backgroundPath, backgroundSource.replace("'proofBackgroundVersion', 'before'", "'proofBackgroundVersion', 'after'"));
  const closeResult = await oldWorkerClosed;
  receipt.oldWorkerClose = closeResult instanceof Error ? String(closeResult) : 'closed';
  receipt.oldPages = await Promise.all([first, second].map(async page => ({ closed: page.isClosed(), status: page.isClosed() ? null : await page.locator('#status').textContent().catch(error => String(error)) })));
  const replacement = await context.newPage();
  receipt.navigationErrors = [];
  await expect(async () => {
    try { await replacement.goto(`chrome-extension://${extensionId}/panel.html`, { timeout: 2000 }); }
    catch (error) { receipt.navigationErrors.push(String(error)); throw error; }
  }).toPass({ timeout: 10000, intervals: [100, 250, 500] });
  const nextWorker = await nextWorkerPromise;
  if (nextWorker instanceof Error) throw nextWorker;
  await expect.poll(() => nextWorker.evaluate(() => globalThis.proofBackgroundVersion)).toBe('after');
  await expect(replacement.locator('#status')).toHaveText('Connected');
  await expect(replacement.getByText('Counter: 0', { exact: true })).toBeVisible();
  await replacement.getByRole('button', { name: 'Execution counts' }).click();
  await expect(replacement.locator('#result')).toHaveText('{"started":0,"completed":0}');
  await replacement.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await expect(replacement.getByText('Counter: 1', { exact: true })).toBeVisible();
  receipt.backgroundReload = {
    version: await nextWorker.evaluate(() => globalThis.proofBackgroundVersion),
    manifest: await replacement.evaluate(() => chrome.runtime.getManifest().version),
    provider: JSON.parse(await replacement.locator('#provider').innerText()),
    browserConnected: browser.isConnected(),
    oldFirstClosed: first.isClosed(),
    oldSecondClosed: second.isClosed(),
  };
  assert.equal(receipt.backgroundReload.manifest, '1.0.0');
  assert.notEqual(receipt.backgroundReload.provider.incarnation, receipt.htmlReload.provider.incarnation);
  assert.equal(receipt.backgroundReload.browserConnected, true);
  assert.deepEqual(receipt.errors, []);
  await replacement.screenshot({ path: 'native-reloads.png', fullPage: true });
} catch (error) {
  failure = error;
  receipt.error = String(error);
} finally {
  await writeFile(panelPath, original);
  const cleanup = await Promise.allSettled([server?.stop()]);
  receipt.nativeStopDisconnectedBrowser = !browser?.isConnected();
  if (browser?.isConnected()) cleanup.push(...await Promise.allSettled([browser.close()]));
  await writeFile(panelPath, original);
  receipt.restored = (await readFile(panelPath, 'utf8')) === original;
  receipt.cleanup = cleanup.map(result => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, error: String(result.reason) });
  await writeFile('reload-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
if (failure) throw failure;
assert.equal(receipt.nativeStopDisconnectedBrowser, true);
assert.equal(receipt.restored, true);
assert(receipt.cleanup.every(result => result.status === 'fulfilled'));
receipt.passed = true;
await writeFile('reload-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(JSON.stringify({ ...receipt, console: undefined }, null, 2));
