import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  inspectorMarkerSnapshot,
  readInspectorResponse,
  startInspectorFixture,
} from './inspector-fixture.ts';
import { inspectorHostHtml, startInspectorHost } from './inspector-hosts.ts';
import type { InspectorHost } from './inspector-hosts.ts';
import {
  checkResponse,
  connect,
  createDriver,
  dispatch,
  fulfilled,
  outcome,
  result,
  serverView,
  viewText,
} from './mixed-inspector-firefox-ui.ts';

const servers = ['example.devframe', 'example.devtools'];
const allProviders = ['example.extension', ...servers];
const checks = [
  'one packaged native JSON inspector broadcasts the same four shared actions to Firefox, Devframe and DevTools providers',
  'separate native connections mount identical inspector view keys with independent state and actual owned response URLs',
  'realm-only selection modifies both servers while leaving Firefox unchanged',
  'explicit provider selection resets only Devframe while preserving DevTools and Firefox state',
  'all-provider configuration and inspection succeed with modified bytes from three separate owned response endpoints',
  'all-provider marker affects each next document before its first parser script',
  'all-provider reset clears state and future marker injection without changing existing document markers',
  'one disconnected server rejects without rerouting while its sibling and Firefox still inspect their own responses',
];
const limitations = [
  'The two development hosts use public createHubContext/createKitContext through createRemoteContext and public initHub on actual Vite servers; this does not test viteDevframeHub or DevTools plugin bootstrap',
  'Each native connection uses its own temporary interactive-auth token and explicitly allows the actual extension origin; no origin rewrite or additional authorization policy is installed',
  'No global page-error capture through WebDriver Classic',
  'Panel operation rejection messages retain native generic errors; precise capability failures have separate service and extension proofs',
  'Server transformation owns one fixture response; this does not establish arbitrary third-party HTTP interception or production preview behavior',
];

const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile('artifacts/inspector/mixed-firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [inspector/mixed-firefox]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const extensionUuid = crypto.randomUUID();
  const driver = createDriver(extensionUuid);
  cleanup.defer(() => driver.quit());
  await driver.manage().setTimeouts({ script: 10_000 });
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.get(`moz-extension://${extensionUuid}/panel.html`);
  const panel = await driver.getWindowHandle();
  await result(driver, '#status', 'Connected');
  const extensionOrigin = await driver.executeScript<string>(
    () => `${location.protocol}//${location.host}`,
  );
  assert.equal(extensionOrigin, `moz-extension://${extensionUuid}`);
  const fixture = await startInspectorFixture();
  cleanup.defer(fixture.close);
  const devframe = await createHost('devframe', extensionOrigin, cleanup);
  const devtools = await createHost('devtools', extensionOrigin, cleanup);
  await connect(driver, devframe);
  await connect(driver, devtools);
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  await driver.get(`${fixture.origin}/inspector-fixture`);
  await driver.switchTo().window(panel);
  const hosts = { devframe, devtools, fixtureOrigin: fixture.origin };
  const selection = await checkSelection(driver, hosts);
  const modified = await checkAllProviders(driver, hosts);
  const marker = await checkMarkerReset(driver, { panel, source, hosts });
  const disconnected = await checkDisconnect(driver, hosts);
  await viewText(driver, '#renderer', 'Counter: 0');
  return {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    mode: 'production-extension-with-native-development-contexts',
    checks,
    observations: { selection, modified, marker, disconnected },
    limitations,
  };
}

interface Hosts {
  readonly devframe: InspectorHost;
  readonly devtools: InspectorHost;
  readonly fixtureOrigin: string;
}

async function createHost(
  mode: 'devframe' | 'devtools',
  extensionOrigin: string,
  cleanup: AsyncDisposableStack,
) {
  const directory = await mkdtemp(join(tmpdir(), `devkit-mixed-firefox-${mode}-`));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), inspectorHostHtml);
  const host = await startInspectorHost({ mode, extensionOrigin, directory });
  cleanup.defer(host.close);
  return host;
}

async function checkSelection(driver: Driver, hosts: Hosts) {
  const { devframe, devtools, fixtureOrigin } = hosts;
  const original = await dispatch(driver, 'all', 'Inspect response', allProviders);
  checkResponse(original, 'example.extension', fixtureOrigin, 'fixture:original');
  checkResponse(original, 'example.devframe', devframe.origin, 'fixture:original');
  checkResponse(original, 'example.devtools', devtools.origin, 'fixture:original');
  const viewKeys = await driver.executeScript<string[]>(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#server-views [data-view]')).map(
      (element) => element.dataset.view ?? '',
    ),
  );
  assert.equal(viewKeys.length, 2);
  assert.notEqual(viewKeys[0], '');
  assert.equal(viewKeys[0], viewKeys[1]);
  const configured = await dispatch(driver, 'servers', 'Enable response modification', servers);
  for (const provider of servers)
    assert.equal(fulfilled(configured, provider).configuration.enabled, true);
  await viewText(driver, '#inspector', 'Modification enabled: false');
  const inspected = await dispatch(driver, 'servers', 'Inspect response', servers);
  checkResponse(inspected, 'example.devframe', devframe.origin, 'native:fixture:original');
  checkResponse(inspected, 'example.devtools', devtools.origin, 'native:fixture:original');
  await viewText(driver, '#inspector', 'Response body: fixture:original');
  const explicit = await dispatch(driver, 'devframe', 'Reset inspector', ['example.devframe']);
  assert.equal(fulfilled(explicit, 'example.devframe').latest, null);
  await viewText(driver, serverView(devframe), 'Modification enabled: false');
  await viewText(driver, serverView(devframe), 'Response body: No response inspected');
  await viewText(driver, serverView(devtools), 'Modification enabled: true');
  await viewText(driver, serverView(devtools), 'Response body: native:fixture:original');
  return { original, viewKeys, configured, inspected, explicit };
}

