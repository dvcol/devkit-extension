import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'wxt';
import { availablePort, createDevelopmentFixture } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/webext/tests/development-fixture.ts';

const root = await createDevelopmentFixture();
const observerPort = await availablePort();
const observations = [];
const failures = [];
let browser;
let page;
let phase = 'startup';
const server = await createServer({ root, vite: () => ({ cacheDir: `${root}/.wxt/vite-cache` }), browser: 'chrome', dev: { server: { port: await availablePort() } }, webExt: { binaries: { chrome: chromium.executablePath() }, chromiumArgs: ['--headless=new', `--remote-debugging-port=${observerPort}`] } });
try {
  await server.start();
  for (let iteration = 0; iteration < 10; iteration++) {
    await expect(async () => {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${observerPort}`, { timeout: 1000 });
    }).toPass({ timeout: 30_000, intervals: [100,250,500] });
    const context = browser.contexts()[0];
    context.on('weberror', error => failures.push({ event: 'pageerror', message: error.error().message, phase }));
    context.on('requestfailed', request => failures.push({ event: 'requestfailed', url: request.url(), failure: request.failure(), phase }));
    context.on('response', response => { if(response.status() >= 400) failures.push({event: 'response', url: response.url(), status: response.status(), phase}); });
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    const toggle = manager.locator('#devMode');
    if (!(await toggle.evaluate(element => element.hasAttribute('checked')))) await toggle.click();
    await expect(toggle).toHaveAttribute('checked', '');
    await manager.close();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    await expect(page.locator('#status')).toHaveText('Connected', {timeout:30_000});
    await expect(page.getByText('Counter: 0', {exact:true})).toBeVisible();
    await page.locator('#identity').click();
    await expect(page.locator('#result')).toContainText('panel.html');
    observations.push({ iteration, provider: await page.locator('#provider').innerText(), caller: await page.locator('#result').innerText(), manifest: await page.evaluate(()=>chrome.runtime.getManifest().version) });
    if (iteration === 9) break;
    phase = `restart-${iteration+1}`;
    const path = `${root}/wxt.config.ts`;
    await writeFile(path,(await readFile(path,'utf8')).replace(`version: '0.0.${iteration+1}'`, `version: '0.0.${iteration+2}'`));
    await expect.poll(() => browser.isConnected(), { timeout: 30_000 }).toBe(false);
  }
} catch(error) {
  failures.push({error:String(error),phase,html:await page?.content().catch(error=>String(error))});
  process.exitCode = 1;
} finally {
  await writeFile('/private/tmp/devkit-startup-diagnosis/chromium-receipt.json',JSON.stringify({observations,failures},null,2));
  await server.stop();
  await browser?.close();
  await rm(root,{recursive:true,force:true});
}
