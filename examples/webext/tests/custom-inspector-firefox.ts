import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { readInspectorAction } from '@devkit/example-contribution/inspector';
import { By, until } from 'selenium-webdriver';
import { inspectorMarkerSnapshot, startInspectorFixture } from './inspector-fixture.ts';
import { inspectorHostHtml, startInspectorHost } from './inspector-hosts.ts';
import type { InspectorHost } from './inspector-hosts.ts';
import {
  checkResponse,
  connect,
  createDriver,
  dispatch,
  fulfilled,
  result,
  serverView,
  viewText,
} from './mixed-inspector-firefox-ui.ts';

type FirefoxDriver = ReturnType<typeof createDriver>;
const providers = ['example.extension', 'example.devframe', 'example.devtools'];
const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile('artifacts/inspector/custom-firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [inspector/custom-firefox]'), receipt);

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
  const fixture = await startInspectorFixture();
  cleanup.defer(fixture.close);
  const hosts = [];
  for (const mode of ['devframe', 'devtools'] as const) {
    const host = await createHost(mode, extensionOrigin, cleanup);
    await connect(driver, host);
    hosts.push(host);
  }
  const provider = await driver.findElement(By.id('provider')).getText();
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  await driver.get(`${fixture.origin}/inspector-fixture`);
  await driver.switchTo().window(panel);
  await select(driver, 'custom');
  const selection = await checkSelection(driver, hosts, fixture.origin);
  const replacement = await checkReplacement(driver, hosts);
  const marker = await checkMarker(driver, { source, panel });
  const disconnected = await checkDisconnect(driver, hosts);
  assert.equal(await driver.findElement(By.id('provider')).getText(), provider);
  return {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    mode: 'production-extension-custom-renderer',
    checks: customChecks(),
    observations: { selection, replacement, marker, disconnected },
    limitations: [
      'Native development contexts use initHub on owned Vite fixtures, not plugin bootstrap',
      'Server cards use the native reference renderer',
      'No global page-error capture through WebDriver Classic',
    ],
  };
}

async function createHost(
  mode: 'devframe' | 'devtools',
  extensionOrigin: string,
  cleanup: AsyncDisposableStack,
) {
  const directory = await mkdtemp(join(tmpdir(), `devkit-custom-firefox-${mode}-`));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), inspectorHostHtml);
  const host = await startInspectorHost({ mode, extensionOrigin, directory });
  cleanup.defer(host.close);
  return host;
}

async function select(driver: FirefoxDriver, renderer: 'reference' | 'custom') {
  const control = driver.findElement(By.id('inspector-renderer'));
  await driver.wait(until.elementIsEnabled(control), 10_000);
  await driver.findElement(By.css(`#inspector-renderer option[value="${renderer}"]`)).click();
  await driver.wait(until.elementIsEnabled(control), 10_000);
  await driver.wait(
    () =>
      driver.executeScript<boolean>((expected: string) => {
        const container = document.querySelector('#inspector');
        const root = container?.shadowRoot ?? container;
        return (
          (root?.querySelector('[data-renderer="custom"]') !== null) === (expected === 'custom') &&
          root?.querySelectorAll('button').length === 5
        );
      }, renderer),
    10_000,
  );
}

async function checkSelection(
  driver: FirefoxDriver,
  hosts: InspectorHost[],
  fixtureOrigin: string,
) {
  const servers = hosts.map((host) => host.provider.provider.id);
  const configured = await dispatch(driver, 'servers', 'Enable response modification', servers);
  for (const provider of servers)
    assert.equal(fulfilled(configured, provider).configuration.enabled, true);
  await viewText(driver, '#inspector', 'Modification enabled: false');
  const explicit = await dispatch(driver, 'devframe', 'Reset inspector', ['example.devframe']);
  assert.equal(fulfilled(explicit, 'example.devframe').configuration.enabled, false);
  await viewText(
    driver,
    '[data-provider="example.devtools"] [data-view]',
    'Modification enabled: true',
  );
  const all = await dispatch(driver, 'all', 'Enable response modification', providers);
  for (const provider of providers)
    assert.equal(fulfilled(all, provider).configuration.enabled, true);
  await viewText(driver, '#inspector', 'Configuration dispatch complete');
  const inspected = await dispatch(driver, 'all', 'Inspect response', providers);
  checkResponse(inspected, 'example.extension', fixtureOrigin, 'native:fixture:original');
  for (const host of hosts) {
    checkResponse(inspected, host.provider.provider.id, host.origin, 'native:fixture:original');
    await viewText(driver, serverView(host), 'Response body: native:fixture:original');
  }
  await viewText(driver, '#inspector', 'Inspection dispatch complete');
  return { configured, explicit, all, inspected };
}

