import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { By } from 'selenium-webdriver';
import {
  checkInspectorOutcomes,
  checkInspectorSnapshot,
  inspectorErrorChecks,
  inspectorErrorLimitations,
  inspectorErrorSnapshot,
  isCurrentInspectorMount,
  startInspectorErrorFixture,
  startInspectorErrorSibling,
} from './inspector-error-fixture.ts';
import type { InspectorErrorFixture } from './inspector-error-fixture.ts';
import type { InspectorHost } from './inspector-hosts.ts';
import { connect, createDriver, result } from './mixed-inspector-firefox-ui.ts';

type FirefoxDriver = ReturnType<typeof createDriver>;
function snapshot(driver: FirefoxDriver) {
  return driver.executeScript<ReturnType<typeof inspectorErrorSnapshot>>(inspectorErrorSnapshot);
}

const receipt = await run();
await mkdir('artifacts/inspector', { recursive: true });
await writeFile('artifacts/inspector/errors-firefox.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [inspector/errors/firefox]'), receipt);

async function run() {
  await using cleanup = new AsyncDisposableStack();
  const extensionUuid = crypto.randomUUID();
  const driver = createDriver(extensionUuid);
  cleanup.defer(() => driver.quit());
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.get(`moz-extension://${extensionUuid}/panel.html`);
  const panel = await driver.getWindowHandle();
  await result(driver, '#status', 'Connected');
  const origin = await driver.executeScript<string>(() => `${location.protocol}//${location.host}`);
  const fixture = await startInspectorErrorFixture();
  cleanup.defer(fixture.close);
  const sibling = await startInspectorErrorSibling(origin, cleanup);
  await connect(driver, sibling);
  await driver.findElement(By.css('#json-selection option[value="all"]')).click();
  await driver.switchTo().newWindow('tab');
  await driver.get(`${fixture.origin}/inspector-fixture`);
  await driver.switchTo().window(panel);
  const observations = [];
  for (const renderer of ['reference', 'custom'] as const)
    observations.push(await checkRecovery({ driver, fixture, sibling, renderer }));
  return {
    browser: (await driver.getCapabilities()).getBrowserVersion(),
    mode: 'production-extension-with-native-development-sibling',
    observations,
    requests: fixture.requests(),
    checks: inspectorErrorChecks,
    limitations: [
      ...inspectorErrorLimitations,
      'No global page-error or browser-console capture through WebDriver Classic; visible native failures are asserted',
    ],
  };
}

async function action(driver: FirefoxDriver, label: string, outcome: string) {
  const root = await driver.findElement(By.id('inspector')).getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf(label)];
  assert.ok(button);
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await driver.wait(async () => {
    const text = await driver.findElement(By.id('json-result')).getText();
    const current = await snapshot(driver);
    return text.includes('"status":') && current.text.includes(outcome) && current.disabled === 0;
  }, 10_000);
  return driver.findElement(By.id('json-result')).getText();
}

async function select(driver: FirefoxDriver, renderer: 'reference' | 'custom') {
  await driver.wait(() => driver.findElement(By.id('inspector-renderer')).isEnabled(), 10_000);
  await driver.findElement(By.css(`#inspector-renderer option[value="${renderer}"]`)).click();
  await driver.wait(async () => {
    const current = await snapshot(driver);
    return current.buttons === 5 && current.custom === (renderer === 'custom');
  }, 10_000);
}

async function checkRecovery(options: {
  readonly driver: FirefoxDriver;
  readonly fixture: InspectorErrorFixture;
  readonly sibling: InspectorHost;
  readonly renderer: 'reference' | 'custom';
}) {
  const { driver, fixture, sibling, renderer } = options;
  const origins = { extension: fixture.origin, sibling: sibling.origin };
  await select(driver, renderer);
  await action(driver, 'Enable response modification', 'Configuration dispatch complete');
  const original = checkInspectorOutcomes(
    await action(driver, 'Inspect response', 'Inspection dispatch complete'),
    'fulfilled',
    origins,
    'native:fixture:original',
  );
  const before = await snapshot(driver);
  checkInspectorSnapshot(before);
  const root = await driver.findElement(By.id('inspector')).getShadowRoot();
  const mount = await root.findElement(
    By.css('.devframes-json-render-scroll-root, [data-renderer="custom"]'),
  );
  const firstRequest = fixture.requests().length;
  fixture.failure.active = true;
  const rejected = checkInspectorOutcomes(
    await action(driver, 'Inspect response', 'Inspection dispatch complete'),
    'rejected',
    origins,
    'native:fixture:original',
  );
  const failedRequests = fixture.requests().slice(firstRequest);
  assert.ok(
    failedRequests.length > 0 && failedRequests.every((request) => request === 'destroyed'),
  );
  const failed = await snapshot(driver);
  checkInspectorSnapshot(failed);
  assert.deepEqual(failed, before);
  assert.equal(await driver.executeScript(isCurrentInspectorMount, mount), true);
  fixture.failure.active = false;
  const { recovered, after } = await recover(driver, origins);
  assert.equal(after.document, before.document);
  assert.equal(after.provider, before.provider);
  assert.equal(await driver.executeScript(isCurrentInspectorMount, mount), true);
  return { renderer, original, rejected, recovered, before, failed, after, failedRequests };
}

async function recover(
  driver: FirefoxDriver,
  origins: { readonly extension: string; readonly sibling: string },
) {
  await action(driver, 'Reset inspector', 'Reset dispatch complete');
  assert.ok((await snapshot(driver)).state.includes('Response body: No response inspected'));
  const recovered = checkInspectorOutcomes(
    await action(driver, 'Inspect response', 'Inspection dispatch complete'),
    'fulfilled',
    origins,
    'fixture:original',
  );
  const after = await snapshot(driver);
  checkInspectorSnapshot(after);
  assert.ok(after.state.includes('Modification enabled: false'));
  assert.ok(after.state.includes('Response body: fixture:original'));
  return { recovered, after };
}
