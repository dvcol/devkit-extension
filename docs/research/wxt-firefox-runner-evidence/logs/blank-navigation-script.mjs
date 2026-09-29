import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createNetworkServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { By, until } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { createServer } from 'wxt';

const firefoxBinary = '/Applications/Firefox.app/Contents/MacOS/firefox';
const geckodriverBinary = '/Users/dinh-van.colomban/.cache/selenium/geckodriver/mac-arm64/0.37.1/geckodriver';
const extensionId = 'managed-wxt-firefox@example.invalid';
const extensionUuid = crypto.randomUUID();
const services = [];
const browserProcesses = [];
const lifecycle = [];
let observedDriver;

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
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitFor(description, predicate) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await setTimeout(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function attachFirefox(marionettePort) {
  const service = new ServiceBuilder(geckodriverBinary)
    .addArguments('--connect-existing', '--marionette-port', String(marionettePort), '--allow-system-access')
    .setStdio('inherit')
    .build();
  services.push(service);
  const driver = Driver.createSession(new Options().setPageLoadStrategy('none'), service);
  observedDriver = driver;
  const capabilities = await driver.getCapabilities();
  assert.equal(capabilities.getBrowserVersion(), '156.0.1');
  const processId = capabilities.get('moz:processID');
  assert.equal(typeof processId, 'number');
  browserProcesses.push(processId);
  await driver.manage().setTimeouts({ pageLoad: 15_000, script: 10_000 });
  return { driver, service, processId, browserVersion: capabilities.getBrowserVersion(), geckodriverVersion: capabilities.get('moz:geckodriverVersion') };
}

async function checkExtension(driver, expectedVersion) {
  await driver.get(`moz-extension://${extensionUuid}/popup.html`);
  const output = await driver.wait(until.elementLocated(By.id('result')), 15_000);
  await driver.wait(async () => (await output.getAttribute('data-manifest-version')) !== null, 15_000);
  const manifestVersion = await output.getAttribute('data-manifest-version');
  assert.equal(manifestVersion, expectedVersion);
  await driver.findElement(By.id('increment')).click();
  await driver.wait(async () => (await output.getText()).includes('requestId'), 10_000);
  const action = JSON.parse(await output.getText());
  assert.equal(action.version, expectedVersion);
  assert.equal(action.count, 1);
  assert.equal(typeof action.requestId, 'string');
  assert.equal(typeof action.generation, 'string');
  return { manifestVersion, action };
}

const marionettePort = await availablePort();
const developmentPort = await availablePort();
const receipt = {
  runId: crypto.randomUUID(),
  firefoxBinary,
  geckodriverBinary,
  profilePolicy: 'WXT/web-ext native fresh temporary profile',
  driverMode: 'geckodriver --connect-existing, WebDriver Classic',
  browserOwner: 'WXT native web-ext runner',
  marionettePort,
  developmentPort,
  extensionId,
  extensionUuid,
  lifecycle,
  browserProcesses,
};
const configuration = `import { defineConfig } from 'wxt';
export default defineConfig({
  imports: false,
  manifest: {
    name: 'Managed Firefox lifecycle proof', version: '1.0.0',
    browser_specific_settings: { gecko: { id: ${JSON.stringify(extensionId)}, data_collection_permissions: { required: ['none'] } } },
  },
  dev: { server: { host: '127.0.0.1', port: ${developmentPort} } },
  webExt: {
    binaries: { firefox: ${JSON.stringify(firefoxBinary)} },
    firefoxArgs: ['--headless', '--marionette', '--remote-allow-system-access'],
    firefoxPref: {
      'marionette.port': ${marionettePort},
      'extensions.webextensions.uuids': ${JSON.stringify(JSON.stringify({ [extensionId]: extensionUuid }))},
    },
  },
});
`;
await writeFile('wxt.config.ts', configuration);
await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
let server;
let failure;
try {
  server = await createServer({
    browser: 'firefox',
    manifestVersion: 3,
    hooks: {
      'server:started': () => lifecycle.push({ event: 'started', at: Date.now() }),
      'server:closed': () => lifecycle.push({ event: 'closed', at: Date.now() }),
    },
  });
  await server.start();
  const initial = await attachFirefox(marionettePort);
  receipt.browserVersion = initial.browserVersion;
  receipt.geckodriverVersion = initial.geckodriverVersion;
  receipt.before = await checkExtension(initial.driver, '1.0.0');
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  assert.equal((await readFile('wxt.config.ts', 'utf8')).match(/version: '1\.0\.0'/gu)?.length, 1);
  receipt.changeAt = Date.now();
  await writeFile('wxt.config.ts', configuration.replace("version: '1.0.0'", "version: '1.0.1'"));
  await waitFor('old Firefox process to close', () => !processRunning(initial.processId));
  receipt.initialBrowserClosedAt = Date.now();
  await initial.service.kill();
  await waitFor('second native server start', () => lifecycle.filter((event) => event.event === 'started').length === 2);
  const replacement = await attachFirefox(marionettePort);
  assert.notEqual(replacement.processId, initial.processId);
  receipt.after = await checkExtension(replacement.driver, '1.0.1');
  assert.notEqual(receipt.after.action.generation, receipt.before.action.generation);
  assert.notEqual(receipt.after.action.requestId, receipt.before.action.requestId);
  assert.deepEqual(lifecycle.map((event) => event.event), ['started', 'closed', 'started']);
  await server.stop();
  server = undefined;
  await waitFor('replacement Firefox process to close', () => !processRunning(replacement.processId));
  receipt.stopClosedBrowser = true;
  receipt.passed = true;
} catch (error) {
  failure = error;
  receipt.error = String(error);
  if (observedDriver) {
    const diagnostics = await Promise.allSettled([observedDriver.getCurrentUrl(), observedDriver.getPageSource()]);
    receipt.navigationDiagnostics = diagnostics.map((result) => result.status === 'fulfilled' ? { status: result.status, value: result.value.slice(0, 8000) } : { status: result.status, error: String(result.reason) });
  }
} finally {
  const cleanup = await Promise.allSettled([server?.stop()]);
  cleanup.push(...await Promise.allSettled(services.map((service) => service.kill())));
  cleanup.push(...await Promise.allSettled([waitFor('all owned Firefox processes to exit', () => browserProcesses.every((processId) => !processRunning(processId)))]));
  receipt.cleanup = cleanup.map((result) => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, error: String(result.reason) });
  receipt.remainingBrowserProcesses = browserProcesses.filter(processRunning);
  await writeFile('receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  assert(cleanup.every((result) => result.status === 'fulfilled'), 'Native runner and observer cleanup must succeed');
  assert.deepEqual(receipt.remainingBrowserProcesses, []);
}
if (failure) throw failure;
console.info(JSON.stringify(receipt, null, 2));
