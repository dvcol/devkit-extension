import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.BROWSER_RESEARCH_PLAYWRIGHT));
const experimentDirectory = resolve('.browser-experiment');
const extensionDirectory = resolve(experimentDirectory, 'extension');
await mkdir(extensionDirectory, { recursive: true });
const result = { timestamp: new Date().toISOString(), assertions: [], observations: {} };

const fixtureServer = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/body') {
    response.setHeader('Content-Type', 'text/plain');
    response.end('original-body');
    return;
  }
  if (request.url === '/headers') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Original', 'server-value');
    response.end(JSON.stringify(request.headers));
    return;
  }
  if (request.url === '/html') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><script>globalThis.htmlParserMarker = globalThis.injectedHtmlMarker ?? "missing";</script></head><body>original-html</body></html>');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><html><head><script>globalThis.parserSnapshot = {main: globalThis.mainMarker, isolated: globalThis.isolatedMarker, order: globalThis.executionOrder};</script></head><body>fixture</body></html>');
});
await new Promise((resolveListen, rejectListen) => {
  fixtureServer.once('error', rejectListen);
  fixtureServer.listen(0, '127.0.0.1', resolveListen);
});
const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
await writeFile(resolve(extensionDirectory, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'Portable SDK browser research',
  version: '0.0.1',
  permissions: ['debugger', 'scripting', 'storage', 'tabs', 'declarativeNetRequest'],
  host_permissions: ['http://127.0.0.1/*'],
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches: ['http://127.0.0.1/*'], js: ['main.js'], run_at: 'document_start', world: 'MAIN' },
    { matches: ['http://127.0.0.1/*'], js: ['isolated.js'], run_at: 'document_start', world: 'ISOLATED' },
  ],
}));
await writeFile(resolve(extensionDirectory, 'main.js'), 'globalThis.mainMarker = "main-before-parser"; globalThis.executionOrder = ["main"]; globalThis.mainRuntimeType = typeof globalThis.chrome?.runtime?.sendMessage;');
await writeFile(resolve(extensionDirectory, 'isolated.js'), 'globalThis.isolatedMarker = "isolated"; globalThis.isolatedRuntimeType = typeof chrome.runtime.sendMessage;');
await writeFile(resolve(extensionDirectory, 'background.js'), `
globalThis.events = [];
globalThis.errors = [];
chrome.debugger.onDetach.addListener((source, reason) => globalThis.events.push({ kind: 'detach', source, reason }));
chrome.debugger.onEvent.addListener(async (source, method, parameters) => {
  if (method !== 'Fetch.requestPaused') return;
  try {
    const body = await chrome.debugger.sendCommand(source, 'Fetch.getResponseBody', { requestId: parameters.requestId });
    globalThis.events.push({ kind: 'paused', url: parameters.request.url, body });
    let replacement = 'transformed-body';
    let contentType = 'text/plain';
    if (parameters.request.url.endsWith('/html')) {
      const original = body.base64Encoded ? atob(body.body) : body.body;
      replacement = original.replace('<head>', '<head><script>globalThis.injectedHtmlMarker = "before-original-parser";</script>');
      contentType = 'text/html';
    }
    await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
      requestId: parameters.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: contentType }, { name: 'X-Transformed', value: 'yes' }],
      body: btoa(replacement),
    });
  } catch (error) { globalThis.errors.push(String(error)); }
});
`);