async function retainButton(driver: FirefoxDriver, label: string) {
  await driver.executeScript((expected: string) => {
    const root = document.querySelector('#inspector')?.shadowRoot;
    const button = Array.from(root?.querySelectorAll('button') ?? []).find(
      (candidate) => candidate.textContent === expected,
    );
    if (button === undefined) throw new Error('Inspector button is unavailable');
    Reflect.set(window, '__retainedInspectorButton', button);
  }, label);
}

function clickRetained(driver: FirefoxDriver) {
  return driver.executeScript<boolean>(() => {
    const button: unknown = Reflect.get(window, '__retainedInspectorButton');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Retained inspector button is unavailable');
    Reflect.deleteProperty(window, '__retainedInspectorButton');
    button.click();
    return button.isConnected;
  });
}

async function checkReplacement(driver: FirefoxDriver, hosts: InspectorHost[]) {
  await retainButton(driver, 'Reset inspector');
  await select(driver, 'reference');
  const before = await driver.findElement(By.id('json-result')).getText();
  const detachedConnected = await clickRetained(driver);
  assert.equal(detachedConnected, false);
  assert.equal(await driver.findElement(By.id('json-result')).getText(), before);
  const preserved = await dispatch(driver, 'all', 'Inspect response', providers);
  for (const provider of providers)
    assert.equal(fulfilled(preserved, provider).configuration.enabled, true);
  await select(driver, 'custom');
  await viewText(driver, '#inspector', 'Response body: native:fixture:original');
  assert.equal(
    await driver.executeScript<boolean>(
      () =>
        document
          .querySelector('#inspector')
          ?.shadowRoot?.textContent?.includes('Inspection dispatch complete') === true,
    ),
    false,
  );
  for (const host of hosts) await viewText(driver, serverView(host), 'Modification enabled: true');
  return { preserved, detachedConnected };
}

async function checkMarker(driver: FirefoxDriver, windows: { source: string; panel: string }) {
  const installed = await dispatch(driver, 'all', 'Install page marker', providers);
  for (const provider of providers) assert.equal(fulfilled(installed, provider).marker, true);
  await driver.switchTo().window(windows.source);
  await driver.navigate().refresh();
  const active = await driver.executeScript(inspectorMarkerSnapshot);
  assert.deepEqual(active, {
    firstScript: { marker: 'loading', readyState: 'loading' },
    currentMarker: 'loading',
  });
  await driver.switchTo().window(windows.panel);
  const reset = await dispatch(driver, 'all', 'Reset inspector', providers);
  for (const provider of providers)
    assert.partialDeepStrictEqual(fulfilled(reset, provider), {
      latest: null,
      configuration: { enabled: false },
      marker: false,
    });
  await viewText(driver, '#inspector', 'Reset dispatch complete');
  await driver.switchTo().window(windows.source);
  await driver.navigate().refresh();
  const afterReset = await driver.executeScript(inspectorMarkerSnapshot);
  assert.deepEqual(afterReset, {
    firstScript: { marker: null, readyState: 'loading' },
    currentMarker: null,
  });
  await driver.switchTo().window(windows.panel);
  return { installed, active, reset, afterReset };
}

async function checkDisconnect(driver: FirefoxDriver, hosts: InspectorHost[]) {
  await retainButton(driver, 'Enable response modification');
  await driver.findElement(By.id('disconnect')).click();
  await result(driver, '#status', 'Disconnected');
  await driver.wait(
    until.elementIsDisabled(driver.findElement(By.id('inspector-renderer'))),
    10_000,
  );
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        () =>
          document.querySelector('#inspector')?.shadowRoot?.querySelectorAll('button').length === 0,
      ),
    10_000,
  );
  assert.equal((await driver.findElements(By.css('#server-views > *'))).length, 0);
  const detachedConnected = await clickRetained(driver);
  assert.equal(detachedConnected, false);
  const states = [];
  for (const host of hosts) {
    const current = await host.provider.invoke({ action: readInspectorAction, input: {} });
    assert.equal(current.configuration.enabled, false);
    states.push({ provider: host.provider.provider.id, state: current });
  }
  return { states, detachedConnected };
}

function customChecks() {
  return [
    'packaged framework-free renderer mounts the unchanged shared inspector and dispatches all four actions through existing native bindings',
    'custom-rendered actions preserve realm-only, explicit provider and all-provider broadcast selection with independent native state',
    'all three native providers modify their own response and native reference server cards update independently',
    'reference/custom replacement preserves backend state and detached custom reset buttons cannot dispatch',
    'custom marker and reset actions affect the next actual owned document and clear projected state',
    'disconnect disposes the custom mount, disables selection and prevents retained buttons from changing server state',
  ];
}
