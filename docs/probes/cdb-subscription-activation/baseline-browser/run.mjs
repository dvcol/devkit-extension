import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { styleText } from 'node:util';
const dependencyLoader = createRequire('/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/debugger/package.json');
const { chromium } = dependencyLoader('@playwright/test');
const requests = [];
const server = createServer((request, response) => {
  requests.push({ url: request.url, at: Date.now() });
  response.setHeader('Cache-Control', 'no-store');
  if (request.url.startsWith('/selected')) { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('server:selected'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>CDB Fetch lifecycle fixture</title>');
});
const receipt = { passed: false, cases: [], cleanup: {}, dependencies: { '@dvcol/cdb': '0.3.0', '@dvcol/cdb-extension': '0.3.0' } };

async function poll(read, predicate, timeoutMilliseconds = 5000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) { await delay(25); value = await read(); }
  return value;
}

async function runCase(scenario, origin) {
  const profile = await mkdtemp('/private/tmp/devkit-cdb-fetch-lifecycle-profile-');
  const result = { scenario, passed: false, phases: {}, cleanup: {} };
  let browser;
  let control;
  async function send(kind, extra = {}) {
    const response = await control.evaluate((message) => chrome.runtime.sendMessage(message), { kind, ...extra });
    if (!response.success) throw new Error(JSON.stringify(response.error));
    return response.value;
  }
  try {
    browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`] });
    result.browserVersion = browser.browser().version();
    const targetPage = await browser.newPage();
    const targetUrl = `${origin}/fixture?scenario=${scenario}`;
    await targetPage.goto(targetUrl);
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker', { timeout: 10_000 });
    control = await browser.newPage();
    await control.goto(`chrome-extension://${new URL(worker.url()).hostname}/control.html`);
    await send('prepare', { targetUrl, scenario });
    const enableState = await poll(() => send('state'), (state) => state.nativeEnableComplete);
    assert.equal(enableState.nativeEnableComplete, true);
    if (scenario === 'activation-window') assert.equal(enableState.subscriptionReady, false);
    else assert.equal((await poll(() => send('state'), (state) => state.subscriptionReady)).subscriptionReady, true);
    await targetPage.evaluate((path) => {
      globalThis.lifecycleRequest = { status: 'pending', startedAt: Date.now() };
      fetch(path).then(async (response) => {
        globalThis.lifecycleRequest = { status: 'fulfilled', responseStatus: response.status, body: await response.text(), completedAt: Date.now() };
      }, (error) => { globalThis.lifecycleRequest = { status: 'rejected', error: String(error), completedAt: Date.now() }; });
    }, `/selected?scenario=${scenario}&phase=paused`);
    const nativePaused = await poll(() => send('state'), (state) => state.rawPausedEvents.length === 1);
    assert.equal(nativePaused.rawPausedEvents.length, 1);
    assert.equal(nativePaused.rawPausedEvents[0].responseStatusCode, 200);
    result.phases.nativePaused = { state: nativePaused, pageRequest: await targetPage.evaluate(() => globalThis.lifecycleRequest) };
    if (scenario === 'activation-window') {
      assert.equal(nativePaused.subscriptionReady, false);
      await send('release-enable');
      const ready = await poll(() => send('state'), (state) => state.subscriptionReady);
      assert.equal(ready.subscriptionReady, true);
      await delay(250);
      const afterReady = await send('state');
      result.phases.afterSubscriptionReady = { state: afterReady, pageRequest: await targetPage.evaluate(() => globalThis.lifecycleRequest) };
      assert.equal(afterReady.deliveredEvents.length, 0);
      assert.equal(result.phases.afterSubscriptionReady.pageRequest.status, 'pending');
    } else {
      const bodyRead = await poll(() => send('state'), (state) => state.bodyCompletedAt !== undefined);
      assert.equal(bodyRead.decodedBody, 'server:selected');
      assert.equal(bodyRead.deliveredEvents.length, 1);
      result.phases.afterBodyRead = { state: bodyRead, pageRequest: await targetPage.evaluate(() => globalThis.lifecycleRequest) };
      assert.equal(result.phases.afterBodyRead.pageRequest.status, 'pending');
    }
    await send('close');
    await delay(250);
    const afterClose = await send('state');
    result.phases.afterClose = { state: afterClose, pageRequest: await targetPage.evaluate(() => globalThis.lifecycleRequest) };
    if (scenario === 'cancel-after-body-read') {
      assert.equal(afterClose.trace.filter((entry) => entry.method === 'Fetch.disable').length, 0);
      assert.equal(result.phases.afterClose.pageRequest.status, 'pending');
    }
    await send('release-lease');
    const afterRelease = await poll(() => send('state'), (state) => state.trace.some((entry) => entry.method === 'Fetch.disable' && entry.status !== 'pending'));
    assert.equal(afterRelease.trace.find((entry) => entry.method === 'Fetch.disable')?.status, 'fulfilled');
    const originalAfterRelease = await poll(() => targetPage.evaluate(() => globalThis.lifecycleRequest), (request) => request.status !== 'pending', 3000);
    result.phases.afterRelease = { state: afterRelease, pageRequest: originalAfterRelease };
    await targetPage.evaluate((path) => {
      globalThis.subsequentRequest = { status: 'pending' };
      fetch(path).then(async (response) => { globalThis.subsequentRequest = { status: 'fulfilled', body: await response.text() }; }, (error) => { globalThis.subsequentRequest = { status: 'rejected', error: String(error) }; });
    }, `/selected?scenario=${scenario}&phase=after-release`);
    result.subsequentRequest = await poll(() => targetPage.evaluate(() => globalThis.subsequentRequest), (request) => request.status !== 'pending', 3000);
    result.finalState = await send('detach');
    result.phases.afterDetach = { pageRequest: await poll(() => targetPage.evaluate(() => globalThis.lifecycleRequest), (request) => request.status !== 'pending', 3000) };
    assert.equal(result.finalState.trace.filter((entry) => entry.method === 'attach').length, 1);
    assert.equal(result.finalState.trace.filter((entry) => entry.method === 'detach' && entry.status === 'fulfilled').length, 1);
    assert.equal(result.finalState.listenerRemoved, true);
    assert.deepEqual(result.finalState.errors, []);
    result.passed = true;
  } catch (error) {
    result.error = String(error);
    if (control !== undefined) result.failureState = await send('state').catch((stateError) => ({ error: String(stateError) }));
  } finally {
    if (control !== undefined) await send('detach').catch((error) => { result.cleanup.extensionError = String(error); });
    await browser?.close(); result.cleanup.browserClosed = true;
    await rm(profile, { recursive: true, force: true }); result.cleanup.profileRemoved = true;
    await writeFile(`${scenario}.json`, JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}

try {
  await new Promise((resolveListening, rejectListening) => { server.once('error', rejectListening); server.listen(0, '127.0.0.1', resolveListening); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const scenario of ['activation-window', 'cancel-after-body-read']) receipt.cases.push(await runCase(scenario, origin));
  receipt.passed = receipt.cases.every((result) => result.passed);
  if (!receipt.passed) process.exitCode = 1;
} catch (error) { receipt.error = String(error); process.exitCode = 1; }
finally {
  if (server.listening) await new Promise((resolveClosed, rejectClosed) => server.close((error) => { if (error) rejectClosed(error); else resolveClosed(); }));
  receipt.cleanup.serverClosed = true;
  receipt.serverRequests = requests;
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
console.info(styleText(receipt.passed ? 'green' : 'red', '🧪 [cdb-fetch-lifecycle]'), JSON.stringify({ passed: receipt.passed, cases: receipt.cases.map((result) => ({ scenario: result.scenario, passed: result.passed, error: result.error, afterClose: result.phases.afterClose?.pageRequest, afterRelease: result.phases.afterRelease?.pageRequest, afterDetach: result.phases.afterDetach?.pageRequest, subsequentRequest: result.subsequentRequest })), error: receipt.error }));
