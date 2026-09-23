import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, createServer, preview } from 'vite';

const results = {};
const webRoot = resolve('fixtures/web');
const valueFile = resolve(webRoot, 'value.ts');
const initialSource = "export const value = 'initial';\n";
const browser = await chromium.launch({ channel: 'chromium', headless: true });
results.chromiumVersion = browser.version();
let developmentServer;
let previewServer;
let watcher;
let extensionContext;
let fixtureServer;

function nextBuildEvent(expectedCode) {
  return new Promise((resolveEvent, rejectEvent) => {
    const timeout = setTimeout(() => {
      watcher.off('event', onEvent);
      rejectEvent(new Error(`Timed out waiting for ${expectedCode}`));
    }, 15000);
    function onEvent(event) {
      if (event.code !== expectedCode) return;
      clearTimeout(timeout);
      watcher.off('event', onEvent);
      resolveEvent(event);
    }
    watcher.on('event', onEvent);
  });
}

try {
  await writeFile(valueFile, initialSource);
  developmentServer = await createServer({ root: webRoot, configFile: false, server: { host: '127.0.0.1', port: 0 } });
  await developmentServer.listen();
  const developmentPage = await browser.newPage();
  await developmentPage.goto(developmentServer.resolvedUrls.local[0]);
  await developmentPage.waitForFunction(() => document.querySelector('#result')?.textContent === 'initial');
  const initialLoads = await developmentPage.evaluate(() => sessionStorage.getItem('page-loads'));
  await writeFile(valueFile, "export const value = 'hmr-updated';\n");
  await developmentPage.waitForFunction(() => document.querySelector('#result')?.textContent === 'hmr-updated');
  const updatedLoads = await developmentPage.evaluate(() => sessionStorage.getItem('page-loads'));
  assert.equal(initialLoads, updatedLoads);
  results.viteDevelopmentHmr = { initialLoads, updatedLoads, text: await developmentPage.locator('#result').textContent() };
  await developmentPage.close();
  await developmentServer.close();
  developmentServer = undefined;

  await writeFile(valueFile, initialSource);
  watcher = await build({ root: webRoot, configFile: false, build: { watch: {}, minify: false } });
  await nextBuildEvent('END');
  previewServer = await preview({ root: webRoot, configFile: false, preview: { host: '127.0.0.1', port: 0 } });
  const previewPage = await browser.newPage();
  await previewPage.goto(previewServer.resolvedUrls.local[0]);
  await previewPage.waitForFunction(() => document.querySelector('#result')?.textContent === 'initial');
  const changedBuild = nextBuildEvent('END');
  await writeFile(valueFile, "export const value = 'watch-updated';\n");
  await changedBuild;
  assert.equal(await previewPage.locator('#result').textContent(), 'initial');
  const beforeManualReload = await previewPage.locator('#result').textContent();
  await previewPage.reload();
  await previewPage.waitForFunction(() => document.querySelector('#result')?.textContent === 'watch-updated');
  const lastValidHtml = await readFile(resolve(webRoot, 'dist/index.html'), 'utf8');
  const failedBuild = nextBuildEvent('ERROR');
  await writeFile(valueFile, "export const value = ;\n");
  const failure = await failedBuild;
  const retainedHtml = await readFile(resolve(webRoot, 'dist/index.html'), 'utf8');
  assert.equal(lastValidHtml, retainedHtml);
  const recoveredBuild = nextBuildEvent('END');
  await writeFile(valueFile, "export const value = 'recovered';\n");
  await recoveredBuild;
  await previewPage.reload();
  await previewPage.waitForFunction(() => document.querySelector('#result')?.textContent === 'recovered');
  results.viteWatchPreview = { beforeManualReload, afterManualReload: 'watch-updated', invalidBuildEvent: failure.code, retainedLastHtml: retainedHtml === lastValidHtml, recoveredText: await previewPage.locator('#result').textContent() };
  await previewPage.close();
  await watcher.close();
  watcher = undefined;
  await new Promise((resolveClose) => previewServer.httpServer.close(resolveClose));
  previewServer = undefined;

  const reports = [];
  fixtureServer = createHttpServer((request, response) => {
    if (request.url === '/extension-report') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => { reports.push(JSON.parse(body)); response.writeHead(200).end('ok'); });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body>extension fixture</body></html>');
  });
  await new Promise((resolveListen) => fixtureServer.listen(0, '127.0.0.1', resolveListen));
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`;
  const extensionPath = resolve('fixtures/wxt/.output/chrome-mv3');
  extensionContext = await chromium.launchPersistentContext(resolve('chromium-profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let [worker] = extensionContext.serviceWorkers();
  if (!worker) worker = await extensionContext.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const contentPage = await extensionContext.newPage();
  await contentPage.goto(fixtureUrl);
  await contentPage.waitForFunction(() => document.documentElement.dataset.extensionProbe === 'background-ready');
  const extensionPages = {};
  for (const surface of ['popup', 'options', 'sidepanel', 'devtools']) {
    const page = await extensionContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/${surface}.html`);
    await page.waitForFunction(() => document.querySelector('#result')?.textContent === 'background-ready');
    extensionPages[surface] = await page.locator('#result').textContent();
    await page.close();
  }
  results.wxtChromiumProduction = { contentScript: await contentPage.evaluate(() => document.documentElement.dataset.extensionProbe), extensionPages, reports };
} finally {
  await developmentServer?.close();
  await watcher?.close();
  if (previewServer) await new Promise((resolveClose) => previewServer.httpServer.close(resolveClose));
  await extensionContext?.close();
  if (fixtureServer) await new Promise((resolveClose) => fixtureServer.close(resolveClose));
  await browser.close();
  await writeFile(valueFile, initialSource);
  await writeFile('../browser-results.json', JSON.stringify(results, null, 2) + '\n');
}
console.log(JSON.stringify(results, null, 2));
