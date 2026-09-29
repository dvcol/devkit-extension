import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createNetworkServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { By } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { createServer } from 'wxt';

const repository = process.env.DEVKIT_REPOSITORY;
assert(repository, 'Set DEVKIT_REPOSITORY to the absolute maintained repository path');
assert.equal(process.env.PANEL_TEST_OWNERSHIP, 'available', 'Run only while this test owns panel.ts');
const firefoxBinary = '/Applications/Firefox.app/Contents/MacOS/firefox';
const geckodriverBinary = '/Users/dinh-van.colomban/.cache/selenium/geckodriver/mac-arm64/0.37.1/geckodriver';
const extensionId = 'managed-wxt-firefox-json-hmr@example.invalid';
const panelPath = `${repository}/examples/webext/src/panel.ts`;
const original = await readFile(panelPath);
const marker = crypto.randomUUID();
const receipt = {
  runId: crypto.randomUUID(), source: panelPath,
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  firefoxBinary, geckodriverBinary, extensionId, marker,
  profilePolicy: 'WXT/web-ext native fresh temporary profile',
  driverMode: 'geckodriver --connect-existing, WebDriver Classic',
  browserOwner: 'WXT native web-ext runner', events: [], passed: false,
};

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

function processRunning(processId) {
  try { process.kill(processId, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function waitFor(description, predicate) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await setTimeout(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const marionettePort = await availablePort();
const developmentPort = await availablePort();
Object.assign(receipt, { marionettePort, developmentPort });
await mkdir('entrypoints', { recursive: true });
await mkdir('logs', { recursive: true });
await writeFile('entrypoints/background.ts', `import { defineBackground } from 'wxt/utils/define-background';
import { startExampleBackground } from ${JSON.stringify(`${repository}/examples/webext/src/background.ts`)};
export default defineBackground({ type: 'module', main: startExampleBackground });
`);
await writeFile('entrypoints/panel.html', (await readFile(`${repository}/examples/webext/panel.html`, 'utf8')).replace('./src/panel.ts', panelPath));
await writeFile('wxt.config.ts', `import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: {
    name: 'Native Firefox JSON renderer HMR proof', version: '1.0.0',
    action: { default_popup: 'panel.html' },
    permissions: ['scripting'], host_permissions: ['http://127.0.0.1/*'],
    browser_specific_settings: { gecko: { id: ${JSON.stringify(extensionId)}, data_collection_permissions: { required: ['none'] } } },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*" },
  },
  vite: () => ({ server: { fs: { allow: [${JSON.stringify(process.cwd())}, ${JSON.stringify(repository)}] } } }),
  dev: { server: { host: '127.0.0.1', origin: 'http://127.0.0.1', port: ${developmentPort} } },
  webExt: {
    binaries: { firefox: ${JSON.stringify(firefoxBinary)} },
    firefoxArgs: ['--headless', '--marionette', '--remote-allow-system-access'],
    firefoxPref: { 'marionette.port': ${marionettePort} },
  },
});
`);
await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
let server;
let service;
let driver;
let browserProcess;
let edited = false;
let failure;

async function text(selector) {
  return driver.executeScript('return document.querySelector(arguments[0])?.textContent ?? null', selector);
}
async function expectText(selector, expected) {
  await waitFor(`${selector}: ${expected}`, async () => await text(selector) === expected);
}
async function click(selector) {
  await driver.findElement(By.css(selector)).click();
}
async function renderedIncrease() {
  const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
  await root.findElement(By.css('button')).click();
}
async function expectCounter(expected) {
  await waitFor(`rendered counter ${expected}`, async () => driver.executeScript(
    'return [...(document.querySelector("#renderer").shadowRoot?.querySelectorAll("*") ?? [])].some(element => element.textContent === arguments[0])', `Counter: ${expected}`,
  ));
}
async function identity() {
  await click('#identity');
  await waitFor('caller identity', async () => (await text('#result'))?.includes('panel.html'));
  return JSON.parse(await text('#result'));
}
async function observation() {
  return {
    timeOrigin: await driver.executeScript('return performance.timeOrigin'),
    provider: JSON.parse(await text('#provider')),
    identity: await identity(),
  };
}

try {
  server = await createServer({
    browser: 'firefox', manifestVersion: 3,
    hooks: {
      'server:started': () => receipt.events.push({ event: 'started', at: Date.now() }),
      'server:closed': () => receipt.events.push({ event: 'closed', at: Date.now() }),
    },
  });
  await server.start();
  service = new ServiceBuilder(geckodriverBinary)
    .addArguments('--connect-existing', '--marionette-port', String(marionettePort), '--allow-system-access')
    .setStdio('inherit').build();
  driver = Driver.createSession(new Options().setPageLoadStrategy('none'), service);
  const capabilities = await driver.getCapabilities();
  receipt.browserVersion = capabilities.getBrowserVersion();
  receipt.geckodriverVersion = capabilities.get('moz:geckodriverVersion');
  assert.equal(receipt.browserVersion, '156.0.1');
  browserProcess = capabilities.get('moz:processID');
  assert.equal(typeof browserProcess, 'number');
  receipt.browserProcess = browserProcess;
  const profile = capabilities.get('moz:profile');
  assert.equal(typeof profile, 'string');
  let nativeUuid;
  await waitFor('native installed extension UUID', async () => {
    const preferences = await readFile(`${profile}/prefs.js`, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''; throw error;
    });
    const line = preferences.split('\n').find((candidate) => candidate.startsWith('user_pref("extensions.webextensions.uuids", '));
    if (!line) return false;
    nativeUuid = JSON.parse(JSON.parse(line.slice('user_pref("extensions.webextensions.uuids", '.length, -2)))[extensionId];
    return typeof nativeUuid === 'string';
  });
  receipt.nativeIdentity = { profile, extensionId, nativeUuid };
  await driver.manage().setTimeouts({ pageLoad: 15_000, script: 10_000 });
  const first = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const second = await driver.getWindowHandle();
  const windows = [first, second];
  for (const window of windows) {
    await driver.switchTo().window(window);
    await driver.get(`moz-extension://${nativeUuid}/panel.html`);
    await expectText('#status', 'Connected');
    await expectCounter(0);
    await driver.executeScript(`window.proofErrors = [];
      window.addEventListener('error', event => window.proofErrors.push(event.message));
      window.addEventListener('unhandledrejection', event => window.proofErrors.push(String(event.reason)));`);
  }
  await driver.switchTo().window(first);
  receipt.before = await observation();
  await renderedIncrease();
  for (const window of windows) { await driver.switchTo().window(window); await expectCounter(1); }
  await driver.switchTo().window(first);
  await click('#wait');
  await expectText('#result', 'Pending');
  await driver.switchTo().window(second);
  await click('#executions');
  await expectText('#result', '{"started":1,"completed":0}');
  assert((await readFile(panelPath)).equals(original), 'panel.ts changed before controlled edit');
  receipt.editAt = Date.now();
  edited = true;
  await writeFile(panelPath, Buffer.concat([original, Buffer.from(`\ndocument.body.dataset.firefoxHmrProof = ${JSON.stringify(marker)};\n`)]));
  for (const window of windows) {
    await driver.switchTo().window(window);
    await waitFor('native module replacement marker', async () => await driver.executeScript('return document.body.dataset.firefoxHmrProof') === marker);
    await expectText('#status', 'Connected');
    await expectCounter(1);
    const root = await driver.findElement(By.css('#renderer')).getShadowRoot();
    assert.equal((await root.findElements(By.css('button'))).length, 1);
  }
  await driver.switchTo().window(first);
  await expectText('#result', 'Pending');
  receipt.after = await observation();
  assert.equal(receipt.after.timeOrigin, receipt.before.timeOrigin);
  assert.deepEqual(receipt.after.provider, receipt.before.provider);
  assert.notEqual(receipt.after.identity.id, receipt.before.identity.id);
  await click('#routed');
  await expectText('#result', '2');
  await renderedIncrease();
  for (const window of windows) { await driver.switchTo().window(window); await expectCounter(3); }
  await driver.switchTo().window(second);
  await click('#release');
  await waitFor('release action response', async () => await text('#result') !== 'Pending');
  await click('#executions');
  await expectText('#result', '{"started":1,"completed":1}');
  receipt.executions = JSON.parse(await text('#result'));
  await setTimeout(750);
  await driver.switchTo().window(first);
  await expectText('#result', '2');
  receipt.oldUiResultAfterCompletion = await text('#result');
  receipt.errors = [];
  for (const window of windows) {
    await driver.switchTo().window(window);
    await expectCounter(3);
    receipt.errors.push(...await driver.executeScript('return window.proofErrors'));
  }
  assert.deepEqual(receipt.errors, []);
  await writeFile('json-hmr.png', await driver.takeScreenshot(), 'base64');
} catch (error) {
  failure = error;
  receipt.error = String(error);
  if (driver) {
    const diagnostics = await Promise.allSettled([driver.getCurrentUrl(), driver.getPageSource()]);
    receipt.navigationDiagnostics = diagnostics.map((result) => result.status === 'fulfilled'
      ? { status: result.status, value: result.value.slice(0, 12_000) }
      : { status: result.status, error: String(result.reason) });
  }
} finally {
  const cleanup = await Promise.allSettled([server?.stop()]);
  if (browserProcess) {
    cleanup.push(...await Promise.allSettled([waitFor('owned Firefox process to exit', () => !processRunning(browserProcess))]));
    receipt.nativeStopClosedBrowser = !processRunning(browserProcess);
  }
  cleanup.push(...await Promise.allSettled([service?.kill()]));
  if (edited) await writeFile(panelPath, original);
  receipt.restored = (await readFile(panelPath)).equals(original);
  receipt.cleanup = cleanup.map((result) => result.status === 'fulfilled'
    ? { status: result.status } : { status: result.status, error: String(result.reason) });
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
if (failure) throw failure;
assert.equal(receipt.nativeStopClosedBrowser, true);
assert.equal(receipt.restored, true);
assert(receipt.cleanup.every((result) => result.status === 'fulfilled'));
receipt.passed = true;
await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(JSON.stringify(receipt, null, 2));