let browserContext;
try {
  const profileDirectory = await mkdtemp(resolve(experimentDirectory, 'profile-'));
  browserContext = await chromium.launchPersistentContext(profileDirectory, {
    executablePath: process.env.BROWSER_RESEARCH_CHROMIUM,
    headless: true,
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
  });
  browserContext.setDefaultTimeout(10000);
  result.browserVersion = browserContext.browser().version();
  let backgroundWorker = browserContext.serviceWorkers()[0];
  if (!backgroundWorker) backgroundWorker = await browserContext.waitForEvent('serviceworker');
  const fixturePage = await browserContext.newPage();
  await fixturePage.goto(fixtureOrigin);
  result.observations.parser = await fixturePage.evaluate(() => ({ ...globalThis.parserSnapshot, mainRuntimeType: globalThis.mainRuntimeType }));
  assert.equal(result.observations.parser.main, 'main-before-parser');
  assert.equal(result.observations.parser.isolated, undefined);
  assert.equal(result.observations.parser.mainRuntimeType, 'undefined');
  result.assertions.push('Static MAIN document_start precedes parser script; ISOLATED globals stay separate; MAIN has no runtime messaging');
  const tabId = await backgroundWorker.evaluate(async fixtureUrl => (await chrome.tabs.query({ url: fixtureUrl + '/*' }))[0].id, fixtureOrigin);
  result.observations.isolated = await backgroundWorker.evaluate(async selectedTabId => chrome.scripting.executeScript({
    target: { tabId: selectedTabId },
    world: 'ISOLATED',
    func: () => ({ marker: globalThis.isolatedMarker, messaging: globalThis.isolatedRuntimeType, debuggerType: typeof chrome.debugger }),
  }), tabId);
  assert.equal(result.observations.isolated[0].result.marker, 'isolated');
  assert.equal(result.observations.isolated[0].result.messaging, 'function');
  assert.equal(result.observations.isolated[0].result.debuggerType, 'undefined');
  result.assertions.push('ISOLATED script can message extension and cannot directly access chrome.debugger');
  await backgroundWorker.evaluate(async fixtureUrl => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{ id: 1, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'X-Research', operation: 'set', value: 'extension-value' }], responseHeaders: [{ header: 'X-Research-Response', operation: 'set', value: 'extension-value' }] }, condition: { urlFilter: fixtureUrl + '/headers', resourceTypes: ['xmlhttprequest'] } }],
  }), fixtureOrigin);
  result.observations.headers = await fixturePage.evaluate(async () => {
    const response = await fetch('/headers');
    return { responseHeader: response.headers.get('X-Research-Response'), requestHeaders: await response.json() };
  });
  assert.equal(result.observations.headers.responseHeader, 'extension-value');
  assert.equal(result.observations.headers.requestHeaders['x-research'], 'extension-value');
  result.assertions.push('DNR changes request and response headers');
  await backgroundWorker.evaluate(async selectedTabId => chrome.debugger.attach({ tabId: selectedTabId }, '1.3'), tabId);
  result.observations.debugger = await backgroundWorker.evaluate(async selectedTabId => {
    const evaluation = await chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Runtime.evaluate', { expression: '6 * 7', returnByValue: true });
    let restrictedDomainError;
    try { await chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Browser.getVersion'); } catch (error) { restrictedDomainError = String(error); }
    return { evaluation, restrictedDomainError };
  }, tabId);
  assert.equal(result.observations.debugger.evaluation.result.value, 42);
  assert.ok(result.observations.debugger.restrictedDomainError);
  result.assertions.push('Runtime.evaluate works through extension debugger; Browser.getVersion is rejected');
  await backgroundWorker.evaluate(async ({ selectedTabId, fixtureUrl }) => chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Fetch.enable', { patterns: [{ urlPattern: fixtureUrl + '/body', requestStage: 'Response' }, { urlPattern: fixtureUrl + '/html', requestStage: 'Response' }] }), { selectedTabId: tabId, fixtureUrl: fixtureOrigin });
  result.observations.transformation = await fixturePage.evaluate(async () => {
    const response = await fetch('/body');
    return { body: await response.text(), transformedHeader: response.headers.get('X-Transformed') };
  });
  assert.deepEqual(result.observations.transformation, { body: 'transformed-body', transformedHeader: 'yes' });
  result.assertions.push('Extension debugger Fetch Response-stage getResponseBody + fulfillRequest changes body and header');
  await fixturePage.goto(fixtureOrigin + '/html');
  result.observations.htmlTransformation = await fixturePage.evaluate(() => ({ marker: globalThis.htmlParserMarker, body: document.body.textContent }));
  assert.deepEqual(result.observations.htmlTransformation, { marker: 'before-original-parser', body: 'original-html' });
  result.assertions.push('Response-stage HTML transform injects script before original parser script while preserving fixture body');
  await backgroundWorker.evaluate(async selectedTabId => chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Fetch.disable'), tabId);
  await backgroundWorker.evaluate(async selectedTabId => chrome.debugger.detach({ tabId: selectedTabId }), tabId);
  result.observations.afterDetach = await fixturePage.evaluate(async () => (await fetch('/body')).text());
  assert.equal(result.observations.afterDetach, 'original-body');
  result.assertions.push('Explicit detach after disabling Fetch restores original body');
  const restrictedPage = await browserContext.newPage();
  await restrictedPage.goto('chrome://version');
  result.observations.restrictedTarget = await backgroundWorker.evaluate(async () => {
    const restrictedTab = (await chrome.tabs.query({ url: 'chrome://version/' }))[0];
    try { await chrome.scripting.executeScript({ target: { tabId: restrictedTab.id }, func: () => true }); return 'unexpected-success'; } catch (error) { return String(error); }
  });
  assert.match(result.observations.restrictedTarget, /Cannot access a chrome:\/\/ URL/);
  result.assertions.push('Injection into chrome://version is rejected');
  result.observations.events = await backgroundWorker.evaluate(() => ({ events: globalThis.events, errors: globalThis.errors }));
  assert.deepEqual(result.observations.events.errors, []);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await browserContext?.close();
  await new Promise(resolveClose => fixtureServer.close(resolveClose));
  await writeFile(resolve(experimentDirectory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
