import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'wxt';

const results = {};
const entry = resolve('fixtures/wxt/page.ts');
const source = await readFile(entry, 'utf8');
let server;
let context;
try {
  server = await createServer({ root: resolve('fixtures/wxt'), browser: 'chrome', manifestVersion: 3, webExt: { disabled: true }, dev: { server: { host: '127.0.0.1', port: 39271 } } });
  await server.start();
  const extensionPath = resolve('fixtures/wxt/.output/chrome-mv3-dev');
  context = await chromium.launchPersistentContext(resolve('chromium-dev-profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForFunction(() => document.querySelector('#result')?.textContent === 'background-ready');
  const initialTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  await writeFile(entry, source.replace('= reply.value;', "= reply.value + ':updated';"));
  await page.waitForFunction(() => document.querySelector('#result')?.textContent === 'background-ready:updated');
  const updatedTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  assert.equal(initialTimeOrigin, updatedTimeOrigin);
  results.extensionPageHmr = { initialTimeOrigin, updatedTimeOrigin, currentUrl: page.url(), text: await page.locator('#result').textContent() };
} finally {
  await context?.close();
  await server?.stop();
  await writeFile(entry, source);
  await writeFile('../wxt-development-results.json', JSON.stringify(results, null, 2) + '\n');
}
console.log(JSON.stringify(results, null, 2));