async function checkAllProviders(driver: Driver, hosts: Hosts) {
  const configured = await dispatch(driver, 'all', 'Enable response modification', allProviders);
  for (const provider of allProviders) {
    const state = fulfilled(configured, provider);
    assert.equal(state.configuration.enabled, true);
    assert.equal(state.modification.status, 'available');
  }
  await viewText(driver, '#inspector', 'Configuration dispatch complete');
  const inspected = await dispatch(driver, 'all', 'Inspect response', allProviders);
  checkResponse(inspected, 'example.extension', hosts.fixtureOrigin, 'native:fixture:original');
  checkResponse(inspected, 'example.devframe', hosts.devframe.origin, 'native:fixture:original');
  checkResponse(inspected, 'example.devtools', hosts.devtools.origin, 'native:fixture:original');
  for (const selector of ['#inspector', serverView(hosts.devframe), serverView(hosts.devtools)]) {
    await viewText(driver, selector, 'Response body: native:fixture:original');
  }
  return { configured, inspected };
}

async function checkMarkerReset(
  driver: Driver,
  options: {
    readonly panel: string;
    readonly source: string;
    readonly hosts: Hosts;
  },
) {
  const { panel, source, hosts } = options;
  const documents = [source];
  for (const host of [hosts.devframe, hosts.devtools]) {
    await driver.switchTo().newWindow('tab');
    await driver.get(host.origin);
    documents.push(await driver.getWindowHandle());
  }
  await observeDocuments(driver, documents, { marker: null, reload: false });
  await driver.switchTo().window(panel);
  const installed = await dispatch(driver, 'all', 'Install page marker', allProviders);
  for (const provider of allProviders) assert.equal(fulfilled(installed, provider).marker, true);
  const active = await observeDocuments(driver, documents, { marker: 'loading', reload: true });
  await driver.switchTo().window(panel);
  const reset = await dispatch(driver, 'all', 'Reset inspector', allProviders);
  for (const provider of allProviders) {
    assert.partialDeepStrictEqual(fulfilled(reset, provider), {
      target: null,
      latest: null,
      configuration: { enabled: false },
      marker: false,
    });
  }
  await observeDocuments(driver, documents, { marker: 'loading', reload: false });
  const afterReset = await observeDocuments(driver, documents, { marker: null, reload: true });
  const original = [];
  for (const document of documents) {
    await driver.switchTo().window(document);
    const response =
      await driver.executeScript<Awaited<ReturnType<typeof readInspectorResponse>>>(
        readInspectorResponse,
      );
    assert.equal(response.body, 'fixture:original');
    original.push(response);
  }
  await driver.switchTo().window(panel);
  for (const selector of ['#inspector', serverView(hosts.devframe), serverView(hosts.devtools)]) {
    await viewText(driver, selector, 'Response body: No response inspected');
  }
  return { installed, active, reset, afterReset, original };
}

async function observeDocuments(
  driver: Driver,
  documents: string[],
  options: {
    readonly marker: 'loading' | null;
    readonly reload: boolean;
  },
) {
  const observations = [];
  for (const document of documents) {
    await driver.switchTo().window(document);
    if (options.reload) await driver.navigate().refresh();
    const snapshot = await driver.executeScript(inspectorMarkerSnapshot);
    assert.deepEqual(snapshot, {
      firstScript: { marker: options.marker, readyState: 'loading' },
      currentMarker: options.marker,
    });
    observations.push({ url: await driver.getCurrentUrl(), snapshot });
  }
  return observations;
}

async function checkDisconnect(driver: Driver, hosts: Hosts) {
  await hosts.devframe.close();
  await driver.wait(
    async () =>
      (await driver.findElements(By.css('[data-provider="example.devframe"]'))).length === 0,
    10_000,
  );
  await driver.wait(
    until.elementTextContains(driver.findElement(By.id('providers')), '"status":"unknown"'),
    10_000,
  );
  const inspected = await dispatch(driver, 'all', 'Inspect response', allProviders);
  assert.equal(outcome(inspected, 'example.devframe').status, 'rejected');
  checkResponse(inspected, 'example.devtools', hosts.devtools.origin, 'fixture:original');
  checkResponse(inspected, 'example.extension', hosts.fixtureOrigin, 'fixture:original');
  await viewText(driver, serverView(hosts.devtools), 'Response body: fixture:original');
  await viewText(driver, '#inspector', 'Response body: fixture:original');
  return inspected;
}
