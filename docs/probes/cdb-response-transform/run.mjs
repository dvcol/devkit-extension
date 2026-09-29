import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
const dependencyLoader = createRequire('/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/debugger/package.json');
const { chromium } = dependencyLoader('@playwright/test');
const profile = await mkdtemp('/private/tmp/devkit-cdb-fetch-profile-');
const serverRequests = [];
const server = createServer((request, response) => {
  serverRequests.push(request.url);
  response.setHeader('Cache-Control', 'no-store');
  if (request.url.startsWith('/selected')) { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('server:selected'); return; }
  if (request.url.startsWith('/unmatched')) { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('server:unmatched'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>CDB Fetch fixture</title>');
});
let browser;
const receipt = { passed: false, dependencies: { '@dvcol/cdb': dependencyLoader('/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/debugger/node_modules/@dvcol/cdb/package.json').version, '@dvcol/cdb-extension': dependencyLoader('/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/debugger/node_modules/@dvcol/cdb-extension/package.json').version }, cleanup: {} };
try {
  await new Promise((resolveListening, rejectListening) => { server.once('error', rejectListening); server.listen(0, '127.0.0.1', resolveListening); });
  const targetUrl = `http://127.0.0.1:${server.address().port}/fixture`;
  browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`] });
  receipt.browserVersion = browser.browser().version();
  receipt.executable = chromium.executablePath();
  const targetPage = await browser.newPage();
  await targetPage.goto(targetUrl);
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker', { timeout: 10_000 });
  const controlPage = await browser.newPage();
  await controlPage.goto(`chrome-extension://${new URL(worker.url()).hostname}/control.html`);
  const response = await controlPage.evaluate((url) => chrome.runtime.sendMessage({ kind: 'run', targetUrl: url }), targetUrl);
  receipt.response = response;
  assert.equal(response.passed, true, JSON.stringify(response));
  const { result, trace, pausedEvents } = response;
  const originalResponseBody = result.transformed.body.value.base64Encoded ? Buffer.from(result.transformed.body.value.body, 'base64').toString('utf8') : result.transformed.body.value.body;
  assert.equal(originalResponseBody, 'server:selected');
  assert.equal(result.transformed.event.parameters.responseStatusCode, 200);
  assert.deepEqual(result.initialRequests.value.result.value, [
    { path: '/selected?phase=active', status: 200, body: 'server:selected:transformed', probe: 'fulfilled' },
    { path: '/unmatched?phase=active', status: 200, body: 'server:unmatched', probe: null },
  ]);
  assert.equal(result.fetchDisableCountAfterClose, 0);
  assert.deepEqual(result.afterRelease.value.result.value, { status: 200, body: 'server:selected', probe: null });
  assert.equal(result.overflowed, false);
  assert.equal(result.droppedCount, 0);
  assert.equal(pausedEvents.length, 1);
  assert.equal(pausedEvents[0].url, `${new URL(targetUrl).origin}/selected?phase=active`);
  assert.equal(trace.filter((entry) => entry.method === 'Fetch.enable').length, 1);
  assert.equal(trace.find((entry) => entry.method === 'Fetch.enable').status, 'fulfilled');
  assert.deepEqual(trace.find((entry) => entry.method === 'Fetch.enable').parameters, result.fetchConfiguration);
  assert.equal(trace.filter((entry) => entry.method === 'Fetch.disable').length, 1);
  assert.equal(trace.find((entry) => entry.method === 'Fetch.disable').status, 'fulfilled');
  assert.equal(trace.filter((entry) => entry.method === 'attach').length, 1);
  assert.equal(trace.filter((entry) => entry.method === 'detach').length, 1);
  assert.equal(trace.find((entry) => entry.method === 'detach').status, 'fulfilled');
  assert.equal(response.listenerRemoved, true);
  assert.match(response.afterDetachError, /not attached/u);
  receipt.passed = true;
} catch (error) { receipt.error = String(error); process.exitCode = 1; }
finally {
  await browser?.close(); receipt.cleanup.browserClosed = true;
  if (server.listening) await new Promise((resolveClosed, rejectClosed) => server.close((error) => { if (error) rejectClosed(error); else resolveClosed(); })); receipt.cleanup.serverClosed = true;
  await rm(profile, { recursive: true, force: true }); receipt.cleanup.profileRemoved = true;
  receipt.serverRequests = serverRequests;
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
console.info(styleText(receipt.passed ? 'green' : 'red', '🧪 [cdb-fetch-probe]'), JSON.stringify({ passed: receipt.passed, browserVersion: receipt.browserVersion, error: receipt.error, cleanup: receipt.cleanup }));
