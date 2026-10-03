import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import {
  inspectorChecks,
  inspectorLimitations,
  inspectorMarkerSnapshot,
  inspectorOutcome,
  readInspectorResponse,
  startInspectorFixture,
} from './inspector-fixture.ts';
import type { InspectorFixture } from './inspector-fixture.ts';

const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile('artifacts/inspector/firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [inspector/firefox]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const extensionUuid = crypto.randomUUID();
  const options = new Options()
    .addArguments('-headless')
    .setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ 'devkit-native-port@example.invalid': extensionUuid }),
    );
  if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
  const driver = Driver.createSession(
    options,
    new ServiceBuilder().addArguments('--allow-system-access').build(),
  );
  cleanup.defer(() => driver.quit());
  const fixture = await startInspectorFixture();
  cleanup.defer(fixture.close);
  await driver.manage().setTimeouts({ script: 10_000 });
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.get(`moz-extension://${extensionUuid}/panel.html`);
  const panel = await driver.getWindowHandle();
  await driver.wait(
    async () => (await driver.findElement(By.id('status')).getText()) === 'Connected',
    10_000,
  );
  await waitInspector(driver, 'Response body: No response inspected');
  const provider = await driver.findElement(By.id('provider')).getText();
  const observations = await checkInspector(driver, panel, fixture);
  assert.equal(await driver.findElement(By.id('provider')).getText(), provider);
  assert.equal(
    await driver.executeScript(
      () => document.querySelector('#renderer')?.shadowRoot?.querySelector('p')?.textContent,
    ),
    'Counter: 0',
  );
  return {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    mode: 'production-extension',
    checks: [
      ...inspectorChecks,
      'Firefox modifies actual page-fetch response bytes only for the selected top-level fixture document',
      'the same tab navigating to another document receives the original body while modification remains enabled',
    ],
    observations,
    limitations: [
      'No global page-error capture through WebDriver Classic',
      ...inspectorLimitations,
    ],
  };
}

async function waitInspector(driver: Driver, text: string) {
  await driver.wait(
    () =>
      driver.executeScript<boolean>(
        (expected: string) =>
          document.querySelector('#inspector')?.shadowRoot?.textContent?.includes(expected) ===
          true,
        text,
      ),
    10_000,
  );
}

async function dispatch(driver: Driver, label: string, status: 'fulfilled' | 'rejected') {
  const root = await driver.findElement(By.id('inspector')).getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf(label)];
  assert.ok(button);
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await driver.wait(
    async () =>
      (await driver.findElement(By.id('json-result')).getText()).includes(`"status":"${status}"`),
    10_000,
  );
  return inspectorOutcome(await driver.findElement(By.id('json-result')).getText(), status);
}

async function checkInspector(driver: Driver, panel: string, fixture: InspectorFixture) {
  const absent = await dispatch(driver, 'Inspect response', 'rejected');
  assert.equal(fixture.reads(), 0);
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  await driver.get(`${fixture.origin}/inspector-fixture`);
  const beforeMarker = await driver.executeScript(inspectorMarkerSnapshot);
  assert.deepEqual(beforeMarker, {
    firstScript: { marker: null, readyState: 'loading' },
    currentMarker: null,
  });
  await driver.switchTo().window(panel);
  const original = await dispatch(driver, 'Inspect response', 'fulfilled');
  assert.partialDeepStrictEqual(original, [
    {
      value: {
        latest: {
          url: `${fixture.origin}/inspector-response`,
          status: 200,
          body: 'fixture:original',
        },
      },
    },
  ]);
  await waitInspector(driver, 'Response body: fixture:original');
  const ambiguous = await checkAmbiguousTarget(driver, panel, fixture);
  const enabled = await dispatch(driver, 'Enable response modification', 'fulfilled');
  await waitInspector(driver, 'Modification enabled: true');
  const modified = await dispatch(driver, 'Inspect response', 'fulfilled');
  assert.partialDeepStrictEqual(modified, [
    { value: { latest: { body: 'native:fixture:original' } } },
  ]);
  await waitInspector(driver, 'Response body: native:fixture:original');
  await driver.switchTo().window(source);
  await driver.get(`${fixture.origin}/other-page`);
  const otherDocument =
    await driver.executeScript<Awaited<ReturnType<typeof readInspectorResponse>>>(
      readInspectorResponse,
    );
  assert.equal(otherDocument.body, 'fixture:original');
  await driver.get(`${fixture.origin}/inspector-fixture`);
  await driver.switchTo().window(panel);
  const marker = await checkMarkerReset(driver, panel, source);
  return { absent, original, ambiguous, enabled, modified, otherDocument, beforeMarker, marker };
}

async function checkAmbiguousTarget(driver: Driver, panel: string, fixture: InspectorFixture) {
  await driver.switchTo().newWindow('tab');
  const duplicate = await driver.getWindowHandle();
  try {
    await driver.get(`${fixture.origin}/inspector-fixture`);
    await driver.switchTo().window(panel);
    const reads = fixture.reads();
    const outcome = await dispatch(driver, 'Inspect response', 'rejected');
    assert.equal(fixture.reads(), reads);
    await waitInspector(driver, 'Response body: fixture:original');
    return outcome;
  } finally {
    await driver.switchTo().window(duplicate);
    await driver.close();
    await driver.switchTo().window(panel);
  }
}

async function checkMarkerReset(driver: Driver, panel: string, source: string) {
  const installed = await dispatch(driver, 'Install page marker', 'fulfilled');
  await waitInspector(driver, 'Marker installed: true');
  await driver.switchTo().window(source);
  await driver.navigate().refresh();
  const active = await driver.executeScript(inspectorMarkerSnapshot);
  assert.deepEqual(active, {
    firstScript: { marker: 'loading', readyState: 'loading' },
    currentMarker: 'loading',
  });
  await driver.switchTo().window(panel);
  const reset = await dispatch(driver, 'Reset inspector', 'fulfilled');
  assert.partialDeepStrictEqual(reset, [
    { value: { target: null, latest: null, configuration: { enabled: false }, marker: false } },
  ]);
  await waitInspector(driver, 'Response body: No response inspected');
  await driver.switchTo().window(source);
  assert.deepEqual(await driver.executeScript(inspectorMarkerSnapshot), active);
  await driver.navigate().refresh();
  const afterReset = await driver.executeScript(inspectorMarkerSnapshot);
  assert.deepEqual(afterReset, {
    firstScript: { marker: null, readyState: 'loading' },
    currentMarker: null,
  });
  const response =
    await driver.executeScript<Awaited<ReturnType<typeof readInspectorResponse>>>(
      readInspectorResponse,
    );
  assert.equal(response.body, 'fixture:original');
  await driver.switchTo().window(panel);
  return { installed, active, reset, afterReset };
}
